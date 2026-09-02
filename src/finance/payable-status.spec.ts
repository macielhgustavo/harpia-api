import { PayableStatus } from '@prisma/client';
import { getComputedPayableStatus } from './payable-status';

describe('getComputedPayableStatus', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');

  it('reports pending and partial past due balances as overdue', () => {
    for (const status of [PayableStatus.PENDENTE, PayableStatus.PARCIAL]) {
      expect(
        getComputedPayableStatus(
          status,
          new Date('2026-09-01T00:00:00.000Z'),
          now,
        ),
      ).toBe('ATRASADO');
    }
  });

  it('keeps paid items paid after their due date', () => {
    expect(
      getComputedPayableStatus(
        PayableStatus.PAGO,
        new Date('2026-09-01T00:00:00.000Z'),
        now,
      ),
    ).toBe(PayableStatus.PAGO);
  });
});
