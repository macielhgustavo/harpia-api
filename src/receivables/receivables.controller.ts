import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';
import { CancelReceivableDto } from './dto/cancel-receivable.dto';
import { ListReceivablesQueryDto } from './dto/list-receivables-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { ReceivablesService } from './receivables.service';

interface AuthUser {
  id: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.FINANCE_READ)
@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListReceivablesQueryDto,
  ) {
    return this.receivables.findAll(user.organizationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.receivables.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/payments')
  recordPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.receivables.recordPayment(id, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/payments/:paymentId/reverse')
  reversePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReversePaymentDto,
  ) {
    return this.receivables.reversePayment(id, paymentId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.FINANCE_WRITE)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancelReceivableDto,
  ) {
    return this.receivables.cancel(id, user, dto);
  }
}
