import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionsService } from './collections.service';

@Injectable()
export class CollectionsAutomationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CollectionsAutomationService.name);
  private interval?: NodeJS.Timeout;
  private initialRun?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: CollectionsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('COLLECTION_AUTOMATION_ENABLED') === 'false') {
      return;
    }
    this.initialRun = setTimeout(() => void this.runAll(), 5_000);
    this.initialRun.unref();
    this.interval = setInterval(() => void this.runAll(), 15 * 60 * 1000);
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.initialRun) clearTimeout(this.initialRun);
    if (this.interval) clearInterval(this.interval);
  }

  private async runAll() {
    if (this.running) return;
    this.running = true;
    try {
      const organizations = await this.prisma.organization.findMany({
        where: { collectionRules: { some: { active: true } } },
        select: { id: true },
      });
      for (const organization of organizations) {
        try {
          await this.collections.run(organization.id);
        } catch (error) {
          this.logger.error(
            `Falha ao processar cobranças da organização ${organization.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
