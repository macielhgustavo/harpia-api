import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import {
  NoopUserInvitationNotifier,
  USER_INVITATION_NOTIFIER,
} from './invitations/user-invitation-notifier';
import { UserInvitationsController } from './invitations/user-invitations.controller';
import { UserInvitationsService } from './invitations/user-invitations.service';

@Module({
  // Register the static /users/invitations routes before /users/:id.
  controllers: [UserInvitationsController, UsersController],
  providers: [
    UsersService,
    UserInvitationsService,
    NoopUserInvitationNotifier,
    {
      provide: USER_INVITATION_NOTIFIER,
      useExisting: NoopUserInvitationNotifier,
    },
  ],
  exports: [UsersService, UserInvitationsService],
})
export class UsersModule {}
