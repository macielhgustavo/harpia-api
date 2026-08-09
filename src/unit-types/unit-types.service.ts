import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitTypeDto } from './dto/create-unit-type.dto';
import { UpdateUnitTypeDto } from './dto/update-unit-type.dto';

interface MutationActor {
  id: string;
  organizationId: string;
}

interface LockedUnitTypeState {
  id: string;
  developmentId: string;
}

interface LinkedUnitState {
  id: string;
}

const UNIT_TYPE_UPDATE_FIELDS: (keyof UpdateUnitTypeDto)[] = [
  'name',
  'bedrooms',
  'suites',
  'standardArea',
];

@Injectable()
export class UnitTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(organizationId: string, developmentId: string) {
    if (!developmentId) {
      throw new BadRequestException('developmentId é obrigatório');
    }
    await this.assertDevelopmentInOrg(developmentId, organizationId);
    return this.prisma.unitType.findMany({
      where: { organizationId, developmentId },
      include: { _count: { select: { units: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const unitType = await this.prisma.unitType.findFirst({
      where: { id, organizationId },
      include: { units: { select: { id: true, identifier: true } } },
    });
    if (!unitType) throw new NotFoundException('Tipologia não encontrada');
    return unitType;
  }

  async create(actor: MutationActor, dto: CreateUnitTypeDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDevelopmentInOrg(
        dto.developmentId,
        actor.organizationId,
        tx,
        true,
      );
      const unitType = await tx.unitType.create({
        data: {
          organizationId: actor.organizationId,
          developmentId: dto.developmentId,
          name: dto.name,
          bedrooms: dto.bedrooms,
          suites: dto.suites,
          standardArea: dto.standardArea,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CREATE,
          entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
          entityId: unitType.id,
          metadata: { developmentId: unitType.developmentId },
        },
        tx,
      );
      return unitType;
    });
  }

  async update(id: string, actor: MutationActor, dto: UpdateUnitTypeDto) {
    const changedFields = UNIT_TYPE_UPDATE_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockUnitType(id, actor.organizationId, tx);
        const unitType = await tx.unitType.update({
          where: { id },
          data: {
            name: dto.name,
            bedrooms: dto.bedrooms,
            suites: dto.suites,
            standardArea: dto.standardArea,
          },
        });
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.UPDATE,
            entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
            entityId: unitType.id,
            metadata: { changedFields },
          },
          tx,
        );
        return unitType;
      });
    } catch (error) {
      this.rethrowNotFound(error);
    }
  }

  async remove(id: string, actor: MutationActor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const unitType = await this.lockUnitType(id, actor.organizationId, tx);
        const linkedUnits = await tx.$queryRaw<LinkedUnitState[]>`
          SELECT "id"
          FROM "Unit"
          WHERE "unitTypeId" = ${id}
            AND "organizationId" = ${actor.organizationId}
          FOR UPDATE
        `;
        const deletedUnitType = await tx.unitType.delete({ where: { id } });
        const cascadeSource = {
          entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
          entityId: deletedUnitType.id,
        };

        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DELETE,
            entityType: AUDIT_ENTITY_TYPES.UNIT_TYPE,
            entityId: deletedUnitType.id,
            metadata: {
              developmentId: unitType.developmentId,
              detachedUnitCount: linkedUnits.length,
            },
          },
          tx,
        );
        await this.audit.recordMany(
          linkedUnits.map((unit) => ({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.UPDATE,
            entityType: AUDIT_ENTITY_TYPES.UNIT,
            entityId: unit.id,
            metadata: {
              changedFields: ['unitTypeId'],
              oldUnitTypeId: deletedUnitType.id,
              newUnitTypeId: null,
              cascadeSource,
            },
          })),
          tx,
        );
        return deletedUnitType;
      });
    } catch (error) {
      this.rethrowNotFound(error);
    }
  }

  private async lockUnitType(
    id: string,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ) {
    const [unitType] = await tx.$queryRaw<LockedUnitTypeState[]>`
      SELECT "id", "developmentId"
      FROM "UnitType"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!unitType) throw new NotFoundException('Tipologia não encontrada');
    return unitType;
  }

  private async assertDevelopmentInOrg(
    developmentId: string,
    organizationId: string,
    database: Prisma.TransactionClient | PrismaService = this.prisma,
    lock = false,
  ) {
    const development = lock
      ? (
          await database.$queryRaw<{ id: string }[]>`
            SELECT "id"
            FROM "Development"
            WHERE "id" = ${developmentId}
              AND "organizationId" = ${organizationId}
            FOR KEY SHARE
          `
        )[0]
      : await database.development.findFirst({
          where: { id: developmentId, organizationId },
          select: { id: true },
        });
    if (!development) {
      throw new BadRequestException(
        'Empreendimento inválido para esta organização',
      );
    }
  }

  private rethrowNotFound(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Tipologia não encontrada');
    }
    throw error;
  }
}
