import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { NoopUserInvitationNotifier } from './user-invitation-notifier';

describe('NoopUserInvitationNotifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('suppresses delivery while logging only sanitized metadata', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const config = {
      get: jest.fn().mockReturnValue('test'),
    };
    const notifier = new NoopUserInvitationNotifier(
      config as unknown as ConfigService,
    );

    await notifier.sendUserInvitation({
      invitationId: 'invitation-1',
      organizationId: 'org-a',
      invitedById: 'owner-1',
      email: 'secret@example.com',
      role: UserRole.LEITURA,
      acceptUrl:
        'https://app.example.com/accept-invitation?token=super-secret-token',
      expiresAt: new Date('2026-08-09T10:00:00.000Z'),
    });

    const logged = String(log.mock.calls[0][0]);
    expect(logged).toContain('user_invitation_notification_suppressed');
    expect(logged).toContain('invitation-1');
    expect(logged).not.toContain('secret@example.com');
    expect(logged).not.toContain('super-secret-token');
    expect(logged).not.toContain('acceptUrl');
  });
});
