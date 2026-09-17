import { timingSafeEqual } from 'node:crypto';
import { safeNext } from '@/lib/validation';
export type Delivery = {
  id: string;
  lease: string;
  channel: 'email' | 'push';
  user_id: string;
  notification_id: string;
  title: string;
  body: string;
  url: string;
  event_at: string | null;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null;
};
export type Outcome = {
  outcome: 'sent' | 'retry' | 'failed' | 'expired' | 'cancelled';
  error_code?: string;
};
export function validWorkerToken(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function safePushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      (u.hostname === 'fcm.googleapis.com' ||
        u.hostname.endsWith('.push.services.mozilla.com') ||
        u.hostname === 'web.push.apple.com' ||
        u.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
export function deliveryPayload(d: Delivery) {
  return {
    id: d.notification_id,
    title: d.title,
    body: d.body,
    url: safeNext(d.url),
    eventAt: d.event_at,
  };
}
export function providerOutcome(status?: number): Outcome {
  if (status === 404 || status === 410)
    return { outcome: 'expired', error_code: 'subscription_expired' };
  if (status && status >= 400 && status < 500 && status !== 429)
    return { outcome: 'failed', error_code: `provider_${status}` };
  return { outcome: 'retry', error_code: status ? `provider_${status}` : 'network_error' };
}
export async function sendEmail(
  d: Delivery,
  email: string,
  config: { key: string; from: string; origin: string },
  transport: typeof fetch = fetch,
): Promise<Outcome> {
  const response = await transport('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': d.id,
    },
    body: JSON.stringify({
      from: config.from,
      to: [email],
      subject: d.title,
      text: `${d.body}\n\n${new URL(safeNext(d.url), config.origin).href}`,
    }),
  });
  return response.ok ? { outcome: 'sent' } : providerOutcome(response.status);
}
