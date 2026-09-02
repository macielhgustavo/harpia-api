import { ReceivableStatus } from '@prisma/client';

export type ReceivableDisplayStatus = ReceivableStatus | 'ATRASADO';

export function startOfUtcDay(referenceDate = new Date()): Date {
  return new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
}

export function getComputedReceivableStatus(
  status: ReceivableStatus,
  dueDate: Date,
  referenceDate = new Date(),
): ReceivableDisplayStatus {
  if (
    (status === ReceivableStatus.PENDENTE ||
      status === ReceivableStatus.PARCIAL) &&
    dueDate.getTime() < startOfUtcDay(referenceDate).getTime()
  ) {
    return 'ATRASADO';
  }

  return status;
}
