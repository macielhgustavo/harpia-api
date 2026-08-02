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
import { UnitTypesService } from './unit-types.service';
import { CreateUnitTypeDto } from './dto/create-unit-type.dto';
import { UpdateUnitTypeDto } from './dto/update-unit-type.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.UNITS_READ)
@Controller('unit-types')
export class UnitTypesController {
  constructor(private readonly unitTypesService: UnitTypesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('developmentId') developmentId: string,
  ) {
    return this.unitTypesService.findAll(user.organizationId, developmentId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.unitTypesService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitTypeDto) {
    return this.unitTypesService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUnitTypeDto,
  ) {
    return this.unitTypesService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.UNITS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.unitTypesService.remove(id, user.organizationId);
  }
}
