export function resolveCorsOptions(env: NodeJS.ProcessEnv = process.env): {
  origin: string[];
  credentials: true;
} {
  const configured = env.CORS_ALLOWED_ORIGINS?.trim();
  if (!configured && env.NODE_ENV === 'production') {
    throw new Error('CORS_ALLOWED_ORIGINS must be configured in production.');
  }

  const values = (configured ?? 'http://localhost:4200,http://127.0.0.1:4200')
    .split(',')
    .map((value) => value.trim());
  const origins = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      url.hostname.includes('*')
    ) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins.',
      );
    }
    return url.origin;
  });

  return { origin: [...new Set(origins)], credentials: true };
}
