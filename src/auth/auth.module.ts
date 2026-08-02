import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { getAuthConfigInteger } from './auth-config';
import {
  NoopPasswordResetNotifier,
  PASSWORD_RESET_NOTIFIER,
} from './password-reset-notifier';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow('JWT_EXPIRES_IN'),
        },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        errorMessage: 'Muitas tentativas. Aguarde antes de tentar novamente.',
        throttlers: [
          {
            name: 'login',
            limit: getAuthConfigInteger(
              config,
              'AUTH_THROTTLE_LOGIN_LIMIT',
              5,
              1,
              1000,
            ),
            ttl:
              getAuthConfigInteger(
                config,
                'AUTH_THROTTLE_LOGIN_TTL_SECONDS',
                60,
                1,
                86400,
              ) * 1000,
          },
          {
            name: 'register',
            limit: getAuthConfigInteger(
              config,
              'AUTH_THROTTLE_REGISTER_LIMIT',
              3,
              1,
              1000,
            ),
            ttl:
              getAuthConfigInteger(
                config,
                'AUTH_THROTTLE_REGISTER_TTL_SECONDS',
                3600,
                1,
                86400,
              ) * 1000,
          },
          {
            name: 'forgot',
            limit: getAuthConfigInteger(
              config,
              'AUTH_THROTTLE_FORGOT_LIMIT',
              3,
              1,
              1000,
            ),
            ttl:
              getAuthConfigInteger(
                config,
                'AUTH_THROTTLE_FORGOT_TTL_SECONDS',
                900,
                1,
                86400,
              ) * 1000,
          },
          {
            name: 'reset',
            limit: getAuthConfigInteger(
              config,
              'AUTH_THROTTLE_RESET_LIMIT',
              5,
              1,
              1000,
            ),
            ttl:
              getAuthConfigInteger(
                config,
                'AUTH_THROTTLE_RESET_TTL_SECONDS',
                900,
                1,
                86400,
              ) * 1000,
          },
          {
            name: 'accept',
            limit: getAuthConfigInteger(
              config,
              'AUTH_THROTTLE_ACCEPT_LIMIT',
              5,
              1,
              1000,
            ),
            ttl:
              getAuthConfigInteger(
                config,
                'AUTH_THROTTLE_ACCEPT_TTL_SECONDS',
                900,
                1,
                86400,
              ) * 1000,
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    AuthThrottlerGuard,
    NoopPasswordResetNotifier,
    {
      provide: PASSWORD_RESET_NOTIFIER,
      useExisting: NoopPasswordResetNotifier,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
