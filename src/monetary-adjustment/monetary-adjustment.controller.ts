import { Body, Controller, Get, Param, Post, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { MonetaryAdjustmentService } from './monetary-adjustment.service';
import { User } from '../users/user.entity';

// TODO: Define DTOs
import { CreateMonetaryIndexDto } from './dto/create-monetary-index.dto';
import { UpdateMonetaryIndexDto } from './dto/update-monetary-index.dto';
import { CreateMonetaryIndexValueDto } from './dto/create-monetary-index-value.dto';
import { UpdateMonetaryIndexValueDto } from './dto/update-monetary-index-value.dto';
import { CreateReceivableAdjustmentPolicyDto } from './dto/create-receivable-adjustment-policy.dto';
import { PreviewReceivableAdjustmentDto } from './dto/preview-receivable-adjustment.dto';
import { CreateReceivableAdjustmentDto } from './dto/create-receivable-adjustment.dto';

@Controller('monetary-indices')
export class MonetaryAdjustmentController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_READ)
  async findAll() {
    return this.service.findAllMonetaryIndices();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_CREATE)
  async create(@Body() dto: CreateMonetaryIndexDto) {
    return this.service.createMonetaryIndex(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_UPDATE)
  async update(@Param('id') id: string, @Body() dto: UpdateMonetaryIndexDto) {
    return this.service.updateMonetaryIndex(id, dto);
  }
}

@Controller('monetary-indices/:id/values')
export class MonetaryIndexValueController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_READ)
  async findAll(@Param('id') monetaryIndexId: string) {
    return this.service.findMonetaryIndexValues(monetaryIndexId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_CREATE)
  async create(
    @Param('id') monetaryIndexId: string,
    @Body() dto: CreateMonetaryIndexValueDto,
  ) {
    return this.service.createMonetaryIndexValue({ ...dto, monetaryIndexId });
  }

  @Patch(':valueId')
  @RequirePermissions(PERMISSIONS.MONETARY_INDEX_VALUE_UPDATE)
  async update(
    @Param('id') monetaryIndexId: string,
    @Param('valueId') id: string,
    @Body() dto: UpdateMonetaryIndexValueDto,
  ) {
    return this.service.updateMonetaryIndexValue(id, { ...dto, monetaryIndexId });
  }
}

@Controller('receivables/:id/adjustments')
export class ReceivableAdjustmentController {
  constructor(private readonly service: MonetaryAdjustmentService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_PREVIEW)
  async preview(
    @Param('id') receivableId: string,
    @Body() dto: PreviewReceivableAdjustmentDto,
    @CurrentUser() user: User,
  ) {
    return this.service.previewReceivableAdjustment(receivableId, {
      startCompetence: dto.startCompetence,
      endCompetence: dto.endCompetence,
      indexValues: dto.indexValues,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_CREATE)
  async create(
    @Param('id') receivableId: string,
    @Body() dto: CreateReceivableAdjustmentDto,
    @CurrentUser() user: User,
  ) {
    return this.service.createReceivableAdjustment(
      receivableId,
      {
        startCompetence: dto.startCompetence,
        endCompetence: dto.endCompetence,
        indexValues: dto.indexValues,
      },
      user.id,
    );
  }

  @Get()
  @RequirePermissions(PERMISSIONS.RECEIVABLE_ADJUSTMENT_READ)
  async findAll(@Param('id') receivableId: string) {
    return this.service.getReceivableAdjustments(receivableId);
  }
}
