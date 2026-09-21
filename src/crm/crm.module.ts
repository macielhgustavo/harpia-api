import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { OpportunityPropertyInterestsService } from './opportunity-property-interests.service';
import { UnitMatchingService } from './unit-matching.service';

@Module({
  controllers: [CrmController, VisitsController],
  providers: [
    CrmService,
    VisitsService,
    OpportunityPropertyInterestsService,
    UnitMatchingService,
  ],
  exports: [CrmService],
})
export class CrmModule {}
