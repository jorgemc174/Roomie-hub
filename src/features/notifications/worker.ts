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
  const deadline = Date.now() + 60000;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('worker_configuration');
  // This privileged client is isolated from all user-facing reads and mutations.
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        }),
    },
  });
  // Storage owns the actual bytes. Acknowledge only after its deletion API
  // succeeds, so a failed removal or acknowledgement is safe to retry.
  const pendingFiles = await db.rpc('pending_chat_attachment_cleanup');
  if (pendingFiles.error) throw new Error('attachment_cleanup_lookup_failed');
  let attachmentsRemoved = 0,
    attachmentCleanupErrors = 0;
  const paths = pendingFiles.data ?? [];
  if (paths.length) {
    const removed = await db.storage.from('chat-files').remove(paths);
    if (removed.error) attachmentCleanupErrors++;
    else {
      const finished = await db.rpc('finish_chat_attachment_cleanup', { paths });
      if (finished.error) attachmentCleanupErrors++;
      else attachmentsRemoved = paths.length;
    }
  }
  const cleanup = { attachmentsRemoved, attachmentCleanupErrors };
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
  if (!channels.length) return { claimed: 0, sent: 0, disabled: true, ...cleanup };
  let claimedCount = 0,
    sent = 0,
    failed = 0;
  // Stop new claims after 60 s. Five leases at a time leave room for the final
  // lookup/validation/provider/acknowledgement (10 s each) within maxDuration=120.
  while (Date.now() < deadline) {
    const claimed = await db.rpc('claim_notification_deliveries', { channels, batch_size: 5 });
    if (claimed.error) throw new Error('claim_failed');
    const deliveries = claimed.data as unknown as Delivery[];
    if (!deliveries.length) break;
    claimedCount += deliveries.length;
    await Promise.all(
      deliveries.map(async (d) => {
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
  }
  return { claimed: claimedCount, sent, acknowledgementErrors: failed, disabled: false, ...cleanup };
}
