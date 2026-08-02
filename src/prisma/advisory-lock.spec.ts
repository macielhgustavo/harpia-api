import { Prisma } from '@prisma/client';
import { acquireTransactionAdvisoryLock } from './advisory-lock';

describe('acquireTransactionAdvisoryLock', () => {
  it('uses executeRaw so Prisma does not deserialize PostgreSQL void', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest.fn();
    const tx = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    await acquireTransactionAdvisoryLock(tx, 'normalized@example.com');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      'normalized@example.com',
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
