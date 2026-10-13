import { resolveCorsOptions } from './cors';

describe('CORS deployment boundaries', () => {
  it('permits only local Angular origins by default in development', () => {
    expect(resolveCorsOptions({ NODE_ENV: 'development' }).origin).toEqual([
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ]);
  });

  it('refuses a production deployment without an explicit allowlist', () => {
    expect(() => resolveCorsOptions({ NODE_ENV: 'production' })).toThrow(
      'CORS_ALLOWED_ORIGINS must be configured in production.',
    );
    expect(() =>
      resolveCorsOptions({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: '  ',
      }),
    ).toThrow();
  });

  it('normalizes and deduplicates configured origins without reflecting clients', () => {
    expect(
      resolveCorsOptions({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS:
          ' https://app.example.com/,https://app.example.com,http://localhost:4200 ',
      }),
    ).toEqual({
      origin: ['https://app.example.com', 'http://localhost:4200'],
      credentials: true,
    });
  });

  it.each([
    '*',
    'https://*.example.com',
    'null',
    'file:///tmp/page',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com?token=test',
    'https://example.com#fragment',
    'https://example.com,',
  ])('rejects invalid origin configuration: %s', (value) => {
    expect(() => resolveCorsOptions({ CORS_ALLOWED_ORIGINS: value })).toThrow();
  });
});
