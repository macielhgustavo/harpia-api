import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ALLOW_AUTHENTICATED_KEY } from '../decorators/allow-authenticated.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Permission } from './permissions';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';
import { ROLE_PERMISSIONS } from './role-permissions';

interface PermissionUser {
  id?: unknown;
  role?: unknown;
}

interface PermissionRequest {
  user?: PermissionUser;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && Object.hasOwn(ROLE_PERMISSIONS, value);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadataTargets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      metadataTargets,
    );

    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<
      readonly Permission[]
    >(REQUIRED_PERMISSIONS_KEY, metadataTargets);

    const request = context.switchToHttp().getRequest<PermissionRequest>();
    const user = request.user;

    if (!requiredPermissions?.length) {
      const allowAuthenticated = this.reflector.getAllAndOverride<boolean>(
        ALLOW_AUTHENTICATED_KEY,
        metadataTargets,
      );
      if (allowAuthenticated && user) {
        return true;
      }

      this.logger.warn(
        JSON.stringify({
          event: 'authorization.permission_metadata_missing',
          controller: context.getClass().name,
          handler: context.getHandler().name,
        }),
      );
      throw new ForbiddenException(
        'Você não tem permissão para realizar esta ação.',
      );
    }

    const role = isUserRole(user?.role) ? user.role : undefined;
    const grantedPermissions = role ? ROLE_PERMISSIONS[role] : [];
    const missingPermissions = requiredPermissions.filter(
      (permission) => !grantedPermissions.includes(permission),
    );

    if (missingPermissions.length === 0) {
      return true;
    }

    this.logger.warn(
      JSON.stringify({
        event: 'authorization.permission_denied',
        userId: typeof user?.id === 'string' ? user.id : undefined,
        role: role ?? 'UNKNOWN',
        controller: context.getClass().name,
        handler: context.getHandler().name,
        missingPermissions,
      }),
    );

    throw new ForbiddenException(
      'Você não tem permissão para realizar esta ação.',
    );
  }
}
