import { ReceivableStatus } from '@prisma/client';
import { getComputedReceivableStatus } from './receivable-status';

describe('getComputedReceivableStatus', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');

  it('computes overdue without persisting a second status system', () => {
    expect(
      getComputedReceivableStatus(
        ReceivableStatus.PENDENTE,
        new Date('2026-09-01T00:00:00.000Z'),
        now,
      ),
    ).toBe('ATRASADO');
    expect(
      getComputedReceivableStatus(
        ReceivableStatus.PARCIAL,
        new Date('2026-09-02T00:00:00.000Z'),
        now,
      ),
    ).toBe(ReceivableStatus.PARCIAL);
  });

  it('never changes terminal statuses', () => {
    expect(
      getComputedReceivableStatus(
        ReceivableStatus.PAGO,
        new Date('2020-01-01T00:00:00.000Z'),
        now,
      ),
    ).toBe(ReceivableStatus.PAGO);
    expect(
      getComputedReceivableStatus(
        ReceivableStatus.CANCELADO,
        new Date('2020-01-01T00:00:00.000Z'),
        now,
      ),
    ).toBe(ReceivableStatus.CANCELADO);
  });
});
