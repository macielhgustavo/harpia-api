import 'reflect-metadata';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/permissions/require-permissions.decorator';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('requires USERS_MANAGE for every route through class metadata', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UsersController),
    ).toEqual([PERMISSIONS.USERS_MANAGE]);
  });
});
