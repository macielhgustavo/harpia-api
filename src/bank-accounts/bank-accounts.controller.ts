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
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { RequirePermissions } from '../auth/permissions/require-permissions.decorator';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_READ)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.bankAccountsService.findAll(user.organizationId, companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.bankAccountsService.findOne(id, user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_WRITE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBankAccountDto) {
    return this.bankAccountsService.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.bankAccountsService.update(id, user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_WRITE)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.bankAccountsService.remove(id, user.organizationId);
  }
}
