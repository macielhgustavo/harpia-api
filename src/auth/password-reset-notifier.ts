import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { emailFingerprint } from './email.utils';

export const PASSWORD_RESET_NOTIFIER = Symbol('PASSWORD_RESET_NOTIFIER');

export interface PasswordResetNotification {
  userId: string;
  email: string;
  resetUrl: string;
}

export interface PasswordResetNotifier {
  sendPasswordReset(notification: PasswordResetNotification): Promise<void>;
}

@Injectable()
export class NoopPasswordResetNotifier implements PasswordResetNotifier {
  private readonly logger = new Logger(NoopPasswordResetNotifier.name);

  constructor(private readonly configService: ConfigService) {}

  sendPasswordReset(notification: PasswordResetNotification): Promise<void> {
    const environment =
      this.configService.get<string>('NODE_ENV') ?? 'development';

    this.logger.log(
      JSON.stringify({
        event: 'password_reset_notification_suppressed',
        userId: notification.userId,
        emailFingerprint: emailFingerprint(notification.email),
        environment,
      }),
    );

    return Promise.resolve();
  }
}
