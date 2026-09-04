import { Module } from '@nestjs/common';
import { ReceivablesModule } from '../receivables/receivables.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SaleCancellationsService } from './sale-cancellations.service';

@Module({
  imports: [ReceivablesModule],
  controllers: [SalesController],
  providers: [SalesService, SaleCancellationsService],
  exports: [SalesService],
})
export class SalesModule {}
