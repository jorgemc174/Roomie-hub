import 'server-only';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import type { Database } from '@/lib/supabase/database.types';
import {
  deliveryPayload,
  providerOutcome,
  safePushEndpoint,
  sendEmail,
  type Delivery,
  type Outcome,
} from './delivery';
export async function deliverNotifications() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('worker_configuration');
  // This privileged client is isolated from all user-facing reads and mutations.
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey = process.env.VAPID_PRIVATE_KEY,
    subject = process.env.VAPID_SUBJECT;
  const emailKey = process.env.RESEND_API_KEY,
    emailFrom = process.env.ROOMIEHUB_EMAIL_FROM,
    origin = process.env.NEXT_PUBLIC_SITE_URL;
  const channels: string[] = [];
  if (publicKey && privateKey && subject) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    channels.push('push');
  }
  if (emailKey && emailFrom && origin) channels.push('email');
  if (!channels.length) return { claimed: 0, sent: 0, disabled: true };
  const claimed = await db.rpc('claim_notification_deliveries', { channels });
  if (claimed.error) throw new Error('claim_failed');
  const deliveries = claimed.data as unknown as Delivery[];
  let sent = 0,
    failed = 0;
  // Bounded concurrency avoids one slow provider occupying the whole scheduler interval.
  for (let start = 0; start < deliveries.length; start += 5)
    await Promise.all(
      deliveries.slice(start, start + 5).map(async (d) => {
        let outcome: Outcome = { outcome: 'cancelled' };
        try {
          let email: string | undefined;
          if (d.channel === 'email') {
            const result = await db.auth.admin.getUserById(d.user_id);
            if (result.error) throw new Error('recipient_lookup');
            email = result.data.user?.email;
          }
          const valid = await db.rpc('notification_delivery_valid', {
            item: d.id,
            lease_token: d.lease,
          });
          if (valid.error) throw new Error('validation_failed');
          if (valid.data) {
            if (d.channel === 'email' && email && emailKey && emailFrom && origin)
              outcome = await sendEmail(d, email, { key: emailKey, from: emailFrom, origin });
            else if (
              d.channel === 'push' &&
              d.subscription &&
              safePushEndpoint(d.subscription.endpoint)
            ) {
              const ttl = d.event_at
                ? Math.max(
                    0,
                    Math.min(
                      3600,
                      Math.floor((new Date(d.event_at).getTime() - Date.now()) / 1000),
                    ),
                  )
                : 3600;
              if (ttl > 0) {
                await webpush.sendNotification(d.subscription, JSON.stringify(deliveryPayload(d)), {
                  TTL: ttl,
                  timeout: 10000,
                  urgency: 'normal',
                });
                outcome = { outcome: 'sent' };
              }
            }
          }
        } catch (e) {
          outcome = providerOutcome((e as { statusCode?: number }).statusCode);
        }
        const finished = await db.rpc('finish_notification_delivery', {
          item: d.id,
          lease_token: d.lease,
          ...outcome,
        });
        if (finished.error) failed++;
        else if (outcome.outcome === 'sent') sent++;
      }),
    );
  return { claimed: deliveries.length, sent, acknowledgementErrors: failed, disabled: false };
}
