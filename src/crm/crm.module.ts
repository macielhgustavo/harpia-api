import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [CrmController, VisitsController],
  providers: [CrmService, VisitsService],
  exports: [CrmService],
})
export class CrmModule {}
