import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InteractionsService } from './interactions.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { UpdateInteractionDto } from './dto/update-interaction.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.INTERACTIONS_READ)
@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('personId') personId?: string) {
    return this.interactionsService.findAll(user.organizationId, personId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.interactionsService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.INTERACTIONS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInteractionDto) {
    return this.interactionsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.INTERACTIONS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.interactionsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.INTERACTIONS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.interactionsService.remove(id, user.organizationId);
  }
}
