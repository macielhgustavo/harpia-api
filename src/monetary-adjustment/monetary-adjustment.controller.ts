import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CreateMonetaryIndexValueDto } from './dto/create-monetary-index-value.dto';
import { CreateMonetaryIndexDto } from './dto/create-monetary-index.dto';
import { CreateReceivableAdjustmentDto } from './dto/create-receivable-adjustment.dto';
import { CreateReceivableAdjustmentPolicyDto } from './dto/create-receivable-adjustment-policy.dto';
import { PreviewReceivableAdjustmentDto } from './dto/preview-receivable-adjustment.dto';
import { UpdateMonetaryIndexValueDto } from './dto/update-monetary-index-value.dto';
import { UpdateMonetaryIndexDto } from './dto/update-monetary-index.dto';
import { UpdateReceivableAdjustmentPolicyDto } from './dto/update-receivable-adjustment-policy.dto';
import { MonetaryAdjustmentService } from './monetary-adjustment.service';

interface AuthUser { id: string; organizationId: string }

@Controller('monetary-indices')
export class MonetaryAdjustmentController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_READ)
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAllMonetaryIndices(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMonetaryIndexDto) {
    return this.service.createMonetaryIndex(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_UPDATE)
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateMonetaryIndexDto) {
    return this.service.updateMonetaryIndex(id, user, dto);
  }
}

@Controller('monetary-indices/:id/values')
export class MonetaryIndexValueController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_READ)
  findAll(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findMonetaryIndexValues(id, user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_CREATE)
  create(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateMonetaryIndexValueDto) {
    return this.service.createMonetaryIndexValue(id, user, dto);
  }

  @Patch(':valueId')
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_UPDATE)
  update(
    @Param('id') id: string,
    @Param('valueId') valueId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMonetaryIndexValueDto,
  ) {
    return this.service.updateMonetaryIndexValue(id, valueId, user, dto);
  }
}

@Controller('receivables/:id/adjustment-policies')
export class ReceivableAdjustmentPolicyController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_READ)
  findAll(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getPolicies(id, user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_CREATE)
  create(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReceivableAdjustmentPolicyDto,
  ) {
    return this.service.createPolicy(id, user, dto);
  }

  @Patch(':policyId')
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_CREATE)
  update(
    @Param('id') id: string,
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateReceivableAdjustmentPolicyDto,
  ) {
    return this.service.updatePolicy(id, policyId, user, dto);
  }

  @Delete(':policyId')
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_CREATE)
  remove(@Param('id') id: string, @Param('policyId') policyId: string, @CurrentUser() user: AuthUser) {
    return this.service.deletePolicy(id, policyId, user);
  }
}

@Controller('receivables/:id/adjustments')
export class ReceivableAdjustmentController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_PREVIEW)
  preview(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: PreviewReceivableAdjustmentDto) {
    return this.service.preview(id, user.organizationId, dto.startCompetence, dto.endCompetence);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_CREATE)
  create(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateReceivableAdjustmentDto) {
    return this.service.apply(id, user, dto.startCompetence, dto.endCompetence);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_READ)
  findAll(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAdjustments(id, user.organizationId);
  }
}
