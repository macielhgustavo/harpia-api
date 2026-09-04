import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CreateSalesVisitDto } from './dto/create-sales-visit.dto';
import { ListSalesVisitsQueryDto } from './dto/list-sales-visits-query.dto';
import { UpdateSalesVisitDto } from './dto/update-sales-visit.dto';
import { VisitsService } from './visits.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.CRM_READ)
@Controller('crm/visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  findMany(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSalesVisitsQueryDto,
  ) {
    return this.visits.findMany(user.organizationId, query);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalesVisitDto) {
    return this.visits.create(user, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSalesVisitDto,
  ) {
    return this.visits.update(id, user, dto);
  }
}
