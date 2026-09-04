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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CrmService } from './crm.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { CreateSalesActivityDto } from './dto/create-sales-activity.dto';
import { CreateSalesPipelineDto } from './dto/create-sales-pipeline.dto';
import { ListOpportunitiesQueryDto } from './dto/list-opportunities-query.dto';
import { ListSalesActivitiesQueryDto } from './dto/list-sales-activities-query.dto';
import { MoveOpportunityDto } from './dto/move-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { UpdateSalesActivityDto } from './dto/update-sales-activity.dto';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.CRM_READ)
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('pipelines')
  findPipelines(@CurrentUser() user: AuthUser) {
    return this.crm.findPipelines(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Post('pipelines')
  createPipeline(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSalesPipelineDto,
  ) {
    return this.crm.createPipeline(user, dto);
  }

  @Get('opportunities')
  findOpportunities(
    @CurrentUser() user: AuthUser,
    @Query() query: ListOpportunitiesQueryDto,
  ) {
    return this.crm.findOpportunities(user.organizationId, query);
  }

  @Get('opportunities/:id/history')
  findOpportunityHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.crm.findOpportunityHistory(id, user.organizationId);
  }

  @Get('opportunities/:id/timeline')
  findOpportunityTimeline(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.crm.findOpportunityTimeline(id, user.organizationId);
  }

  @Get('opportunities/:id')
  findOpportunity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.crm.findOpportunity(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Post('opportunities')
  createOpportunity(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.crm.createOpportunity(user, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Patch('opportunities/:id')
  updateOpportunity(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.crm.updateOpportunity(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Delete('opportunities/:id')
  removeOpportunity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.crm.removeOpportunity(id, user);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Post('opportunities/:id/move')
  moveOpportunity(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MoveOpportunityDto,
  ) {
    return this.crm.moveOpportunity(id, user, dto);
  }

  @Get('activities')
  findActivities(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSalesActivitiesQueryDto,
  ) {
    return this.crm.findActivities(user.organizationId, query);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Post('activities')
  createActivity(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSalesActivityDto,
  ) {
    return this.crm.createActivity(user, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Patch('activities/:id')
  updateActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSalesActivityDto,
  ) {
    return this.crm.updateActivity(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.CRM_WRITE)
  @Delete('activities/:id')
  removeActivity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.crm.removeActivity(id, user);
  }
}
