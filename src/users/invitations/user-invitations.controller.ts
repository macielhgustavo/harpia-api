import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../auth/permissions/permissions';
import { RequirePermissions } from '../../auth/permissions/require-permissions.decorator';
import { CreateUserInvitationDto } from './dto/create-user-invitation.dto';
import { UserInvitationsService } from './user-invitations.service';

interface AuthenticatedUser {
  id: string;
  organizationId: string;
  role: UserRole;
}

@RequirePermissions(PERMISSIONS.USERS_MANAGE)
@Controller('users/invitations')
export class UserInvitationsController {
  constructor(
    private readonly userInvitationsService: UserInvitationsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserInvitationDto,
  ) {
    return this.userInvitationsService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.userInvitationsService.findAll(user.organizationId);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.userInvitationsService.revoke(id, user);
  }
}
