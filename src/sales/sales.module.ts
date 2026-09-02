import { Module } from '@nestjs/common';
import { ReceivablesModule } from '../receivables/receivables.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [ReceivablesModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
