import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AllowAuthenticated } from '../decorators/allow-authenticated.decorator';
import { Public } from '../decorators/public.decorator';
import { PERMISSIONS } from './permissions';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

@RequirePermissions(PERMISSIONS.PEOPLE_READ)
class ProtectedController {
  read(this: void) {}

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  write(this: void) {}
}

@AllowAuthenticated()
class AuthenticatedController {
  handle(this: void) {}
}

@Public()
class PublicController {
  handle(this: void) {}
}

class UnannotatedController {
  handle(this: void) {}
}

function createContext(
  controller: new (...args: never[]) => unknown,
  handler: (...args: never[]) => unknown,
  user?: Record<string, unknown>,
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;

  beforeEach(() => {
    guard = new PermissionsGuard(new Reflector());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows an explicitly marked route for any authenticated user', () => {
    const context = createContext(
      AuthenticatedController,
      AuthenticatedController.prototype.handle,
      { id: 'user-1', role: UserRole.LEITURA },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows public routes without an authenticated user', () => {
    const context = createContext(
      PublicController,
      PublicController.prototype.handle,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('fails closed when a route has no authorization metadata', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const context = createContext(
      UnannotatedController,
      UnannotatedController.prototype.handle,
      { id: 'user-1', role: UserRole.OWNER },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('authorization.permission_metadata_missing'),
    );
  });

  it('allows a role with the class-level read permission', () => {
    const context = createContext(
      ProtectedController,
      ProtectedController.prototype.read,
      { id: 'user-1', role: UserRole.LEITURA },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('uses method permissions as an override of class permissions', () => {
    const context = createContext(
      ProtectedController,
      ProtectedController.prototype.write,
      { id: 'user-1', role: UserRole.COMERCIAL },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a missing permission and writes only sanitized context', () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const context = createContext(
      ProtectedController,
      ProtectedController.prototype.write,
      {
        id: 'user-2',
        role: UserRole.LEITURA,
        email: 'sensitive@example.com',
        accessToken: 'secret-jwt',
      },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(log).toHaveBeenCalledTimes(1);

    const event = String(log.mock.calls[0][0]);
    expect(event).toContain('authorization.permission_denied');
    expect(event).toContain(PERMISSIONS.PEOPLE_WRITE);
    expect(event).not.toContain('sensitive@example.com');
    expect(event).not.toContain('secret-jwt');
  });

  it('fails closed when the authenticated request has no recognized role', () => {
    const context = createContext(
      ProtectedController,
      ProtectedController.prototype.read,
      { id: 'legacy-user', role: 'UNKNOWN' },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
