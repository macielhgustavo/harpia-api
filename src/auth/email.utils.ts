import { createHash } from 'crypto';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailFingerprint(email: string): string {
  return createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex')
    .slice(0, 12);
}
