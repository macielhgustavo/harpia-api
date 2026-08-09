import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { sanitizeAuditMetadata } from './audit-metadata.sanitizer';

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const AUDIT_BATCH_SIZE = 500;
const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SAFE_AUDIT_LOG_SELECT = {
  id: true,
  organizationId: true,
  actorUserId: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  actor: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organizationId: true,
    },
  },
} as const satisfies Prisma.AuditLogSelect;

type SelectedAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof SAFE_AUDIT_LOG_SELECT;
}>;

function presentAuditLog(auditLog: SelectedAuditLog) {
  const actor =
    auditLog.actor?.organizationId === auditLog.organizationId
      ? {
          id: auditLog.actor.id,
          name: auditLog.actor.name,
          email: auditLog.actor.email,
          role: auditLog.actor.role,
        }
      : null;

  return {
    id: auditLog.id,
    organizationId: auditLog.organizationId,
    actorUserId: actor ? auditLog.actorUserId : null,
    action: auditLog.action,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    metadata: auditLog.metadata,
    createdAt: auditLog.createdAt,
    actor,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const database = tx ?? this.prisma;
    return database.auditLog.create({
      data: this.toCreateInput(entry),
    });
  }

  async recordMany(entries: AuditEntry[], tx?: Prisma.TransactionClient) {
    if (entries.length === 0) return { count: 0 };

    const database = tx ?? this.prisma;
    let count = 0;
    for (let offset = 0; offset < entries.length; offset += AUDIT_BATCH_SIZE) {
      const result = await database.auditLog.createMany({
        data: entries
          .slice(offset, offset + AUDIT_BATCH_SIZE)
          .map((entry) => this.toCreateInput(entry)),
      });
      count += result.count;
    }
    return { count };
  }

  async findAll(organizationId: string, query: ListAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const createdAt = this.createdAtFilter(query.startDate, query.endDate);
    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [auditLogs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: SAFE_AUDIT_LOG_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: auditLogs.map(presentAuditLog),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string, organizationId: string) {
    const auditLog = await this.prisma.auditLog.findFirst({
      where: { id, organizationId },
      select: SAFE_AUDIT_LOG_SELECT,
    });

    if (!auditLog) {
      throw new NotFoundException('Registro de auditoria não encontrado');
    }

    return presentAuditLog(auditLog);
  }

  private createdAtFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;

    const start = startDate ? this.parseDateBoundary(startDate) : undefined;
    const end = endDate ? this.parseDateBoundary(endDate) : undefined;
    const endIsDateOnly = Boolean(
      endDate && ISO_DATE_ONLY_PATTERN.test(endDate),
    );
    const endExclusive =
      end && endIsDateOnly ? this.nextUtcDay(end) : undefined;

    if (start && end && (endExclusive ? start >= endExclusive : start > end)) {
      throw new BadRequestException(
        'startDate deve ser anterior ou igual a endDate',
      );
    }

    return {
      ...(start ? { gte: start } : {}),
      ...(endExclusive ? { lt: endExclusive } : end ? { lte: end } : {}),
    };
  }

  private parseDateBoundary(value: string) {
    return ISO_DATE_ONLY_PATTERN.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(value);
  }

  private nextUtcDay(date: Date) {
    const nextDay = new Date(date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return nextDay;
  }

  private toCreateInput(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
    return {
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.metadata
        ? { metadata: sanitizeAuditMetadata(entry.metadata) }
        : {}),
    };
  }
}
