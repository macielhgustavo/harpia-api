import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { PERMISSIONS } from '../../auth/permissions/permissions';
import { REQUIRED_PERMISSIONS_KEY } from '../../auth/permissions/require-permissions.decorator';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';
import { UserInvitationsController } from './user-invitations.controller';
import { UserInvitationsService } from './user-invitations.service';

interface RequestWithUser extends Request {
  user?: unknown;
}

describe('UserInvitationsController', () => {
  let app: INestApplication;
  let invitationsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    revoke: jest.Mock;
  };
  let usersService: { findOne: jest.Mock };

  beforeAll(async () => {
    invitationsService = {
      create: jest.fn().mockResolvedValue({ id: 'invitation-1' }),
      findAll: jest.fn().mockResolvedValue([{ id: 'invitation-1' }]),
      revoke: jest.fn().mockResolvedValue({
        id: 'invitation-1',
        revokedAt: new Date('2026-08-02T12:00:00.000Z'),
      }),
    };
    usersService = { findOne: jest.fn().mockResolvedValue({ id: 'user-1' }) };

    const moduleRef = await Test.createTestingModule({
      controllers: [UserInvitationsController, UsersController],
      providers: [
        { provide: UserInvitationsService, useValue: invitationsService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(
      (
        requestWithUser: RequestWithUser,
        _response: Response,
        next: NextFunction,
      ) => {
        requestWithUser.user = {
          id: 'owner-1',
          organizationId: 'org-a',
          role: UserRole.OWNER,
        };
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires USERS_MANAGE for every administrative invitation route', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UserInvitationsController),
    ).toEqual([PERMISSIONS.USERS_MANAGE]);
  });

  it('resolves the static invitation list before the dynamic /users/:id route', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/users/invitations')
      .expect(200, [{ id: 'invitation-1' }]);

    expect(invitationsService.findAll).toHaveBeenCalledWith('org-a');
    expect(usersService.findOne).not.toHaveBeenCalled();
  });

  it('uses 201 for creation and 200 for revocation', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .post('/users/invitations')
      .send({ email: 'invite@example.com', role: UserRole.LEITURA })
      .expect(201, { id: 'invitation-1' });

    await request(httpServer)
      .post('/users/invitations/invitation-1/revoke')
      .expect(200);

    expect(invitationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      { email: 'invite@example.com', role: UserRole.LEITURA },
    );
    expect(invitationsService.revoke).toHaveBeenCalledWith(
      'invitation-1',
      expect.objectContaining({ organizationId: 'org-a' }),
    );
  });
});
