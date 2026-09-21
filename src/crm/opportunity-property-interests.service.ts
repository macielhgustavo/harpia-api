import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PropertyInterestPurpose } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertOpportunityPropertyInterestDto } from './dto/upsert-opportunity-property-interest.dto';

interface CrmActor {
  id: string;
  organizationId: string;
}

interface NormalizedInterest {
  developmentId: string | null;
  unitTypeId: string | null;
  minBedrooms: number | null;
  maxBedrooms: number | null;
  minArea: number | null;
  maxArea: number | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  availableDownPayment: Prisma.Decimal | null;
  purpose: PropertyInterestPurpose | null;
  notes: string | null;
}

const INTEREST_INCLUDE = {
  development: { select: { id: true, name: true } },
  unitType: {
    select: {
      id: true,
      name: true,
      developmentId: true,
      bedrooms: true,
      standardArea: true,
    },
  },
} as const satisfies Prisma.OpportunityPropertyInterestInclude;

type InterestWithRelations = Prisma.OpportunityPropertyInterestGetPayload<{
  include: typeof INTEREST_INCLUDE;
}>;

const INTEREST_FIELDS: readonly (keyof NormalizedInterest)[] = [
  'developmentId',
  'unitTypeId',
  'minBedrooms',
  'maxBedrooms',
  'minArea',
  'maxArea',
  'minPrice',
  'maxPrice',
  'availableDownPayment',
  'purpose',
  'notes',
];

@Injectable()
export class OpportunityPropertyInterestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findOne(opportunityId: string, organizationId: string) {
    await this.assertOpportunityExists(
      this.prisma,
      opportunityId,
      organizationId,
    );
    return this.prisma.opportunityPropertyInterest.findFirst({
      where: { opportunityId, organizationId },
      include: INTEREST_INCLUDE,
    });
  }

  async upsert(
    opportunityId: string,
    actor: CrmActor,
    dto: UpsertOpportunityPropertyInterestDto,
  ) {
    const data = this.normalize(dto);
    this.validateRanges(data);

    return this.prisma.$transaction(async (tx) => {
      await this.lockOpportunity(tx, opportunityId, actor.organizationId);
      await this.validateRelationships(tx, actor.organizationId, data);

      const existing = await tx.opportunityPropertyInterest.findFirst({
        where: { opportunityId, organizationId: actor.organizationId },
        include: INTEREST_INCLUDE,
      });
      const changedFields = this.changedFields(existing, data);
      if (existing && changedFields.length === 0) return existing;

      const interest = await tx.opportunityPropertyInterest.upsert({
        where: { opportunityId },
        create: {
          organizationId: actor.organizationId,
          opportunityId,
          ...data,
        },
        update: data,
        include: INTEREST_INCLUDE,
      });

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: existing
            ? AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_UPDATED
            : AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_CREATED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY_PROPERTY_INTEREST,
          entityId: interest.id,
          metadata: {
            opportunityId,
            changedFields,
            developmentId: interest.developmentId,
            unitTypeId: interest.unitTypeId,
            purpose: interest.purpose,
          },
        },
        tx,
      );
      return interest;
    });
  }

  async remove(opportunityId: string, actor: CrmActor) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOpportunity(tx, opportunityId, actor.organizationId);
      const interest = await tx.opportunityPropertyInterest.findFirst({
        where: { opportunityId, organizationId: actor.organizationId },
      });
      if (!interest) {
        throw new NotFoundException('Perfil de interesse não encontrado');
      }

      const removed = await tx.opportunityPropertyInterest.delete({
        where: { id: interest.id },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.OPPORTUNITY_PROPERTY_INTEREST_DELETED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY_PROPERTY_INTEREST,
          entityId: interest.id,
          metadata: {
            opportunityId,
            developmentId: interest.developmentId,
            unitTypeId: interest.unitTypeId,
            purpose: interest.purpose,
          },
        },
        tx,
      );
      return removed;
    });
  }

  private normalize(
    dto: UpsertOpportunityPropertyInterestDto,
  ): NormalizedInterest {
    return {
      developmentId: dto.developmentId?.trim() || null,
      unitTypeId: dto.unitTypeId?.trim() || null,
      minBedrooms: dto.minBedrooms ?? null,
      maxBedrooms: dto.maxBedrooms ?? null,
      minArea: dto.minArea ?? null,
      maxArea: dto.maxArea ?? null,
      minPrice: this.decimalOrNull(dto.minPrice),
      maxPrice: this.decimalOrNull(dto.maxPrice),
      availableDownPayment: this.decimalOrNull(dto.availableDownPayment),
      purpose: dto.purpose ?? null,
      notes: dto.notes?.trim() || null,
    };
  }

  private validateRanges(data: NormalizedInterest) {
    this.assertNonNegativeInteger(data.minBedrooms, 'Quartos mínimos');
    this.assertNonNegativeInteger(data.maxBedrooms, 'Quartos máximos');
    this.assertNonNegativeNumber(data.minArea, 'Área mínima');
    this.assertNonNegativeNumber(data.maxArea, 'Área máxima');
    this.assertNonNegativeDecimal(data.minPrice, 'Preço mínimo');
    this.assertNonNegativeDecimal(data.maxPrice, 'Preço máximo');
    this.assertNonNegativeDecimal(
      data.availableDownPayment,
      'Entrada disponível',
    );

    if (
      data.minBedrooms != null &&
      data.maxBedrooms != null &&
      data.minBedrooms > data.maxBedrooms
    ) {
      throw new BadRequestException(
        'Quartos mínimos não podem superar quartos máximos',
      );
    }
    if (
      data.minArea != null &&
      data.maxArea != null &&
      data.minArea > data.maxArea
    ) {
      throw new BadRequestException('Área mínima não pode superar área máxima');
    }
    if (
      data.minPrice &&
      data.maxPrice &&
      data.minPrice.greaterThan(data.maxPrice)
    ) {
      throw new BadRequestException(
        'Preço mínimo não pode superar preço máximo',
      );
    }
  }

  private async validateRelationships(
    tx: Prisma.TransactionClient,
    organizationId: string,
    data: NormalizedInterest,
  ) {
    if (data.unitTypeId && !data.developmentId) {
      throw new BadRequestException(
        'Selecione o empreendimento da tipologia informada',
      );
    }
    if (data.developmentId) {
      const development = await tx.development.findFirst({
        where: { id: data.developmentId, organizationId },
        select: { id: true },
      });
      if (!development) {
        throw new BadRequestException('Empreendimento inválido');
      }
    }
    if (data.unitTypeId) {
      const unitType = await tx.unitType.findFirst({
        where: {
          id: data.unitTypeId,
          organizationId,
          developmentId: data.developmentId!,
        },
        select: { id: true },
      });
      if (!unitType) {
        throw new BadRequestException(
          'A tipologia não pertence ao empreendimento informado',
        );
      }
    }
  }

  private changedFields(
    existing: InterestWithRelations | null,
    data: NormalizedInterest,
  ): string[] {
    if (!existing) {
      return INTEREST_FIELDS.filter((field) => data[field] != null);
    }
    return INTEREST_FIELDS.filter(
      (field) =>
        this.comparable(existing[field]) !== this.comparable(data[field]),
    );
  }

  private comparable(value: unknown): string | number | null {
    if (value instanceof Prisma.Decimal) return value.toFixed(2);
    return (value ?? null) as string | number | null;
  }

  private async assertOpportunityExists(
    database: PrismaService | Prisma.TransactionClient,
    opportunityId: string,
    organizationId: string,
  ) {
    const opportunity = await database.opportunity.findFirst({
      where: { id: opportunityId, organizationId },
      select: { id: true },
    });
    if (!opportunity) {
      throw new NotFoundException('Oportunidade não encontrada');
    }
  }

  private async lockOpportunity(
    tx: Prisma.TransactionClient,
    opportunityId: string,
    organizationId: string,
  ) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "Opportunity"
      WHERE "id" = ${opportunityId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!rows[0]) {
      throw new NotFoundException('Oportunidade não encontrada');
    }
  }

  private decimalOrNull(value: string | null | undefined) {
    return value == null || value === '' ? null : new Prisma.Decimal(value);
  }

  private assertNonNegativeInteger(value: number | null, label: string) {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      throw new BadRequestException(
        `${label} deve ser um inteiro não negativo`,
      );
    }
  }

  private assertNonNegativeNumber(value: number | null, label: string) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new BadRequestException(`${label} deve ser um número não negativo`);
    }
  }

  private assertNonNegativeDecimal(
    value: Prisma.Decimal | null,
    label: string,
  ) {
    if (value?.isNegative()) {
      throw new BadRequestException(`${label} não pode ser negativo`);
    }
  }
}
