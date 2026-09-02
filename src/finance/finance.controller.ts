import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FinancialCategoryType } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto';
import { FinanceQueryDto } from './dto/finance-query.dto';
import { MarkCommissionDueDto } from './dto/mark-commission-due.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';
import { UpdateFinancialCategoryDto } from './dto/update-financial-category.dto';
import { FinanceService } from './finance.service';
import { FinancialSettingsService } from './financial-settings.service';
import { PayablesService } from './payables.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.FINANCE_READ)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly settings: FinancialSettingsService,
    private readonly payables: PayablesService,
  ) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: FinanceQueryDto) {
    return this.finance.summary(user.organizationId, query);
  }

  @Get('cash-flow')
  cashFlow(@CurrentUser() user: AuthUser, @Query() query: FinanceQueryDto) {
    return this.finance.cashFlow(user.organizationId, query);
  }

  @Get('transactions')
  transactions(
    @CurrentUser() user: AuthUser,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.finance.transactions(user.organizationId, query);
  }

  @Get('categories')
  categories(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: FinancialCategoryType,
  ) {
    return this.settings.listCategories(user.organizationId, type);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFinancialCategoryDto,
  ) {
    return this.settings.createCategory(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateFinancialCategoryDto,
  ) {
    return this.settings.updateCategory(id, user.organizationId, dto);
  }

  @Get('cost-centers')
  costCenters(@CurrentUser() user: AuthUser) {
    return this.settings.listCostCenters(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('cost-centers')
  createCostCenter(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCostCenterDto,
  ) {
    return this.settings.createCostCenter(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Patch('cost-centers/:id')
  updateCostCenter(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCostCenterDto,
  ) {
    return this.settings.updateCostCenter(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post('commissions/:id/mark-due')
  markCommissionDue(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MarkCommissionDueDto,
  ) {
    return this.payables.markCommissionDue(id, user, dto);
  }
}
