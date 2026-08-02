import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AuthThrottlerGuard.name);

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    this.logger.warn(
      JSON.stringify({
        event: 'auth_rate_limited',
        route: context.getHandler().name,
        throttler: throttlerLimitDetail.key,
      }),
    );

    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
