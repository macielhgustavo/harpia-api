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
import { CompanyType, UserRole } from '@prisma/client';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
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

@RequirePermissions(PERMISSIONS.COMPANIES_READ)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('type') type?: CompanyType) {
    return this.companiesService.findAll(
      user.organizationId,
      type,
      hasPermission(user.role, PERMISSIONS.BANK_ACCOUNTS_READ),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companiesService.findOne(
      id,
      user.organizationId,
      hasPermission(user.role, PERMISSIONS.BANK_ACCOUNTS_READ),
    );
  }

  @RequirePermissions(PERMISSIONS.COMPANIES_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.COMPANIES_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(
      id,
      { id: user.id, organizationId: user.organizationId },
      dto,
    );
  }

  @RequirePermissions(PERMISSIONS.COMPANIES_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companiesService.remove(id, {
      id: user.id,
      organizationId: user.organizationId,
    });
  }
}
