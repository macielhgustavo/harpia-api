import { Prisma } from '@prisma/client';

export async function acquireTransactionAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  // pg_advisory_xact_lock returns PostgreSQL void. Prisma 5 cannot deserialize
  // that type through $queryRaw (P2010), while $executeRaw acquires the same
  // transaction-scoped lock without attempting to decode the result column.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${key}))
  `;
}
