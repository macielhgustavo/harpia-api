import { Module } from '@nestjs/common';
import {
  MonetaryAdjustmentController,
  MonetaryIndexValueController,
  ReceivableAdjustmentController,
  ReceivableAdjustmentPolicyController,
} from './monetary-adjustment.controller';
import { MonetaryAdjustmentService } from './monetary-adjustment.service';

@Module({
  controllers: [
    MonetaryAdjustmentController,
    MonetaryIndexValueController,
    ReceivableAdjustmentPolicyController,
    ReceivableAdjustmentController,
  ],
  providers: [MonetaryAdjustmentService],
  exports: [MonetaryAdjustmentService],
})
export class MonetaryAdjustmentModule {}
