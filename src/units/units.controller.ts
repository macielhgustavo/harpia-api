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
import { UnitStatus, UserRole } from '@prisma/client';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
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

@RequirePermissions(PERMISSIONS.UNITS_READ)
@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('developmentId') developmentId: string,
    @Query('status') status?: UnitStatus,
    @Query('grouping') grouping?: string,
  ) {
    return this.unitsService.findAll(
      user.organizationId,
      developmentId,
      status,
      grouping,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.unitsService.findOne(
      id,
      user.organizationId,
      hasPermission(user.role, PERMISSIONS.INVESTMENTS_READ),
    );
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto) {
    return this.unitsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.unitsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.unitsService.remove(id, user.organizationId);
  }
}
