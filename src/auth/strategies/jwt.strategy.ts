import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  organizationId: string;
  tokenVersion?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!Number.isInteger(payload.tokenVersion)) {
      throw new UnauthorizedException('Sessão inválida');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        organizationId: payload.organizationId,
        tokenVersion: payload.tokenVersion,
        isActive: true,
        organization: { is: { id: payload.organizationId } },
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Sessão inválida');
    }

    return user;
  }
}
