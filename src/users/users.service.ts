import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { acquireTransactionAdvisoryLock } from '../prisma/advisory-lock';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  invitedAt: true,
  acceptedAt: true,
  personId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

interface UserActor {
  id: string;
  organizationId: string;
  role: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(organizationId: string, query: ListUsersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(query.role ? { role: query.role } : {}),
      ...(typeof query.isActive === 'boolean'
        ? { isActive: query.isActive }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.user.findMany({
      where,
      select: SAFE_USER_SELECT,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
  }

  async findOne(id: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  async updateRole(id: string, actor: UserActor, role: UserRole) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, actor.organizationId);
      const target = await this.findTarget(tx, id, actor.organizationId);

      this.assertAdminCanAlterTarget(actor, target.role, role);

      if (target.role === role) {
        return target;
      }

      if (
        target.role === UserRole.OWNER &&
        target.isActive &&
        role !== UserRole.OWNER
      ) {
        await this.assertAnotherActiveOwner(tx, actor.organizationId, id);
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: {
          role,
          tokenVersion: { increment: 1 },
        },
        select: SAFE_USER_SELECT,
      });

      await this.auditService.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.USER,
          entityId: id,
          metadata: {
            oldRole: target.role,
            newRole: role,
          },
        },
        tx,
      );

      return updatedUser;
    });
  }

  async updateStatus(id: string, actor: UserActor, isActive: boolean) {
    if (id === actor.id && !isActive) {
      throw new BadRequestException(
        'Você não pode desativar o próprio usuário',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, actor.organizationId);
      const target = await this.findTarget(tx, id, actor.organizationId);

      this.assertAdminCanAlterTarget(actor, target.role);

      if (target.isActive === isActive) {
        return target;
      }

      if (target.role === UserRole.OWNER && target.isActive && !isActive) {
        await this.assertAnotherActiveOwner(tx, actor.organizationId, id);
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: {
          isActive,
          tokenVersion: { increment: 1 },
        },
        select: SAFE_USER_SELECT,
      });

      await this.auditService.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: isActive
            ? AUDIT_ACTIONS.USER_ACTIVATED
            : AUDIT_ACTIONS.USER_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.USER,
          entityId: id,
          metadata: {
            oldIsActive: target.isActive,
            newIsActive: isActive,
          },
        },
        tx,
      );

      return updatedUser;
    });
  }

  private async lockOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    const lockKey = `users:${organizationId}`;
    await acquireTransactionAdvisoryLock(tx, lockKey);
  }

  private async findTarget(
    tx: Prisma.TransactionClient,
    id: string,
    organizationId: string,
  ) {
    const user = await tx.user.findFirst({
      where: { id, organizationId },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  private assertAdminCanAlterTarget(
    actor: UserActor,
    targetRole: UserRole,
    nextRole?: UserRole,
  ) {
    if (
      actor.role === UserRole.ADMIN &&
      (targetRole === UserRole.OWNER || nextRole === UserRole.OWNER)
    ) {
      throw new ForbiddenException('ADMIN não pode alterar um OWNER');
    }
  }

  private async assertAnotherActiveOwner(
    tx: Prisma.TransactionClient,
    organizationId: string,
    targetId: string,
  ) {
    const otherActiveOwners = await tx.user.count({
      where: {
        organizationId,
        role: UserRole.OWNER,
        isActive: true,
        id: { not: targetId },
      },
    });

    if (otherActiveOwners === 0) {
      throw new ConflictException(
        'O último OWNER ativo não pode ser desativado ou rebaixado',
      );
    }
  }
}
