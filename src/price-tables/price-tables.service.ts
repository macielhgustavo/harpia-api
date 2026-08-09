import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { acquireTransactionAdvisoryLock } from '../prisma/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePriceTableDto } from './dto/create-price-table.dto';
import { UpdatePriceTableDto } from './dto/update-price-table.dto';
import { SetUnitPriceDto } from './dto/set-unit-price.dto';
import { UpdateUnitPriceDto } from './dto/update-unit-price.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

const PRICE_TABLE_UPDATE_FIELDS: (keyof UpdatePriceTableDto)[] = [
  'name',
  'phase',
  'active',
];

@Injectable()
export class PriceTablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- PriceTables -----------------------------------------------------------

  async findAll(organizationId: string, developmentId: string) {
    if (!developmentId) {
      throw new BadRequestException('developmentId é obrigatório');
    }
    await this.assertDevelopmentInOrg(developmentId, organizationId);

    return this.prisma.priceTable.findMany({
      where: { organizationId, developmentId },
      include: { _count: { select: { unitPrices: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const priceTable = await this.prisma.priceTable.findFirst({
      where: { id, organizationId },
      include: {
        unitPrices: {
          include: {
            unit: { select: { id: true, identifier: true } },
          },
          orderBy: { unit: { identifier: 'asc' } },
        },
      },
    });
    if (!priceTable)
      throw new NotFoundException('Tabela de preço não encontrada');
    return priceTable;
  }

  async create(actor: MutationActor, dto: CreatePriceTableDto) {
    await this.assertDevelopmentInOrg(dto.developmentId, actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const priceTable = await tx.priceTable.create({
        data: {
          organizationId: actor.organizationId,
          developmentId: dto.developmentId,
          name: dto.name,
          phase: dto.phase,
          active: dto.active,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: priceTable.id,
        },
        tx,
      );
      return priceTable;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdatePriceTableDto) {
    await this.ensureTableExists(id, actor.organizationId);
    const changedFields = PRICE_TABLE_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );

    return this.prisma.$transaction(async (tx) => {
      const priceTable = await tx.priceTable.update({
        where: { id },
        data: { name: dto.name, phase: dto.phase, active: dto.active },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: priceTable.id,
          metadata: { changedFields },
        },
        tx,
      );
      return priceTable;
    });
  }

  async remove(id: string, actor: MutationActor) {
    // UnitPrice.priceTableId é onDelete Cascade — os preços da tabela são removidos.
    return this.prisma.$transaction(async (tx) => {
      const [priceTable] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "PriceTable"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!priceTable) {
        throw new NotFoundException('Tabela de preço não encontrada');
      }

      const cascadedUnitPrices = await tx.unitPrice.findMany({
        where: {
          priceTableId: id,
          organizationId: actor.organizationId,
        },
        select: { id: true, unitId: true, priceTableId: true },
      });
      const deletedPriceTable = await tx.priceTable.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: deletedPriceTable.id,
        },
        tx,
      );
      const cascadeSource = {
        entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
        entityId: deletedPriceTable.id,
      };
      await this.audit.recordMany(
        cascadedUnitPrices.map((unitPrice) => ({
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: unitPrice.priceTableId,
          metadata: {
            unitPriceId: unitPrice.id,
            unitId: unitPrice.unitId,
            cascadeSource,
          },
        })),
        tx,
      );
      return deletedPriceTable;
    });
  }

  // --- UnitPrices ------------------------------------------------------------

  async setPrice(
    priceTableId: string,
    actor: MutationActor,
    dto: SetUnitPriceDto,
  ) {
    const table = await this.prisma.priceTable.findFirst({
      where: { id: priceTableId, organizationId: actor.organizationId },
      select: { id: true, developmentId: true },
    });
    if (!table) throw new NotFoundException('Tabela de preço não encontrada');

    // A unidade precisa existir na org e pertencer ao mesmo empreendimento da tabela.
    const unit = await this.prisma.unit.findFirst({
      where: {
        id: dto.unitId,
        organizationId: actor.organizationId,
        developmentId: table.developmentId,
      },
      select: { id: true },
    });
    if (!unit) {
      throw new BadRequestException(
        'Unidade inválida para o empreendimento desta tabela',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        `unit-price:${actor.organizationId}:${priceTableId}:${dto.unitId}`,
      );
      const existing = await tx.unitPrice.findFirst({
        where: {
          organizationId: actor.organizationId,
          unitId: dto.unitId,
          priceTableId,
        },
        select: { id: true },
      });
      const unitPrice = await tx.unitPrice.upsert({
        where: {
          unitId_priceTableId: { unitId: dto.unitId, priceTableId },
        },
        create: {
          organizationId: actor.organizationId,
          unitId: dto.unitId,
          priceTableId,
          value: dto.value,
        },
        update: { value: dto.value },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: existing ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: unitPrice.priceTableId,
          metadata: {
            unitPriceId: unitPrice.id,
            unitId: unitPrice.unitId,
            ...(existing ? { changedFields: ['value'] } : {}),
          },
        },
        tx,
      );
      return unitPrice;
    });
  }

  async updatePrice(id: string, actor: MutationActor, dto: UpdateUnitPriceDto) {
    await this.ensurePriceExists(id, actor.organizationId);
    return this.prisma.$transaction(async (tx) => {
      const unitPrice = await tx.unitPrice.update({
        where: { id },
        data: { value: dto.value },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: unitPrice.priceTableId,
          metadata: {
            unitPriceId: unitPrice.id,
            unitId: unitPrice.unitId,
            changedFields: ['value'],
          },
        },
        tx,
      );
      return unitPrice;
    });
  }

  async removePrice(id: string, actor: MutationActor) {
    await this.ensurePriceExists(id, actor.organizationId);
    return this.prisma.$transaction(async (tx) => {
      const unitPrice = await tx.unitPrice.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
          entityId: unitPrice.priceTableId,
          metadata: {
            unitPriceId: unitPrice.id,
            unitId: unitPrice.unitId,
          },
        },
        tx,
      );
      return unitPrice;
    });
  }

  // --- helpers ---------------------------------------------------------------

  private async ensureTableExists(id: string, organizationId: string) {
    const table = await this.prisma.priceTable.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!table) throw new NotFoundException('Tabela de preço não encontrada');
  }

  private async ensurePriceExists(id: string, organizationId: string) {
    const price = await this.prisma.unitPrice.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!price) throw new NotFoundException('Preço não encontrado');
  }

  private async assertDevelopmentInOrg(
    developmentId: string,
    organizationId: string,
  ) {
    const development = await this.prisma.development.findFirst({
      where: { id: developmentId, organizationId },
      select: { id: true },
    });
    if (!development) {
      throw new BadRequestException(
        'Empreendimento inválido para esta organização',
      );
    }
  }
}
