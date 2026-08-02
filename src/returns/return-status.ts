import { ReturnStatus } from '@prisma/client';

/**
 * Returns are overdue only in the response layer.  Keeping this rule pure
 * makes the Returns module and financial reports agree without persisting a
 * derived status.
 */
export function getComputedReturnStatus(
  status: ReturnStatus,
  expectedDate: Date,
  referenceDate = new Date(),
): ReturnStatus {
  if (
    status === ReturnStatus.PENDENTE &&
    expectedDate.getTime() < referenceDate.getTime()
  ) {
    return ReturnStatus.ATRASADO;
  }

  return status;
}
