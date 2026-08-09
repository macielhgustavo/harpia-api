import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions/permissions.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController authentication and tenant isolation', () => {
  let app: INestApplication;

  const owner = {
    id: 'user-a',
    email: 'owner@example.com',
    organizationId: 'organization-a',
    role: UserRole.OWNER,
  };
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const createToken = () =>
    sign(
      {
        sub: owner.id,
        email: owner.email,
        organizationId: owner.organizationId,
        tokenVersion: 0,
      },
      'audit-test-secret',
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'audit-test-secret' })],
        }),
        PassportModule,
      ],
      controllers: [AuditController],
      providers: [
        AuditService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue(owner);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.auditLog.findFirst.mockResolvedValue(null);
  });

  it('returns 401 without a JWT before reading audit logs', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer).get('/audit-logs').expect(401);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated role lacks AUDIT_READ', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      ...owner,
      role: UserRole.LEITURA,
    });
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(403);

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.count).not.toHaveBeenCalled();
  });

  it('returns 200 for OWNER and scopes the query to the validated organization', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    const response = await request(httpServer)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      data: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
      },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: owner.id,
        organizationId: owner.organizationId,
        tokenVersion: 0,
        isActive: true,
        organization: { is: { id: owner.organizationId } },
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        role: true,
      },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: owner.organizationId },
      }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { organizationId: owner.organizationId },
    });
  });

  it('returns 404 for an audit-log detail from another organization', async () => {
    prisma.auditLog.findFirst.mockImplementation(
      (query: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          query.where.organizationId === 'organization-b'
            ? {
                id: query.where.id,
                organizationId: 'organization-b',
              }
            : null,
        ),
    );
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/audit-logs/audit-from-organization-b')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(404);

    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'audit-from-organization-b',
          organizationId: owner.organizationId,
        },
      }),
    );
  });
});
