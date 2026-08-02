import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const validPayload = {
    sub: 'user-1',
    email: 'payload@example.com',
    organizationId: 'organization-1',
    tokenVersion: 2,
  };

  function createStrategy(user: unknown) {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('jwt-test-secret'),
    } as unknown as ConfigService;
    const findFirst = jest.fn().mockResolvedValue(user);
    const prisma = {
      user: { findFirst },
    } as unknown as PrismaService;

    return {
      strategy: new JwtStrategy(configService, prisma),
      findFirst,
    };
  }

  it('uses the current database account and token version, not the JWT identity fields', async () => {
    const databaseUser = {
      id: 'user-1',
      email: 'canonical@example.com',
      organizationId: 'organization-1',
      role: UserRole.FINANCEIRO,
    };
    const { strategy, findFirst } = createStrategy(databaseUser);

    await expect(strategy.validate(validPayload)).resolves.toEqual(
      databaseUser,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        organizationId: 'organization-1',
        tokenVersion: 2,
        isActive: true,
        organization: { is: { id: 'organization-1' } },
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        role: true,
      },
    });
  });

  it('rejects legacy, revoked, deleted and mismatched-organization sessions', async () => {
    const { strategy } = createStrategy(null);

    await expect(
      strategy.validate({ ...validPayload, tokenVersion: undefined }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(validPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
