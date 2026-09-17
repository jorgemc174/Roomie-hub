// Local preparation only. Never prints private keys; .env.local stays ignored.
import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import webpush from 'web-push';
const path = '.env.local';
const current = await readFile(path, 'utf8');
const has = (name) => new RegExp(`^${name}=.+$`, 'm').test(current);
const lines = [];
if (!has('NEXT_PUBLIC_VAPID_PUBLIC_KEY') && !has('VAPID_PRIVATE_KEY')) {
  const keys = webpush.generateVAPIDKeys();
  lines.push(
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
  );
} else if (has('NEXT_PUBLIC_VAPID_PUBLIC_KEY') !== has('VAPID_PRIVATE_KEY')) {
  throw new Error('Incomplete VAPID pair: restore both keys together.');
}
if (!has('VAPID_SUBJECT')) lines.push('VAPID_SUBJECT=https://roomiehub.invalid');
if (!has('ROOMIEHUB_JOB_SECRET'))
  lines.push(`ROOMIEHUB_JOB_SECRET=${randomBytes(32).toString('hex')}`);
if (lines.length)
  await appendFile(
    path,
    '\n# Phase 6 local worker; replace VAPID_SUBJECT with your production contact URI.\n' +
      lines.join('\n') +
      '\n',
  );
console.log('Local VAPID pair and worker token ready. No secrets printed.');
