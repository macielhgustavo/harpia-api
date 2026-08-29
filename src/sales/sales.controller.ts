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
import { CreateSaleCommissionDto } from './dto/create-sale-commission.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.SALES_READ)
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListSalesQueryDto) {
    return this.sales.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sales.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSaleDto,
  ) {
    return this.sales.update(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.SALES_WRITE)
  @Post(':id/commissions')
  addCommission(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSaleCommissionDto,
  ) {
    return this.sales.addCommission(id, user, dto);
  }
}
