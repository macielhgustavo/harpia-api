const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');

const isWindows = process.platform === 'win32';
const docker = isWindows ? 'docker.exe' : 'docker';
const prismaCli = join(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);
const jestCli = join(process.cwd(), 'node_modules', 'jest', 'bin', 'jest.js');
const containerName = `harpia-e2e-${randomUUID().slice(0, 8)}`;
const databaseName = 'harpia_e2e';
const databasePassword = `e2e-${randomUUID()}`;
let ownsContainer = false;
let nativeCluster = null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
    input: options.input,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(`${command} ${args.join(' ')} falhou (${result.status})`);
  }
  return (result.stdout ?? '').trim();
}

function assertSafeDatabase(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('E2E_DATABASE_URL não é uma URL PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('O E2E exige PostgreSQL real.');
  }
  const targetDatabase = decodeURIComponent(parsed.pathname.slice(1));
  if (!/(?:test|e2e)/i.test(targetDatabase)) {
    throw new Error(
      `Banco recusado: "${targetDatabase}" não está identificado como test/e2e.`,
    );
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (
    !localHosts.has(parsed.hostname) &&
    process.env.E2E_ALLOW_REMOTE_DATABASE !== 'true'
  ) {
    throw new Error(
      'Banco E2E remoto exige E2E_ALLOW_REMOTE_DATABASE=true explícito.',
    );
  }
  if (
    process.env.PRODUCTION_DATABASE_URL &&
    databaseUrl === process.env.PRODUCTION_DATABASE_URL
  ) {
    throw new Error('O banco E2E não pode ser o banco de produção.');
  }
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      docker,
      [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        databaseName,
      ],
      { stdio: 'ignore' },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error('PostgreSQL E2E não ficou pronto dentro de 30 segundos.');
}

function startEphemeralPostgres() {
  run(
    docker,
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      `POSTGRES_PASSWORD=${databasePassword}`,
      '--env',
      `POSTGRES_DB=${databaseName}`,
      'postgres:16-alpine',
    ],
    { capture: true },
  );
  ownsContainer = true;
  waitForPostgres();
  const binding = run(docker, ['port', containerName, '5432/tcp'], {
    capture: true,
  });
  const port = binding.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Porta PostgreSQL inválida: ${binding}`);
  return `postgresql://postgres:${databasePassword}@127.0.0.1:${port}/${databaseName}?schema=public`;
}

function startNativePostgres(postgresBin) {
  const executable = (name) =>
    join(postgresBin, isWindows ? `${name}.exe` : name);
  const dataDirectory = mkdtempSync(join(tmpdir(), 'harpia-e2e-'));
  nativeCluster = { dataDirectory, executable };
  const port =
    Number(process.env.E2E_POSTGRES_PORT) ||
    20000 + Math.floor(Math.random() * 20000);
  run(executable('initdb'), [
    '-D',
    dataDirectory,
    '--username=postgres',
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
  ]);
  run(executable('pg_ctl'), [
    '-D',
    dataDirectory,
    '-o',
    `-h 127.0.0.1 -p ${port} -c timezone=UTC`,
    '-w',
    'start',
  ]);
  run(executable('createdb'), [
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'postgres',
    databaseName,
  ]);
  return `postgresql://postgres@127.0.0.1:${port}/${databaseName}?schema=public`;
}

function findNativePostgres() {
  if (process.env.E2E_POSTGRES_BIN) return process.env.E2E_POSTGRES_BIN;
  if (isWindows) {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (!existsSync(root)) return null;
    const versions = readdirSync(root).sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );
    return (
      versions
        .map((version) => join(root, version, 'bin'))
        .find((bin) =>
          ['initdb.exe', 'pg_ctl.exe', 'createdb.exe'].every((file) =>
            existsSync(join(bin, file)),
          ),
        ) ?? null
    );
  }
  const lookup = spawnSync('sh', ['-c', 'command -v initdb'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return lookup.status === 0 && lookup.stdout.trim()
    ? dirname(lookup.stdout.trim())
    : null;
}

function startDefaultPostgres() {
  try {
    return startEphemeralPostgres();
  } catch (dockerError) {
    const postgresBin = findNativePostgres();
    if (postgresBin) {
      console.warn(
        `Docker indisponível; usando PostgreSQL nativo em ${postgresBin}.`,
      );
      return startNativePostgres(postgresBin);
    }
    throw dockerError;
  }
}

function cleanup() {
  if (ownsContainer) {
    spawnSync(docker, ['rm', '--force', containerName], { stdio: 'ignore' });
  }
  if (nativeCluster) {
    spawnSync(
      nativeCluster.executable('pg_ctl'),
      ['-D', nativeCluster.dataDirectory, '-m', 'fast', 'stop'],
      { stdio: 'ignore' },
    );
    rmSync(nativeCluster.dataDirectory, { recursive: true, force: true });
  }
}

try {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O runner E2E recusa execução com NODE_ENV=production.');
  }
  const databaseUrl =
    process.env.E2E_DATABASE_URL ||
    (process.env.E2E_POSTGRES_BIN
      ? startNativePostgres(process.env.E2E_POSTGRES_BIN)
      : startDefaultPostgres());
  assertSafeDatabase(databaseUrl);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_SECRET:
      process.env.JWT_SECRET || 'harpia-e2e-jwt-secret-only-for-tests',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
  };

  run(
    process.execPath,
    [
      prismaCli,
      'db',
      'execute',
      '--schema',
      'prisma/schema.prisma',
      '--file',
      'test/setup/reset-test-database.sql',
    ],
    { env },
  );
  run(process.execPath, [prismaCli, 'migrate', 'deploy'], { env });
  run(
    process.execPath,
    [
      jestCli,
      '--config',
      './test/jest-e2e.json',
      '--runInBand',
      ...process.argv.slice(2).filter((argument) => argument !== '--runInBand'),
    ],
    { env },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  cleanup();
}
