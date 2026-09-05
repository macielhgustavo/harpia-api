import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const RECOVERABLE_MIGRATION = '20260904040000_sales_visits';

type PrismaCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function runPrisma(args: string[]): PrismaCommandResult {
  const prismaCli = join(
    process.cwd(),
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function printResult(result: PrismaCommandResult) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function assertSuccessful(result: PrismaCommandResult, command: string) {
  if (result.status === 0 && !result.error) return;

  printResult(result);
  const detail = result.error?.message ?? `exit code ${result.status}`;
  throw new Error(`Prisma ${command} failed with ${detail}`);
}

export function runProductionMigrations() {
  if (process.env.NODE_ENV !== 'production' || !process.env.DATABASE_URL) return;

  const deploy = runPrisma(['migrate', 'deploy']);
  if (deploy.status === 0 && !deploy.error) {
    printResult(deploy);
    return;
  }

  const output = `${deploy.stdout}\n${deploy.stderr}`;
  const isRecoverableFailure =
    output.includes('P3009') && output.includes(RECOVERABLE_MIGRATION);

  if (!isRecoverableFailure) {
    assertSuccessful(deploy, 'migrate deploy');
    return;
  }

  printResult(deploy);
  console.warn(
    `Recovering the failed ${RECOVERABLE_MIGRATION} migration before retrying.`,
  );
  const resolve = runPrisma([
    'migrate',
    'resolve',
    '--rolled-back',
    RECOVERABLE_MIGRATION,
  ]);
  assertSuccessful(resolve, 'migrate resolve');
  printResult(resolve);

  const retry = runPrisma(['migrate', 'deploy']);
  assertSuccessful(retry, 'migrate deploy retry');
  printResult(retry);
}
