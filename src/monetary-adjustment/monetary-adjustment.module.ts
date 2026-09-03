import { Module } from '@nestjs/common';
import { MonetaryAdjustmentController } from './monetary-adjustment.controller';
import { MonetaryAdjustmentService } from './monetary-adjustment.service';

@Module({
  controllers: [MonetaryAdjustmentController],
  providers: [MonetaryAdjustmentService],
  exports: [MonetaryAdjustmentService],
})
export class MonetaryAdjustmentModule {}
