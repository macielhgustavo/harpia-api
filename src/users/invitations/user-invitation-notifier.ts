import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { emailFingerprint } from '../../auth/email.utils';

export const USER_INVITATION_NOTIFIER = Symbol('USER_INVITATION_NOTIFIER');

export interface UserInvitationNotification {
  invitationId: string;
  organizationId: string;
  invitedById: string;
  email: string;
  role: UserRole;
  acceptUrl: string;
  expiresAt: Date;
}

export abstract class UserInvitationNotifier {
  abstract sendUserInvitation(
    notification: UserInvitationNotification,
  ): Promise<void>;
}

@Injectable()
export class NoopUserInvitationNotifier extends UserInvitationNotifier {
  private readonly logger = new Logger(NoopUserInvitationNotifier.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  sendUserInvitation(notification: UserInvitationNotification): Promise<void> {
    const environment =
      this.configService.get<string>('NODE_ENV') ?? 'development';

    this.logger.log(
      JSON.stringify({
        event: 'user_invitation_notification_suppressed',
        invitationId: notification.invitationId,
        organizationId: notification.organizationId,
        invitedById: notification.invitedById,
        emailFingerprint: emailFingerprint(notification.email),
        role: notification.role,
        environment,
      }),
    );

    return Promise.resolve();
  }
}
