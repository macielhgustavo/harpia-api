import { createHash } from 'crypto';
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from './password-reset-token.utils';

describe('password reset token utilities', () => {
  it('creates high-entropy URL-safe tokens and hashes them with SHA-256', () => {
    const token = createPasswordResetToken();
    const hash = hashPasswordResetToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
  });
});
