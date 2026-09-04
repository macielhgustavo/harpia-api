import { Module } from '@nestjs/common';
import { ReceivablesModule } from '../receivables/receivables.module';
import { NotificationModule } from '../notification/notification.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SaleCancellationsService } from './sale-cancellations.service';

@Module({
  imports: [ReceivablesModule, NotificationModule],
  controllers: [SalesController],
  providers: [SalesService, SaleCancellationsService],
  exports: [SalesService],
})
export class SalesModule {}
