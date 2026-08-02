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
import { DevelopmentStatus, DevelopmentType, UserRole } from '@prisma/client';
import { DevelopmentsService } from './developments.service';
import { CreateDevelopmentDto } from './dto/create-development.dto';
import { UpdateDevelopmentDto } from './dto/update-development.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { hasPermission } from '../auth/permissions/role-permissions';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
  role: UserRole;
}

@RequirePermissions(PERMISSIONS.DEVELOPMENTS_READ)
@Controller('developments')
export class DevelopmentsController {
  constructor(private readonly developmentsService: DevelopmentsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: DevelopmentStatus,
    @Query('type') type?: DevelopmentType,
    @Query('companyId') companyId?: string,
  ) {
    return this.developmentsService.findAll(
      user.organizationId,
      status,
      type,
      companyId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.developmentsService.findOne(
      id,
      user.organizationId,
      hasPermission(user.role, PERMISSIONS.INVESTMENTS_READ),
    );
  }

  @RequirePermissions(PERMISSIONS.DEVELOPMENTS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDevelopmentDto) {
    return this.developmentsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.DEVELOPMENTS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateDevelopmentDto,
  ) {
    return this.developmentsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.DEVELOPMENTS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.developmentsService.remove(id, user.organizationId);
  }
}
