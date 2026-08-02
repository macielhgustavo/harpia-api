import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const REQUIRED_PERMISSIONS_KEY = 'auth:required-permissions';

export const RequirePermissions = (
  ...permissions: [Permission, ...Permission[]]
) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
