import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { SalesModule } from '../sales/sales.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [ReservationsModule, SalesModule],
  controllers: [ProposalsController],
  providers: [ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
