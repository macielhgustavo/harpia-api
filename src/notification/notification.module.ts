import { Module } from '@nestjs/common';
import { NotificationEmailService } from './email.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationEmailService],
  exports: [NotificationService],
})
export class NotificationModule {}
