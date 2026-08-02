import { createHash, randomBytes } from 'crypto';

const RESET_TOKEN_BYTES = 32;

export function createPasswordResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
