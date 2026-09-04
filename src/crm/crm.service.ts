import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PersonRoleType, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditEntry, AuditService } from '../audit/audit.service';
import { acquireTransactionAdvisoryLock } from '../prisma/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import {
  CreateSalesPipelineDto,
  CreateSalesStageDto,
} from './dto/create-sales-pipeline.dto';
import { CreateSalesActivityDto } from './dto/create-sales-activity.dto';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';
import { ListSalesActivitiesQueryDto } from './dto/list-sales-activities-query.dto';
import { MoveOpportunityDto } from './dto/move-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { UpdateSalesActivityDto } from './dto/update-sales-activity.dto';

interface CrmActor {
  id: string;
  organizationId: string;
}

interface LockedOpportunity {
  id: string;
  personId: string;
  pipelineId: string;
  stageId: string;
  assignedUserId: string | null;
  developmentId: string | null;
  unitId: string | null;
}

interface LockedActivity {
  id: string;
  assignedUserId: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
}

const DEFAULT_STAGES: readonly CreateSalesStageDto[] = [
  {
    name: 'Novo',
    code: 'NOVO',
    position: 0,
    colorKey: 'slate',
    defaultProbability: 5,
  },
  {
    name: 'Contato inicial',
    code: 'CONTATO_INICIAL',
    position: 1,
    colorKey: 'blue',
    defaultProbability: 15,
  },
  {
    name: 'Qualificado',
    code: 'QUALIFICADO',
    position: 2,
    colorKey: 'cyan',
    defaultProbability: 30,
  },
  {
    name: 'Visita',
    code: 'VISITA',
    position: 3,
    colorKey: 'violet',
    defaultProbability: 50,
  },
  {
    name: 'Proposta',
    code: 'PROPOSTA',
    position: 4,
    colorKey: 'amber',
    defaultProbability: 70,
  },
  {
    name: 'Negociação',
    code: 'NEGOCIACAO',
    position: 5,
    colorKey: 'orange',
    defaultProbability: 85,
  },
  {
    name: 'Ganho',
    code: 'GANHO',
    position: 6,
    colorKey: 'green',
    defaultProbability: 100,
    isWon: true,
  },
  {
    name: 'Perdido',
    code: 'PERDIDO',
    position: 7,
    colorKey: 'red',
    defaultProbability: 0,
    isLost: true,
  },
];

const OPPORTUNITY_INCLUDE = {
  person: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      roles: { select: { id: true, role: true } },
    },
  },
  pipeline: { select: { id: true, name: true } },
  stage: true,
  assignedUser: { select: { id: true, name: true, email: true } },
  development: { select: { id: true, name: true } },
  unit: { select: { id: true, identifier: true, developmentId: true } },
  _count: { select: { activities: true, stageHistory: true } },
} as const satisfies Prisma.OpportunityInclude;

const ACTIVITY_INCLUDE = {
  opportunity: {
    select: { id: true, stageId: true, developmentId: true, unitId: true },
  },
  person: { select: { id: true, name: true, email: true, phone: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.SalesActivityInclude;

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findPipelines(organizationId: string) {
    await this.ensureDefaultPipeline(organizationId);
    return this.prisma.salesPipeline.findMany({
      where: { organizationId, isActive: true },
      include: { stages: { orderBy: { position: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createPipeline(actor: CrmActor, dto: CreateSalesPipelineDto) {
    const stages = dto.stages ?? [...DEFAULT_STAGES];
    this.validatePipelineStages(stages);
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        `crm:pipelines:${actor.organizationId}`,
      );
      const duplicate = await tx.salesPipeline.findFirst({
        where: {
          organizationId: actor.organizationId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Já existe um pipeline com este nome');
      }
      const pipeline = await tx.salesPipeline.create({
        data: {
          organizationId: actor.organizationId,
          name: dto.name.trim(),
          stages: {
            create: stages.map((stage) => ({
              organizationId: actor.organizationId,
              name: stage.name.trim(),
              code: stage.code,
              position: stage.position,
              colorKey: stage.colorKey,
              defaultProbability: stage.defaultProbability ?? 0,
              isWon: stage.isWon ?? false,
              isLost: stage.isLost ?? false,
            })),
          },
        },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.CRM_PIPELINE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_PIPELINE,
          entityId: pipeline.id,
          metadata: { stageCount: pipeline.stages.length },
        },
        tx,
      );
      return pipeline;
    });
  }

  async findOpportunities(
    organizationId: string,
    query: ListOpportunitiesQueryDto,
  ) {
    await this.ensureDefaultPipeline(organizationId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.OpportunityWhereInput = {
      organizationId,
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.developmentId ? { developmentId: query.developmentId } : {}),
      ...(query.personId ? { personId: query.personId } : {}),
      ...(query.source
        ? { source: { equals: query.source, mode: 'insensitive' } }
        : {}),
      ...(search
        ? {
            OR: [
              { person: { name: { contains: search, mode: 'insensitive' } } },
              { person: { email: { contains: search, mode: 'insensitive' } } },
              { source: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              {
                unit: {
                  identifier: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        include: OPPORTUNITY_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOpportunity(id: string, organizationId: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId },
      include: OPPORTUNITY_INCLUDE,
    });
    if (!opportunity)
      throw new NotFoundException('Oportunidade não encontrada');
    return opportunity;
  }

  async createOpportunity(actor: CrmActor, dto: CreateOpportunityDto) {
    const defaultPipeline = dto.pipelineId
      ? null
      : await this.ensureDefaultPipeline(actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const person = await this.assertPerson(
        tx,
        dto.personId,
        actor.organizationId,
      );
      const pipelineId = dto.pipelineId ?? defaultPipeline!.id;
      const stage = await this.resolveInitialStage(
        tx,
        pipelineId,
        dto.stageId,
        actor.organizationId,
      );
      if (stage.isWon || stage.isLost) {
        throw new BadRequestException(
          'Uma oportunidade não pode nascer em etapa terminal',
        );
      }
      await this.assertAssignedUser(
        tx,
        dto.assignedUserId,
        actor.organizationId,
      );
      const target = await this.resolveSalesTarget(
        tx,
        actor.organizationId,
        dto.developmentId ?? null,
        dto.unitId ?? null,
      );
      await tx.personRole.upsert({
        where: {
          personId_role: { personId: person.id, role: PersonRoleType.LEAD },
        },
        update: {},
        create: {
          organizationId: actor.organizationId,
          personId: person.id,
          role: PersonRoleType.LEAD,
        },
      });
      const opportunity = await tx.opportunity.create({
        data: {
          organizationId: actor.organizationId,
          personId: person.id,
          pipelineId,
          stageId: stage.id,
          assignedUserId: dto.assignedUserId,
          developmentId: target.developmentId,
          unitId: target.unitId,
          source: dto.source || null,
          estimatedValue: this.decimalOrNull(dto.estimatedValue),
          probability: dto.probability ?? stage.defaultProbability,
          nextContactAt: this.dateOrNull(dto.nextContactAt),
          expectedCloseDate: this.dateOrNull(dto.expectedCloseDate),
          notes: dto.notes || null,
        },
        include: OPPORTUNITY_INCLUDE,
      });
      await tx.opportunityStageHistory.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: opportunity.id,
          toStageId: stage.id,
          changedByUserId: actor.id,
        },
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.OPPORTUNITY_CREATED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
          entityId: opportunity.id,
          metadata: {
            personId: person.id,
            pipelineId,
            stageId: stage.id,
            developmentId: target.developmentId,
            unitId: target.unitId,
          },
        },
        tx,
      );
      return opportunity;
    });
  }

  async updateOpportunity(
    id: string,
    actor: CrmActor,
    dto: UpdateOpportunityDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpportunity(tx, id, actor.organizationId);
      const personId = dto.personId ?? current.personId;
      const person = await this.assertPerson(
        tx,
        personId,
        actor.organizationId,
      );
      await this.assertAssignedUser(
        tx,
        dto.assignedUserId === undefined
          ? (current.assignedUserId ?? undefined)
          : (dto.assignedUserId ?? undefined),
        actor.organizationId,
      );
      const target = await this.resolveSalesTarget(
        tx,
        actor.organizationId,
        dto.developmentId === undefined
          ? current.developmentId
          : dto.developmentId,
        dto.unitId === undefined ? current.unitId : dto.unitId,
      );
      if (personId !== current.personId) {
        await tx.personRole.upsert({
          where: {
            personId_role: { personId: person.id, role: PersonRoleType.LEAD },
          },
          update: {},
          create: {
            organizationId: actor.organizationId,
            personId: person.id,
            role: PersonRoleType.LEAD,
          },
        });
      }
      const changedFields = Object.keys(dto).filter(
        (field) => dto[field as keyof UpdateOpportunityDto] !== undefined,
      );
      const opportunity = await tx.opportunity.update({
        where: { id },
        data: {
          personId,
          assignedUserId: dto.assignedUserId,
          developmentId: target.developmentId,
          unitId: target.unitId,
          source: dto.source,
          estimatedValue:
            dto.estimatedValue === undefined
              ? undefined
              : this.decimalOrNull(dto.estimatedValue),
          probability: dto.probability,
          nextContactAt:
            dto.nextContactAt === undefined
              ? undefined
              : this.dateOrNull(dto.nextContactAt),
          expectedCloseDate:
            dto.expectedCloseDate === undefined
              ? undefined
              : this.dateOrNull(dto.expectedCloseDate),
          notes: dto.notes,
        },
        include: OPPORTUNITY_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.OPPORTUNITY_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
          entityId: id,
          metadata: { changedFields },
        },
        tx,
      );
      return opportunity;
    });
  }

  async removeOpportunity(id: string, actor: CrmActor) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOpportunity(tx, id, actor.organizationId);
      const removed = await tx.opportunity.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.OPPORTUNITY_DELETED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
          entityId: id,
        },
        tx,
      );
      return removed;
    });
  }

  async moveOpportunity(id: string, actor: CrmActor, dto: MoveOpportunityDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockOpportunity(tx, id, actor.organizationId);
      const stage = await tx.salesStage.findFirst({
        where: {
          id: dto.stageId,
          organizationId: actor.organizationId,
          pipelineId: current.pipelineId,
        },
      });
      if (!stage) {
        throw new BadRequestException('Etapa inválida para este pipeline');
      }
      if (stage.id === current.stageId) {
        return tx.opportunity.findUniqueOrThrow({
          where: { id },
          include: OPPORTUNITY_INCLUDE,
        });
      }
      if (stage.isLost && !dto.lostReason?.trim()) {
        throw new BadRequestException(
          'Informe o motivo ao marcar a oportunidade como perdida',
        );
      }
      const opportunity = await tx.opportunity.update({
        where: { id },
        data: {
          stageId: stage.id,
          lostReason: stage.isLost ? dto.lostReason!.trim() : null,
          stageEnteredAt: new Date(),
        },
        include: OPPORTUNITY_INCLUDE,
      });
      await tx.opportunityStageHistory.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: id,
          fromStageId: current.stageId,
          toStageId: stage.id,
          changedByUserId: actor.id,
        },
      });
      const entries: AuditEntry[] = [
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.OPPORTUNITY_STAGE_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
          entityId: id,
          metadata: {
            fromStageId: current.stageId,
            toStageId: stage.id,
          },
        },
      ];
      if (stage.isWon || stage.isLost) {
        entries.push({
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: stage.isWon
            ? AUDIT_ACTIONS.OPPORTUNITY_WON
            : AUDIT_ACTIONS.OPPORTUNITY_LOST,
          entityType: AUDIT_ENTITY_TYPES.OPPORTUNITY,
          entityId: id,
          metadata: {
            fromStageId: current.stageId,
            toStageId: stage.id,
          },
        });
      }
      await this.audit.recordMany(entries, tx);
      return opportunity;
    });
  }

  async findOpportunityHistory(id: string, organizationId: string) {
    await this.assertOpportunityExists(id, organizationId);
    return this.prisma.opportunityStageHistory.findMany({
      where: { opportunityId: id, organizationId },
      include: {
        fromStage: { select: { id: true, name: true, code: true } },
        toStage: { select: { id: true, name: true, code: true } },
        changedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findActivities(
    organizationId: string,
    query: ListSalesActivitiesQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.SalesActivityWhereInput = {
      organizationId,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.personId ? { personId: query.personId } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.salesActivity.findMany({
        where,
        include: ACTIVITY_INCLUDE,
        orderBy: [
          { completedAt: { sort: 'asc', nulls: 'first' } },
          { scheduledAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.salesActivity.count({ where }),
    ]);
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async createActivity(actor: CrmActor, dto: CreateSalesActivityDto) {
    return this.prisma.$transaction(async (tx) => {
      const opportunity = await tx.opportunity.findFirst({
        where: { id: dto.opportunityId, organizationId: actor.organizationId },
        select: { id: true, personId: true },
      });
      if (!opportunity) throw new BadRequestException('Oportunidade inválida');
      if (dto.personId && dto.personId !== opportunity.personId) {
        throw new BadRequestException(
          'A pessoa da atividade deve ser a pessoa da oportunidade',
        );
      }
      await this.assertAssignedUser(
        tx,
        dto.assignedUserId,
        actor.organizationId,
      );
      this.assertActivityDates(dto.scheduledAt, dto.completedAt);
      const activity = await tx.salesActivity.create({
        data: {
          organizationId: actor.organizationId,
          opportunityId: opportunity.id,
          personId: opportunity.personId,
          assignedUserId: dto.assignedUserId,
          type: dto.type,
          scheduledAt: this.dateOrNull(dto.scheduledAt),
          completedAt: this.dateOrNull(dto.completedAt),
          summary: dto.summary || null,
          notes: dto.notes || null,
        },
        include: ACTIVITY_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALES_ACTIVITY_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ACTIVITY,
          entityId: activity.id,
          metadata: { opportunityId: opportunity.id },
        },
        tx,
      );
      return activity;
    });
  }

  async updateActivity(
    id: string,
    actor: CrmActor,
    dto: UpdateSalesActivityDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockActivity(tx, id, actor.organizationId);
      await this.assertAssignedUser(
        tx,
        dto.assignedUserId === undefined
          ? (current.assignedUserId ?? undefined)
          : (dto.assignedUserId ?? undefined),
        actor.organizationId,
      );
      const scheduledAt =
        dto.scheduledAt === undefined
          ? current.scheduledAt
          : this.dateOrNull(dto.scheduledAt);
      const completedAt =
        dto.completedAt === undefined
          ? current.completedAt
          : this.dateOrNull(dto.completedAt);
      this.assertActivityDates(scheduledAt, completedAt);
      const changedFields = Object.keys(dto).filter(
        (field) => dto[field as keyof UpdateSalesActivityDto] !== undefined,
      );
      const activity = await tx.salesActivity.update({
        where: { id },
        data: {
          assignedUserId: dto.assignedUserId,
          type: dto.type,
          scheduledAt,
          completedAt,
          summary: dto.summary,
          notes: dto.notes,
        },
        include: ACTIVITY_INCLUDE,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALES_ACTIVITY_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ACTIVITY,
          entityId: id,
          metadata: { changedFields },
        },
        tx,
      );
      return activity;
    });
  }

  async removeActivity(id: string, actor: CrmActor) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActivity(tx, id, actor.organizationId);
      const removed = await tx.salesActivity.delete({ where: { id } });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.SALES_ACTIVITY_DELETED,
          entityType: AUDIT_ENTITY_TYPES.SALES_ACTIVITY,
          entityId: id,
          metadata: { opportunityId: removed.opportunityId },
        },
        tx,
      );
      return removed;
    });
  }

  private async ensureDefaultPipeline(organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(
        tx,
        `crm:default-pipeline:${organizationId}`,
      );
      const existing = await tx.salesPipeline.findFirst({
        where: { organizationId, isDefault: true },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      if (existing) return existing;
      return tx.salesPipeline.create({
        data: {
          organizationId,
          name: 'Pipeline comercial',
          isDefault: true,
          stages: {
            create: DEFAULT_STAGES.map((stage) => ({
              organizationId,
              ...stage,
              isWon: stage.isWon ?? false,
              isLost: stage.isLost ?? false,
            })),
          },
        },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
    });
  }

  private validatePipelineStages(stages: readonly CreateSalesStageDto[]) {
    const codes = new Set(stages.map((stage) => stage.code));
    const positions = new Set(stages.map((stage) => stage.position));
    if (codes.size !== stages.length || positions.size !== stages.length) {
      throw new BadRequestException(
        'Códigos e posições das etapas devem ser únicos',
      );
    }
    if (stages.some((stage) => stage.isWon && stage.isLost)) {
      throw new BadRequestException(
        'Uma etapa não pode ser ganha e perdida simultaneamente',
      );
    }
    if (
      stages.filter((stage) => stage.isWon).length !== 1 ||
      stages.filter((stage) => stage.isLost).length !== 1
    ) {
      throw new BadRequestException(
        'O pipeline deve ter exatamente uma etapa ganha e uma perdida',
      );
    }
  }

  private async resolveInitialStage(
    tx: Prisma.TransactionClient,
    pipelineId: string,
    stageId: string | undefined,
    organizationId: string,
  ) {
    const pipeline = await tx.salesPipeline.findFirst({
      where: { id: pipelineId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!pipeline) throw new BadRequestException('Pipeline inválido');
    const stage = await tx.salesStage.findFirst({
      where: stageId
        ? { id: stageId, pipelineId, organizationId }
        : { pipelineId, organizationId },
      orderBy: stageId ? undefined : { position: 'asc' },
    });
    if (!stage) throw new BadRequestException('Etapa inválida');
    return stage;
  }

  private async assertPerson(
    tx: Prisma.TransactionClient,
    personId: string,
    organizationId: string,
  ) {
    const person = await tx.person.findFirst({
      where: { id: personId, organizationId },
      select: { id: true },
    });
    if (!person) {
      throw new BadRequestException('Pessoa inválida para esta organização');
    }
    return person;
  }

  private async assertAssignedUser(
    tx: Prisma.TransactionClient,
    userId: string | undefined,
    organizationId: string,
  ) {
    if (!userId) return;
    const user = await tx.user.findFirst({
      where: { id: userId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        'Responsável inválido para esta organização',
      );
    }
  }

  private async resolveSalesTarget(
    tx: Prisma.TransactionClient,
    organizationId: string,
    developmentId: string | null,
    unitId: string | null,
  ) {
    if (unitId) {
      const unit = await tx.unit.findFirst({
        where: { id: unitId, organizationId },
        select: { id: true, developmentId: true },
      });
      if (!unit) throw new BadRequestException('Unidade inválida');
      if (developmentId && developmentId !== unit.developmentId) {
        throw new BadRequestException(
          'A unidade não pertence ao empreendimento informado',
        );
      }
      return { developmentId: unit.developmentId, unitId: unit.id };
    }
    if (developmentId) {
      const development = await tx.development.findFirst({
        where: { id: developmentId, organizationId },
        select: { id: true },
      });
      if (!development)
        throw new BadRequestException('Empreendimento inválido');
    }
    return { developmentId, unitId: null };
  }

  private async lockOpportunity(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [opportunity] = await tx.$queryRaw<LockedOpportunity[]>`
      SELECT "id", "personId", "pipelineId", "stageId", "assignedUserId",
             "developmentId", "unitId"
      FROM "Opportunity"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!opportunity)
      throw new NotFoundException('Oportunidade não encontrada');
    return opportunity;
  }

  private async lockActivity(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const [activity] = await tx.$queryRaw<LockedActivity[]>`
      SELECT "id", "assignedUserId", "scheduledAt", "completedAt"
      FROM "SalesActivity"
      WHERE "id" = ${id} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `;
    if (!activity)
      throw new NotFoundException('Atividade comercial não encontrada');
    return activity;
  }

  private async assertOpportunityExists(id: string, organizationId: string) {
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!opportunity)
      throw new NotFoundException('Oportunidade não encontrada');
  }

  private assertActivityDates(
    scheduledAt: string | Date | null | undefined,
    completedAt: string | Date | null | undefined,
  ) {
    if (!scheduledAt || !completedAt) return;
    if (new Date(completedAt) < new Date(scheduledAt)) {
      throw new BadRequestException(
        'A conclusão não pode ser anterior ao agendamento',
      );
    }
  }

  private decimalOrNull(value: string | null | undefined) {
    return value ? new Prisma.Decimal(value) : null;
  }

  private dateOrNull(value: string | null | undefined) {
    return value ? new Date(value) : null;
  }
}
