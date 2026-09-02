import { PayableStatus } from '@prisma/client';
import { startOfUtcDay } from '../receivables/receivable-status';

export type ComputedPayableStatus = PayableStatus | 'ATRASADO';

export function getComputedPayableStatus(
  status: PayableStatus,
  dueDate: Date,
  now = new Date(),
): ComputedPayableStatus {
  return (status === PayableStatus.PENDENTE ||
    status === PayableStatus.PARCIAL) &&
    dueDate < startOfUtcDay(now)
    ? 'ATRASADO'
    : status;
}
