import { createHash, randomBytes } from 'crypto';

const USER_INVITATION_TOKEN_BYTES = 32;

export function createUserInvitationToken(): string {
  return randomBytes(USER_INVITATION_TOKEN_BYTES).toString('base64url');
}

export function hashUserInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
