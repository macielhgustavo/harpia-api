import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinancialSettingsService } from './financial-settings.service';
import { FinancialSetupService } from './financial-setup.service';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';
import { BankReconciliationService } from './bank-reconciliation.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [FinanceController, PayablesController],
  providers: [
    FinanceService,
    FinancialSettingsService,
    FinancialSetupService,
    PayablesService,
    BankReconciliationService,
  ],
  exports: [FinancialSetupService, PayablesService],
})
export class FinanceModule {}
