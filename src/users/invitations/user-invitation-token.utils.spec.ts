import {
  createUserInvitationToken,
  hashUserInvitationToken,
} from './user-invitation-token.utils';

describe('user invitation token utilities', () => {
  it('creates random 32-byte base64url tokens', () => {
    const first = createUserInvitationToken();
    const second = createUserInvitationToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
  });

  it('stores only a deterministic SHA-256 digest', () => {
    const token = 'raw-invitation-token';
    const hash = hashUserInvitationToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
    expect(hash).toBe(hashUserInvitationToken(token));
    expect(hash).not.toContain(token);
  });
});
