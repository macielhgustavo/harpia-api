import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { CreateProposalVersionDto } from './dto/create-proposal-version.dto';
import { ListProposalsQueryDto } from './dto/list-proposals-query.dto';
import { RejectProposalDto } from './dto/reject-proposal.dto';
import { ProposalsService } from './proposals.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.SALES_READ)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get('price-preview')
  pricePreview(@CurrentUser() user: AuthUser, @Query('unitId') unitId: string) {
    return this.proposals.pricePreview(user.organizationId, unitId);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListProposalsQueryDto,
  ) {
    return this.proposals.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposals.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProposalDto) {
    return this.proposals.create(user, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProposalVersionDto,
  ) {
    return this.proposals.createVersion(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/send')
  send(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposals.send(id, user);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.proposals.accept(id, user);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectProposalDto,
  ) {
    return this.proposals.reject(id, user, dto);
  }
}
