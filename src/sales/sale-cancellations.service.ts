import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CollectionDispatchStatus,
  PayableStatus,
  Prisma,
  ReceivableStatus,
  SaleCommissionStatus,
  SaleStatus,
  UnitStatus,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { SalesService } from './sales.service';

interface Actor { id: string; organizationId: string }

@Injectable()
export class SaleCancellationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
  ) {}

  async cancel(id: string, actor: Actor, dto: CancelSaleDto) {
    await this.prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id, organizationId: actor.organizationId },
          include: {
            receivables: { select: { id: true, paidAmount: true, status: true } },
            commissions: {
              select: {
                id: true,
                status: true,
                payable: { select: { id: true, paidAmount: true, status: true } },
              },
            },
          },
        });
        if (!sale) throw new NotFoundException('Venda n\u00e3o encontrada');
        if (sale.status === SaleStatus.DISTRATADA || sale.status === SaleStatus.CANCELADA) {
          throw new ConflictException('A venda j\u00e1 est\u00e1 encerrada');
        }
        if (sale.receivables.some((item) => !item.paidAmount.equals(0))) {
          throw new ConflictException('Estorne os recebimentos antes de realizar o distrato');
        }
        if (
          sale.commissions.some(
            (item) =>
              item.status === SaleCommissionStatus.PAGA ||
              (item.payable && !item.payable.paidAmount.equals(0)),
          )
        ) {
          throw new ConflictException('Estorne os pagamentos de comiss\u00e3o antes de realizar o distrato');
        }

        const receivableIds = sale.receivables.map((item) => item.id);
        const commissionIds = sale.commissions.map((item) => item.id);
        await tx.collectionDispatch.updateMany({
          where: {
            organizationId: actor.organizationId,
            receivableId: { in: receivableIds },
            status: { in: [CollectionDispatchStatus.PENDENTE, CollectionDispatchStatus.FALHOU] },
          },
          data: { status: CollectionDispatchStatus.CANCELADO },
        });
        await tx.receivable.updateMany({
          where: { organizationId: actor.organizationId, saleId: sale.id },
          data: { status: ReceivableStatus.CANCELADO, cancelledAt: new Date() },
        });
        await tx.payable.updateMany({
          where: {
            organizationId: actor.organizationId,
            saleCommissionId: { in: commissionIds },
            status: { not: PayableStatus.PAGO },
          },
          data: { status: PayableStatus.CANCELADO, cancelledAt: new Date() },
        });
        await tx.saleCommission.updateMany({
          where: { organizationId: actor.organizationId, saleId: sale.id },
          data: { status: SaleCommissionStatus.CANCELADA },
        });
        const cancelledAt = new Date();
        await tx.sale.update({
          where: { id: sale.id },
          data: { status: SaleStatus.DISTRATADA, cancelledAt },
        });
        await tx.unit.updateMany({
          where: {
            id: sale.unitId,
            organizationId: actor.organizationId,
            status: { in: [UnitStatus.VENDIDA, UnitStatus.QUITADA] },
          },
          data: { status: UnitStatus.DISTRATADA },
        });
        const cancellation = await tx.saleCancellation.create({
          data: {
            organizationId: actor.organizationId,
            saleId: sale.id,
            reason: dto.reason.trim(),
            cancelledByUserId: actor.id,
          },
        });
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.SALE_CANCELLED,
            entityType: AUDIT_ENTITY_TYPES.SALE,
            entityId: sale.id,
            metadata: {
              cancellationId: cancellation.id,
              reason: dto.reason.trim(),
              cancelledReceivables: receivableIds.length,
              cancelledCommissions: commissionIds.length,
            },
          },
          tx,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.sales.findOne(id, actor.organizationId);
  }
}
