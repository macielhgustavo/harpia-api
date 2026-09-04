import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryStatus,
  NotificationStatus,
  OutboxStatus,
  Prisma,
} from '@prisma/client';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationEmailService } from './email.service';

interface Actor { id: string; organizationId: string }

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: NotificationEmailService,
  ) {}

  async createForUser(
    organizationId: string,
    input: CreateNotificationDto,
    actorUserId?: string,
  ) {
    const recipient = await this.prisma.user.findFirst({
      where: { id: input.recipientUserId, organizationId, isActive: true },
      select: { id: true, email: true },
    });
    if (!recipient) throw new NotFoundException('Destinat\u00e1rio n\u00e3o encontrado');
    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        organizationId_recipientType_recipientId_type: {
          organizationId,
          recipientType: 'USER',
          recipientId: recipient.id,
          type: input.type,
        },
      },
    });
    const internalEnabled = preference?.internal ?? true;
    const emailEnabled = preference?.email ?? true;
    if (!internalEnabled && !emailEnabled) return null;

    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          organizationId,
          recipientType: 'USER',
          recipientId: recipient.id,
          title: input.title.trim(),
          message: input.message.trim(),
          type: input.type,
          channel: [internalEnabled ? 'INTERNAL' : '', emailEnabled ? 'EMAIL' : '']
            .filter(Boolean)
            .join(','),
          status: internalEnabled ? NotificationStatus.ENVIADO : NotificationStatus.PENDENTE,
          sentAt: internalEnabled ? new Date() : null,
          ...(input.data ? { data: input.data as Prisma.InputJsonValue } : {}),
        },
      });
      if (internalEnabled) {
        await tx.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            channel: 'INTERNAL',
            provider: null,
            status: DeliveryStatus.ENVIADO,
            sentAt: new Date(),
          },
        });
      }
      if (emailEnabled) {
        await tx.notificationOutbox.create({
          data: { organizationId, notificationId: notification.id },
        });
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: actorUserId ?? null,
          action: AUDIT_ACTIONS.NOTIFICATION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.NOTIFICATION,
          entityId: notification.id,
          metadata: { recipientUserId: recipient.id, type: input.type },
        },
        tx,
      );
      return notification;
    });
  }

  async list(actor: Actor, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.NotificationWhereInput = {
      organizationId: actor.organizationId,
      recipientType: 'USER',
      recipientId: actor.id,
      channel: { contains: 'INTERNAL' },
      ...(query.type ? { type: query.type } : {}),
      ...(query.state === 'unread' ? { readAt: null } : {}),
      ...(query.state === 'read' ? { readAt: { not: null } } : {}),
    };
    const [data, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          organizationId: actor.organizationId,
          recipientType: 'USER',
          recipientId: actor.id,
          channel: { contains: 'INTERNAL' },
          readAt: null,
        },
      }),
    ]);
    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: { unread },
    };
  }

  async unreadCount(actor: Actor) {
    const count = await this.prisma.notification.count({
      where: {
        organizationId: actor.organizationId,
        recipientType: 'USER',
        recipientId: actor.id,
        channel: { contains: 'INTERNAL' },
        readAt: null,
      },
    });
    return { count };
  }

  async findOne(id: string, actor: Actor) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        recipientType: 'USER',
        recipientId: actor.id,
        channel: { contains: 'INTERNAL' },
      },
    });
    if (!notification) throw new NotFoundException('Notifica\u00e7\u00e3o n\u00e3o encontrada');
    return notification;
  }

  async markRead(id: string, actor: Actor) {
    const notification = await this.findOne(id, actor);
    if (notification.readAt) return notification;
    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date(), status: NotificationStatus.LIDO },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.NOTIFICATION_READ,
      entityType: AUDIT_ENTITY_TYPES.NOTIFICATION,
      entityId: notification.id,
    });
    return updated;
  }

  async markAllRead(actor: Actor) {
    const result = await this.prisma.notification.updateMany({
      where: {
        organizationId: actor.organizationId,
        recipientType: 'USER',
        recipientId: actor.id,
        channel: { contains: 'INTERNAL' },
        readAt: null,
      },
      data: { readAt: new Date(), status: NotificationStatus.LIDO },
    });
    return { updated: result.count };
  }

  preferences(actor: Actor) {
    return this.prisma.notificationPreference.findMany({
      where: {
        organizationId: actor.organizationId,
        recipientType: 'USER',
        recipientId: actor.id,
      },
      orderBy: { type: 'asc' },
    });
  }

  async updatePreference(actor: Actor, dto: UpdateNotificationPreferenceDto) {
    if (dto.internal === undefined && dto.email === undefined) {
      throw new BadRequestException('Informe ao menos um canal');
    }
    const preference = await this.prisma.notificationPreference.upsert({
      where: {
        organizationId_recipientType_recipientId_type: {
          organizationId: actor.organizationId,
          recipientType: 'USER',
          recipientId: actor.id,
          type: dto.type,
        },
      },
      create: {
        organizationId: actor.organizationId,
        recipientType: 'USER',
        recipientId: actor.id,
        type: dto.type,
        internal: dto.internal ?? true,
        email: dto.email ?? true,
      },
      update: {
        ...(dto.internal !== undefined ? { internal: dto.internal } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCE_UPDATED,
      entityType: AUDIT_ENTITY_TYPES.NOTIFICATION_PREFERENCE,
      entityId: preference.id,
      metadata: { type: preference.type, internal: preference.internal, email: preference.email },
    });
    return preference;
  }

  async processOutbox(organizationId: string) {
    const pending = await this.prisma.notificationOutbox.findMany({
      where: {
        organizationId,
        status: OutboxStatus.PENDENTE,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let sent = 0;
    let failed = 0;
    for (const item of pending) {
      const result = await this.deliver(item.id, organizationId);
      if (result === 'sent') sent += 1;
      if (result === 'failed') failed += 1;
    }
    return { processed: pending.length, sent, failed, providerConfigured: this.email.configured };
  }

  private async deliver(id: string, organizationId: string) {
    const claimed = await this.prisma.notificationOutbox.updateMany({
      where: { id, organizationId, status: OutboxStatus.PENDENTE },
      data: { status: OutboxStatus.PROCESSANDO, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (!claimed.count) return 'skipped' as const;
    const outbox = await this.prisma.notificationOutbox.findFirst({
      where: { id, organizationId },
      include: { notification: true },
    });
    if (!outbox) return 'skipped' as const;
    try {
      if (!this.email.configured) throw new Error('Provedor de e-mail n\u00e3o configurado');
      const recipient = await this.prisma.user.findFirst({
        where: {
          id: outbox.notification.recipientId,
          organizationId,
          isActive: true,
        },
        select: { email: true },
      });
      if (!recipient) throw new Error('Destinat\u00e1rio indispon\u00edvel');
      const providerId = await this.email.send({
        notificationId: outbox.notification.id,
        to: recipient.email,
        subject: outbox.notification.title,
        message: outbox.notification.message,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.notificationDelivery.create({
          data: {
            notificationId: outbox.notification.id,
            channel: 'EMAIL',
            provider: 'RESEND',
            providerId,
            status: DeliveryStatus.ENVIADO,
            sentAt: new Date(),
          },
        });
        await tx.notificationOutbox.update({ where: { id }, data: { status: OutboxStatus.CONCLUIDO } });
        await tx.notification.update({
          where: { id: outbox.notification.id },
          data: { status: NotificationStatus.ENVIADO, sentAt: outbox.notification.sentAt ?? new Date() },
        });
        await this.audit.record({
          organizationId,
          action: AUDIT_ACTIONS.NOTIFICATION_SENT,
          entityType: AUDIT_ENTITY_TYPES.NOTIFICATION,
          entityId: outbox.notification.id,
        }, tx);
      });
      return 'sent' as const;
    } catch (error) {
      const permanent = outbox.attemptCount >= 3;
      const reason = error instanceof Error ? error.message : 'Falha desconhecida';
      await this.prisma.$transaction(async (tx) => {
        await tx.notificationOutbox.update({
          where: { id },
          data: permanent
            ? { status: OutboxStatus.FALHOU_PERMANENTEMENTE }
            : { status: OutboxStatus.PENDENTE, nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000) },
        });
        await tx.notificationDelivery.create({
          data: {
            notificationId: outbox.notification.id,
            channel: 'EMAIL',
            provider: 'RESEND',
            status: DeliveryStatus.FALHOU,
            failureReason: reason.slice(0, 1000),
          },
        });
        if (permanent && !outbox.notification.channel.includes('INTERNAL')) {
          await tx.notification.update({ where: { id: outbox.notification.id }, data: { status: NotificationStatus.FALHOU } });
        }
        await this.audit.record({
          organizationId,
          action: AUDIT_ACTIONS.NOTIFICATION_DELIVERY_FAILED,
          entityType: AUDIT_ENTITY_TYPES.NOTIFICATION,
          entityId: outbox.notification.id,
          metadata: { reason, attempt: outbox.attemptCount },
        }, tx);
      });
      return 'failed' as const;
    }
  }
}
