import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectionEmailService } from './collection-email.service';
import { CollectionsAutomationService } from './collections-automation.service';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CollectionsController],
  providers: [
    CollectionsService,
    CollectionEmailService,
    CollectionsAutomationService,
  ],
})
export class CollectionsModule {}
