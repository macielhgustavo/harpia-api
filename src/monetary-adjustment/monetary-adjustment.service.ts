import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReceivableStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMonetaryIndexValueDto } from './dto/create-monetary-index-value.dto';
import { CreateMonetaryIndexDto } from './dto/create-monetary-index.dto';
import { CreateReceivableAdjustmentPolicyDto } from './dto/create-receivable-adjustment-policy.dto';
import { UpdateMonetaryIndexValueDto } from './dto/update-monetary-index-value.dto';
import { UpdateMonetaryIndexDto } from './dto/update-monetary-index.dto';
import { UpdateReceivableAdjustmentPolicyDto } from './dto/update-receivable-adjustment-policy.dto';

interface Actor {
  id: string;
  organizationId: string;
}

@Injectable()
export class MonetaryAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAllMonetaryIndices(organizationId: string) {
    return this.prisma.monetaryIndex.findMany({
      where: { organizationId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async createMonetaryIndex(actor: Actor, dto: CreateMonetaryIndexDto) {
    try {
      const index = await this.prisma.monetaryIndex.create({
        data: {
          organizationId: actor.organizationId,
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          description: dto.description?.trim() || null,
          active: dto.active ?? true,
          periodicity: dto.periodicity,
        },
      });
      await this.record(actor, AUDIT_ACTIONS.MONETARY_INDEX_CREATED, AUDIT_ENTITY_TYPES.MONETARY_INDEX, index.id);
      return index;
    } catch (error) {
      this.rethrowUnique(error, 'J\u00e1 existe um \u00edndice com este nome ou c\u00f3digo');
    }
  }

  async updateMonetaryIndex(id: string, actor: Actor, dto: UpdateMonetaryIndexDto) {
    const current = await this.requireIndex(id, actor.organizationId);
    try {
      const index = await this.prisma.monetaryIndex.update({
        where: { id: current.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.periodicity !== undefined ? { periodicity: dto.periodicity } : {}),
        },
      });
      await this.record(actor, AUDIT_ACTIONS.MONETARY_INDEX_UPDATED, AUDIT_ENTITY_TYPES.MONETARY_INDEX, index.id);
      return index;
    } catch (error) {
      this.rethrowUnique(error, 'J\u00e1 existe um \u00edndice com este nome ou c\u00f3digo');
    }
  }

  async findMonetaryIndexValues(monetaryIndexId: string, organizationId: string) {
    await this.requireIndex(monetaryIndexId, organizationId);
    return this.prisma.monetaryIndexValue.findMany({
      where: { monetaryIndexId, organizationId },
      orderBy: { competence: 'desc' },
    });
  }

  async createMonetaryIndexValue(
    monetaryIndexId: string,
    actor: Actor,
    dto: CreateMonetaryIndexValueDto,
  ) {
    await this.requireIndex(monetaryIndexId, actor.organizationId);
    try {
      const value = await this.prisma.monetaryIndexValue.create({
        data: {
          organizationId: actor.organizationId,
          monetaryIndexId,
          competence: this.competence(dto.competence),
          percentage: new Prisma.Decimal(dto.percentage),
          source: dto.source?.trim() || null,
          publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
          responsibleId: actor.id,
        },
      });
      await this.record(actor, AUDIT_ACTIONS.MONETARY_INDEX_VALUE_CREATED, AUDIT_ENTITY_TYPES.MONETARY_INDEX_VALUE, value.id, { monetaryIndexId });
      return value;
    } catch (error) {
      this.rethrowUnique(error, 'J\u00e1 existe um valor para esta compet\u00eancia');
    }
  }

  async updateMonetaryIndexValue(
    monetaryIndexId: string,
    id: string,
    actor: Actor,
    dto: UpdateMonetaryIndexValueDto,
  ) {
    await this.requireIndex(monetaryIndexId, actor.organizationId);
    const current = await this.prisma.monetaryIndexValue.findFirst({
      where: { id, monetaryIndexId, organizationId: actor.organizationId },
    });
    if (!current) throw new NotFoundException('Valor do \u00edndice n\u00e3o encontrado');
    try {
      const value = await this.prisma.monetaryIndexValue.update({
        where: { id: current.id },
        data: {
          ...(dto.competence !== undefined ? { competence: this.competence(dto.competence) } : {}),
          ...(dto.percentage !== undefined ? { percentage: new Prisma.Decimal(dto.percentage) } : {}),
          ...(dto.source !== undefined ? { source: dto.source.trim() || null } : {}),
          ...(dto.publishedAt !== undefined
            ? { publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null }
            : {}),
          responsibleId: actor.id,
        },
      });
      await this.record(actor, AUDIT_ACTIONS.MONETARY_INDEX_VALUE_UPDATED, AUDIT_ENTITY_TYPES.MONETARY_INDEX_VALUE, value.id, { monetaryIndexId });
      return value;
    } catch (error) {
      this.rethrowUnique(error, 'J\u00e1 existe um valor para esta compet\u00eancia');
    }
  }

  async getPolicies(receivableId: string, organizationId: string) {
    await this.requireReceivable(receivableId, organizationId);
    return this.prisma.receivableAdjustmentPolicy.findMany({
      where: { receivableId, organizationId },
      include: { monetaryIndex: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPolicy(receivableId: string, actor: Actor, dto: CreateReceivableAdjustmentPolicyDto) {
    await Promise.all([
      this.requireReceivable(receivableId, actor.organizationId),
      this.requireIndex(dto.monetaryIndexId, actor.organizationId),
    ]);
    try {
      const policy = await this.prisma.receivableAdjustmentPolicy.create({
        data: {
          organizationId: actor.organizationId,
          receivableId,
          monetaryIndexId: dto.monetaryIndexId,
          baseDate: new Date(dto.baseDate),
          periodicity: dto.periodicity,
          lag: dto.lag ?? 0,
          active: dto.active ?? true,
        },
        include: { monetaryIndex: true },
      });
      await this.record(actor, AUDIT_ACTIONS.RECEIVABLE_ADJUSTMENT_POLICY_CREATED, AUDIT_ENTITY_TYPES.RECEIVABLE_ADJUSTMENT_POLICY, policy.id, { receivableId });
      return policy;
    } catch (error) {
      this.rethrowUnique(error, 'Este receb\u00edvel j\u00e1 possui uma pol\u00edtica');
    }
  }

  async updatePolicy(
    receivableId: string,
    id: string,
    actor: Actor,
    dto: UpdateReceivableAdjustmentPolicyDto,
  ) {
    const policy = await this.prisma.receivableAdjustmentPolicy.findFirst({
      where: { id, receivableId, organizationId: actor.organizationId },
    });
    if (!policy) throw new NotFoundException('Pol\u00edtica de ajuste n\u00e3o encontrada');
    if (dto.monetaryIndexId) await this.requireIndex(dto.monetaryIndexId, actor.organizationId);
    const updated = await this.prisma.receivableAdjustmentPolicy.update({
      where: { id: policy.id },
      data: {
        ...(dto.monetaryIndexId !== undefined ? { monetaryIndexId: dto.monetaryIndexId } : {}),
        ...(dto.baseDate !== undefined ? { baseDate: new Date(dto.baseDate) } : {}),
        ...(dto.periodicity !== undefined ? { periodicity: dto.periodicity } : {}),
        ...(dto.lag !== undefined ? { lag: dto.lag } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: { monetaryIndex: true },
    });
    await this.record(actor, AUDIT_ACTIONS.RECEIVABLE_ADJUSTMENT_POLICY_UPDATED, AUDIT_ENTITY_TYPES.RECEIVABLE_ADJUSTMENT_POLICY, updated.id, { receivableId });
    return updated;
  }

  async deletePolicy(receivableId: string, id: string, actor: Actor) {
    const policy = await this.prisma.receivableAdjustmentPolicy.findFirst({
      where: { id, receivableId, organizationId: actor.organizationId },
    });
    if (!policy) throw new NotFoundException('Pol\u00edtica de ajuste n\u00e3o encontrada');
    await this.prisma.receivableAdjustmentPolicy.delete({ where: { id: policy.id } });
    await this.record(actor, AUDIT_ACTIONS.RECEIVABLE_ADJUSTMENT_POLICY_DELETED, AUDIT_ENTITY_TYPES.RECEIVABLE_ADJUSTMENT_POLICY, policy.id, { receivableId });
    return { deleted: true };
  }

  preview(receivableId: string, organizationId: string, start: string, end: string) {
    return this.calculate(this.prisma, receivableId, organizationId, start, end);
  }

  async apply(receivableId: string, actor: Actor, start: string, end: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const startDate = this.competence(start);
        const endDate = this.competence(end);
        const existing = await tx.receivableAdjustment.findFirst({
          where: {
            organizationId: actor.organizationId,
            receivableId,
            startCompetence: startDate,
            endCompetence: endDate,
          },
        });
        if (existing) throw new ConflictException('Este per\u00edodo j\u00e1 foi aplicado ao receb\u00edvel');
        const calculation = await this.calculate(tx, receivableId, actor.organizationId, start, end);
        if (calculation.adjustedAmount.lessThan(calculation.paidAmount)) {
          throw new ConflictException('O valor corrigido n\u00e3o pode ficar abaixo do valor j\u00e1 pago');
        }
        await tx.receivable.update({
          where: { id: receivableId },
          data: { adjustedAmount: calculation.adjustedAmount },
        });
        const adjustment = await tx.receivableAdjustment.create({
          data: {
            organizationId: actor.organizationId,
            receivableId,
            previousAmount: calculation.previousAmount,
            adjustedAmount: calculation.adjustedAmount,
            difference: calculation.difference,
            startCompetence: calculation.startCompetence,
            endCompetence: calculation.endCompetence,
            indexValues: calculation.indexValues,
            appliedAt: new Date(),
            appliedById: actor.id,
          },
        });
        await this.record(actor, AUDIT_ACTIONS.RECEIVABLE_ADJUSTMENT_APPLIED, AUDIT_ENTITY_TYPES.RECEIVABLE_ADJUSTMENT, adjustment.id, {
          receivableId,
          previousAmount: calculation.previousAmount.toFixed(2),
          adjustedAmount: calculation.adjustedAmount.toFixed(2),
          startCompetence: start,
          endCompetence: end,
        }, tx);
        return adjustment;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getAdjustments(receivableId: string, organizationId: string) {
    await this.requireReceivable(receivableId, organizationId);
    return this.prisma.receivableAdjustment.findMany({
      where: { receivableId, organizationId },
      include: { appliedBy: { select: { id: true, name: true } } },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async calculate(
    database: PrismaService | Prisma.TransactionClient,
    receivableId: string,
    organizationId: string,
    startInput: string,
    endInput: string,
  ) {
    const startCompetence = this.competence(startInput);
    const endCompetence = this.competence(endInput);
    if (startCompetence > endCompetence) {
      throw new BadRequestException('A compet\u00eancia inicial deve ser anterior ou igual \u00e0 final');
    }
    const receivable = await database.receivable.findFirst({
      where: { id: receivableId, organizationId },
      include: {
        adjustmentPolicies: {
          where: { organizationId, active: true },
          include: { monetaryIndex: true },
          take: 1,
        },
      },
    });
    if (!receivable) throw new NotFoundException('Receb\u00edvel n\u00e3o encontrado');
    if (receivable.status === ReceivableStatus.CANCELADO) {
      throw new ConflictException('N\u00e3o \u00e9 poss\u00edvel corrigir um receb\u00edvel cancelado');
    }
    const policy = receivable.adjustmentPolicies[0];
    if (!policy) throw new ConflictException('O receb\u00edvel n\u00e3o possui uma pol\u00edtica ativa');
    const effectiveStart = startCompetence < policy.baseDate ? policy.baseDate : startCompetence;
    const values = await database.monetaryIndexValue.findMany({
      where: {
        organizationId,
        monetaryIndexId: policy.monetaryIndexId,
        competence: { gte: effectiveStart, lte: endCompetence },
      },
      orderBy: { competence: 'asc' },
    });
    if (!values.length) throw new BadRequestException('N\u00e3o h\u00e1 valores de \u00edndice no per\u00edodo informado');
    let factor = new Prisma.Decimal(1);
    const indexValues: Prisma.JsonObject = {};
    for (const value of values) {
      factor = factor.times(new Prisma.Decimal(1).plus(value.percentage));
      indexValues[value.competence.toISOString().slice(0, 7)] = value.percentage.toString();
    }
    const previousAmount = receivable.adjustedAmount;
    const adjustedAmount = previousAmount.times(factor).toDecimalPlaces(2);
    return {
      receivableId,
      monetaryIndex: { id: policy.monetaryIndex.id, name: policy.monetaryIndex.name, code: policy.monetaryIndex.code },
      previousAmount,
      adjustedAmount,
      difference: adjustedAmount.minus(previousAmount),
      paidAmount: receivable.paidAmount,
      factor,
      startCompetence,
      endCompetence,
      indexValues,
    };
  }

  private async requireIndex(id: string, organizationId: string) {
    const index = await this.prisma.monetaryIndex.findFirst({ where: { id, organizationId } });
    if (!index) throw new NotFoundException('\u00cdndice monet\u00e1rio n\u00e3o encontrado');
    return index;
  }

  private async requireReceivable(id: string, organizationId: string) {
    const receivable = await this.prisma.receivable.findFirst({ where: { id, organizationId } });
    if (!receivable) throw new NotFoundException('Receb\u00edvel n\u00e3o encontrado');
    return receivable;
  }

  private competence(value: string) {
    return new Date(`${value}-01T00:00:00.000Z`);
  }

  private record(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action,
      entityType,
      entityId,
      metadata,
    }, tx);
  }

  private rethrowUnique(error: unknown, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw error;
  }
}
