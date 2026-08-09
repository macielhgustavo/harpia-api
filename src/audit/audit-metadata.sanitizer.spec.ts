import { sanitizeAuditMetadata } from './audit-metadata.sanitizer';

describe('sanitizeAuditMetadata', () => {
  it('recursively removes sensitive keys without mutating its input', () => {
    const metadata = Object.freeze({
      operation: 'user-update',
      profile: Object.freeze({
        displayName: 'Ana',
        password: 'never-store-this',
        accessToken: 'secret-token',
        nested: Object.freeze({ authorization: 'Bearer jwt' }),
      }),
      requestHeaders: { cookie: 'session=secret' },
      passwordHash: 'hash',
    });

    const result = sanitizeAuditMetadata(metadata);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      operation: 'user-update',
      profile: { displayName: 'Ana', nested: {} },
    });
    expect(serialized).not.toContain('never-store-this');
    expect(serialized).not.toContain('secret-token');
    expect(metadata.profile.password).toBe('never-store-this');
  });

  it('limits strings, collections, depth, binary values and total size', () => {
    const circular: Record<string, unknown> = { label: 'root' };
    circular.self = circular;

    const result = sanitizeAuditMetadata({
      oversized: 'x'.repeat(100_000),
      many: Array.from({ length: 200 }, (_, index) => index),
      deep: { a: { b: { c: { d: { e: { f: { g: 'hidden' } } } } } } },
      payload: Buffer.from('private binary'),
      circular,
    });
    const serialized = JSON.stringify(result);

    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(16_384);
    expect((result as { many: unknown[] }).many).toHaveLength(50);
    expect(serialized).not.toContain('private binary');
    expect(serialized).toContain('[Circular]');
    expect(serialized).toContain('[Truncated]');
  });
});
