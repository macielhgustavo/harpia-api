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
import { CancelReceivableDto } from '../receivables/dto/cancel-receivable.dto';
import { RecordPaymentDto } from '../receivables/dto/record-payment.dto';
import { ReversePaymentDto } from '../receivables/dto/reverse-payment.dto';
import { CreatePayableDto } from './dto/create-payable.dto';
import { ListPayablesQueryDto } from './dto/list-payables-query.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { PayablesService } from './payables.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.FINANCE_READ)
@Controller('payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListPayablesQueryDto) {
    return this.payables.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.payables.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePayableDto) {
    return this.payables.create(user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePayableDto,
  ) {
    return this.payables.update(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/payments')
  recordPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.payables.recordPayment(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/payments/:paymentId/reverse')
  reversePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReversePaymentDto,
  ) {
    return this.payables.reversePayment(id, paymentId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancelReceivableDto,
  ) {
    return this.payables.cancel(id, user, dto);
  }
}
