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
import { PersonRoleType, UserRole } from '@prisma/client';
import { PeopleService } from './people.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { AddRoleDto } from './dto/add-role.dto';
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

@RequirePermissions(PERMISSIONS.PEOPLE_READ)
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('role') role?: PersonRoleType,
    @Query('search') search?: string,
  ) {
    return this.peopleService.findAll(user.organizationId, role, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.peopleService.findOne(
      id,
      user.organizationId,
      hasPermission(user.role, PERMISSIONS.INVESTMENTS_READ),
    );
  }

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePersonDto) {
    return this.peopleService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.peopleService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.peopleService.remove(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  @Post(':id/roles')
  addRole(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddRoleDto,
  ) {
    return this.peopleService.addRole(
      id,
      user.organizationId,
      dto.role,
      hasPermission(user.role, PERMISSIONS.INVESTMENTS_READ),
    );
  }

  @RequirePermissions(PERMISSIONS.PEOPLE_WRITE)
  @Delete(':id/roles/:role')
  removeRole(
    @Param('id') id: string,
    @Param('role') role: PersonRoleType,
    @CurrentUser() user: AuthUser,
  ) {
    return this.peopleService.removeRole(
      id,
      user.organizationId,
      role,
      hasPermission(user.role, PERMISSIONS.INVESTMENTS_READ),
    );
  }
}
