import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PeopleModule } from './people/people.module';
import { CompaniesModule } from './companies/companies.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { DevelopmentsModule } from './developments/developments.module';
import { UnitTypesModule } from './unit-types/unit-types.module';
import { UnitsModule } from './units/units.module';
import { PriceTablesModule } from './price-tables/price-tables.module';
import { InvestmentsModule } from './investments/investments.module';
import { AllocationsModule } from './allocations/allocations.module';
import { ReturnsModule } from './returns/returns.module';
import { DocumentsModule } from './documents/documents.module';
import { InteractionsModule } from './interactions/interactions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions/permissions.guard';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { CrmModule } from './crm/crm.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PeopleModule,
    CompaniesModule,
    BankAccountsModule,
    DevelopmentsModule,
    UnitTypesModule,
    UnitsModule,
    PriceTablesModule,
    InvestmentsModule,
    AllocationsModule,
    ReturnsModule,
    DocumentsModule,
    InteractionsModule,
    DashboardModule,
    ReportsModule,
    UsersModule,
    AuditModule,
    CrmModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
