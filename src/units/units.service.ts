import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { documentPublicSelect } from '../documents/document-response';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

interface LockedUnitState {
  id: string;
  developmentId: string;
  status: UnitStatus;
}

const UNIT_UPDATE_FIELDS: (keyof UpdateUnitDto)[] = [
  'identifier',
  'unitTypeId',
  'category',
  'grouping',
  'landArea',
  'builtArea',
  'parkingSpots',
  'status',
  'notes',
];

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    organizationId: string,
    developmentId: string,
    status?: UnitStatus,
    grouping?: string,
  ) {
    if (!developmentId) {
      throw new BadRequestException('developmentId é obrigatório');
    }
    await this.assertDevelopmentInOrg(developmentId, organizationId);

    const where: Prisma.UnitWhereInput = { organizationId, developmentId };
    if (status) where.status = status;
    if (grouping) where.grouping = grouping;

    return this.prisma.unit.findMany({
      where,
      include: {
        unitType: { select: { id: true, name: true } },
        prices: {
          include: { priceTable: { select: { id: true, name: true } } },
        },
      },
      orderBy: { identifier: 'asc' },
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const unit = await this.prisma.unit.findFirst({
      where: { id, organizationId },
      include: {
        unitType: { select: { id: true, name: true } },
        prices: {
          include: {
            priceTable: { select: { id: true, name: true, phase: true } },
          },
        },
        documents: {
          where: includeFinancialData ? undefined : { investmentId: null },
          select: documentPublicSelect,
        },
      },
    });
    if (!unit) throw new NotFoundException('Unidade não encontrada');
    return unit;
  }

  async create(actor: MutationActor, dto: CreateUnitDto) {
    this.assertReservationManagedStatus(dto.status);
    await this.assertDevelopmentInOrg(dto.developmentId, actor.organizationId);
    if (dto.unitTypeId) {
      await this.assertUnitTypeInDevelopment(
        dto.unitTypeId,
        dto.developmentId,
        actor.organizationId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.create({
        data: {
          organizationId: actor.organizationId,
          developmentId: dto.developmentId,
          identifier: dto.identifier,
          unitTypeId: dto.unitTypeId,
          category: dto.category,
          grouping: dto.grouping,
          landArea: dto.landArea,
          builtArea: dto.builtArea,
          parkingSpots: dto.parkingSpots,
          status: dto.status,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: unit.id,
        },
        tx,
      );
      return unit;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateUnitDto) {
    this.assertReservationManagedStatus(dto.status);
    const changedFields = UNIT_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );
    return this.prisma.$transaction(async (tx) => {
      let preflightDevelopmentId: string | undefined;
      if (typeof dto.unitTypeId === 'string') {
        const preflightUnit = await tx.unit.findFirst({
          where: { id, organizationId: actor.organizationId },
          select: { id: true, developmentId: true },
        });
        if (!preflightUnit) {
          throw new NotFoundException('Unidade não encontrada');
        }
        preflightDevelopmentId = preflightUnit.developmentId;

        const [unitType] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "UnitType"
          WHERE "id" = ${dto.unitTypeId}
            AND "organizationId" = ${actor.organizationId}
            AND "developmentId" = ${preflightUnit.developmentId}
          FOR KEY SHARE
        `;
        if (!unitType) {
          throw new BadRequestException(
            'Tipologia inválida para este empreendimento',
          );
        }
      }

      const [unit] = await tx.$queryRaw<LockedUnitState[]>`
        SELECT "id", "developmentId", "status"
        FROM "Unit"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!unit) throw new NotFoundException('Unidade não encontrada');

      if (unit.status === UnitStatus.RESERVADA && dto.status !== undefined) {
        throw new ConflictException(
          'O status de uma unidade reservada só pode mudar pelo fluxo de reservas',
        );
      }

      if (
        preflightDevelopmentId !== undefined &&
        unit.developmentId !== preflightDevelopmentId
      ) {
        throw new BadRequestException(
          'Tipologia inválida para este empreendimento',
        );
      }

      const statusChange =
        dto.status !== undefined && dto.status !== unit.status
          ? { oldStatus: unit.status, newStatus: dto.status }
          : {};
      const updatedUnit = await tx.unit.update({
        where: { id },
        data: {
          identifier: dto.identifier,
          unitTypeId: dto.unitTypeId,
          category: dto.category,
          grouping: dto.grouping,
          landArea: dto.landArea,
          builtArea: dto.builtArea,
          parkingSpots: dto.parkingSpots,
          status: dto.status,
          notes: dto.notes,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.UPDATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: updatedUnit.id,
          metadata: { changedFields, ...statusChange },
        },
        tx,
      );
      return updatedUnit;
    });
  }

  async remove(id: string, actor: MutationActor) {
    // UnitPrice.unitId é onDelete Cascade — os preços da unidade são removidos.
    return this.prisma.$transaction(async (tx) => {
      const [unit] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Unit"
        WHERE "id" = ${id} AND "organizationId" = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!unit) throw new NotFoundException('Unidade não encontrada');

      const reservations = await tx.unitReservation.count({
        where: { unitId: id, organizationId: actor.organizationId },
      });
      if (reservations > 0) {
        throw new ConflictException(
          'Unidade possui histórico de reservas e não pode ser removida',
        );
      }

      const cascadedUnitPrices = await tx.unitPrice.findMany({
        where: { unitId: id, organizationId: actor.organizationId },
        select: { id: true, unitId: true, priceTableId: true },
      });
      const deletedUnit = await tx.unit.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DELETE,
          entityType: AUDIT_ENTITY_TYPES.UNIT,
          entityId: deletedUnit.id,
        },
        tx,
      );
      const cascadeSource = {
        entityType: AUDIT_ENTITY_TYPES.UNIT,
        entityId: deletedUnit.id,
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
      return deletedUnit;
    });
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

  private assertReservationManagedStatus(status?: UnitStatus) {
    if (status === UnitStatus.RESERVADA) {
      throw new BadRequestException(
        'O status RESERVADA só pode ser definido pelo fluxo de reservas',
      );
    }
  }

  private async assertUnitTypeInDevelopment(
    unitTypeId: string,
    developmentId: string,
    organizationId: string,
  ) {
    const unitType = await this.prisma.unitType.findFirst({
      where: { id: unitTypeId, organizationId, developmentId },
      select: { id: true },
    });
    if (!unitType) {
      throw new BadRequestException(
        'Tipologia inválida para este empreendimento',
      );
    }
  }
}
