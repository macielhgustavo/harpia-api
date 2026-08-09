import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DevelopmentStatus, DevelopmentType, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDevelopmentDto } from './dto/create-development.dto';
import { UpdateDevelopmentDto } from './dto/update-development.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

interface LockedDevelopmentState {
  id: string;
  status: DevelopmentStatus;
}

const DEVELOPMENT_UPDATE_FIELDS: (keyof UpdateDevelopmentDto)[] = [
  'name',
  'description',
  'type',
  'companyId',
  'address',
  'city',
  'status',
  'expectedLaunchDate',
  'expectedDeliveryDate',
];

@Injectable()
export class DevelopmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    organizationId: string,
    status?: DevelopmentStatus,
    type?: DevelopmentType,
    companyId?: string,
  ) {
    const where: Prisma.DevelopmentWhereInput = { organizationId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (companyId) where.companyId = companyId;

    return this.prisma.development.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, type: true } },
        _count: { select: { units: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const development = await this.prisma.development.findFirst({
      where: { id, organizationId },
      include: {
        company: { select: { id: true, name: true, type: true } },
        unitTypes: true,
        units: { include: { unitType: { select: { id: true, name: true } } } },
        priceTables: true,
        _count: {
          select: {
            allocations: includeFinancialData,
            units: true,
          },
        },
      },
    });
    if (!development)
      throw new NotFoundException('Empreendimento não encontrado');
    return development;
  }

  async create(actor: MutationActor, dto: CreateDevelopmentDto) {
    if (dto.companyId) {
      await this.assertCompanyInOrg(dto.companyId, actor.organizationId);
    }

    return this.prisma.$transaction(async (tx) => {
      const development = await tx.development.create({
        data: {
          organizationId: actor.organizationId,
          name: dto.name,
          description: dto.description,
          type: dto.type,
          companyId: dto.companyId,
          address: dto.address,
          city: dto.city,
          status: dto.status,
          expectedLaunchDate: dto.expectedLaunchDate
            ? new Date(dto.expectedLaunchDate)
            : undefined,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : undefined,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
          entityId: development.id,
        },
        tx,
      );
      return development;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateDevelopmentDto) {
    if (dto.companyId) {
      await this.assertCompanyInOrg(dto.companyId, actor.organizationId);
    }

    const changedFields = DEVELOPMENT_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    return this.prisma.$transaction(async (tx) => {
      const [existing] = await tx.$queryRaw<LockedDevelopmentState[]>`
        SELECT "id", "status"
        FROM "Development"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!existing) {
        throw new NotFoundException('Empreendimento não encontrado');
      }

      const statusChange =
        dto.status !== undefined && dto.status !== existing.status
          ? { oldStatus: existing.status, newStatus: dto.status }
          : {};
      const development = await tx.development.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          type: dto.type,
          companyId: dto.companyId,
          address: dto.address,
          city: dto.city,
          status: dto.status,
          expectedLaunchDate: dto.expectedLaunchDate
            ? new Date(dto.expectedLaunchDate)
            : undefined,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : undefined,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
          entityId: development.id,
          metadata: { changedFields, ...statusChange },
        },
        tx,
      );
      return development;
    });
  }

  async remove(id: string, actor: MutationActor) {
    return this.prisma.$transaction(async (tx) => {
      const [lockedDevelopment] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Development"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!lockedDevelopment) {
        throw new NotFoundException('Empreendimento não encontrado');
      }

      const allocations = await tx.allocation.count({
        where: { developmentId: id },
      });
      if (allocations > 0) {
        throw new ConflictException(
          'Empreendimento possui vínculos existentes e não pode ser removido',
        );
      }

      // Os locks dos filhos impedem novos UnitPrices durante a coleta.
      const cascadedUnits = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Unit"
        WHERE "developmentId" = ${id}
          AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      const cascadedPriceTables = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "PriceTable"
        WHERE "developmentId" = ${id}
          AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      const cascadedUnitPrices = await tx.unitPrice.findMany({
        where: {
          organizationId: actor.organizationId,
          OR: [
            { unit: { developmentId: id } },
            { priceTable: { developmentId: id } },
          ],
        },
        select: { id: true, unitId: true, priceTableId: true },
      });
      const development = await tx.development.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
          entityId: development.id,
        },
        tx,
      );
      const cascadeSource = {
        entityType: AUDIT_ENTITY_TYPES.DEVELOPMENT,
        entityId: development.id,
      };
      await this.audit.recordMany(
        [
          ...cascadedUnits.map((unit) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DELETE,
            entityType: AUDIT_ENTITY_TYPES.UNIT,
            entityId: unit.id,
            metadata: { cascadeSource },
          })),
          ...cascadedPriceTables.map((priceTable) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DELETE,
            entityType: AUDIT_ENTITY_TYPES.PRICE_TABLE,
            entityId: priceTable.id,
            metadata: { cascadeSource },
          })),
          ...cascadedUnitPrices.map((unitPrice) => ({
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
        ],
        tx,
      );
      return development;
    });
  }

  private async ensureExists(id: string, organizationId: string) {
    const development = await this.prisma.development.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true },
    });
    if (!development) {
      throw new NotFoundException('Empreendimento não encontrado');
    }
    return development;
  }

  private async assertCompanyInOrg(companyId: string, organizationId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, organizationId },
      select: { id: true },
    });
    if (!company) {
      throw new BadRequestException('Empresa inválida para esta organização');
    }
  }
}
