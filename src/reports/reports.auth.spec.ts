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
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController authentication', () => {
  let app: INestApplication;
  const reportsService = {
    captations: jest.fn(),
    returns: jest.fn(),
    overdueReturns: jest.fn(),
    investorPositions: jest.fn(),
  };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'user-a',
        email: 'user@example.com',
        organizationId: 'organization-a',
        role: UserRole.OWNER,
      }),
    },
  };

  const createToken = () =>
    sign(
      {
        sub: 'user-a',
        email: 'user@example.com',
        organizationId: 'organization-a',
        tokenVersion: 0,
      },
      'reports-test-secret',
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'reports-test-secret' })],
        }),
        PassportModule,
      ],
      controllers: [ReportsController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: ReportsService, useValue: reportsService },
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
  });

  it('returns 401 before reaching a financial report route without a JWT', async () => {
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/reports/captations?format=xlsx')
      .expect(401);

    expect(reportsService.captations).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated nonfinancial role', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-a',
      email: 'user@example.com',
      organizationId: 'organization-a',
      role: UserRole.LEITURA,
    });
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/reports/captations?format=xlsx')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(403);

    expect(reportsService.captations).not.toHaveBeenCalled();
  });

  it('sends the generated report as raw bytes rather than a JSON Buffer object', async () => {
    const report = {
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx' as const,
    };
    reportsService.captations.mockResolvedValue(report);
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    const response = await request(httpServer)
      .get('/reports/captations?format=xlsx')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(200);

    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="harpia-captacoes-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-length']).toBe(
      String(report.buffer.length),
    );
  });

  it('allows FINANCEIRO to export reports', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-a',
      email: 'user@example.com',
      organizationId: 'organization-a',
      role: UserRole.FINANCEIRO,
    });
    reportsService.captations.mockResolvedValue({
      buffer: Buffer.from([0x50, 0x4b]),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx' as const,
    });
    const httpServer = app.getHttpServer() as Parameters<typeof request>[0];

    await request(httpServer)
      .get('/reports/captations?format=xlsx')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(200);

    expect(reportsService.captations).toHaveBeenCalledTimes(1);
  });
});
