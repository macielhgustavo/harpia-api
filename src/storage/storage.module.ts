import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';
import { StorageRegistry } from './storage.registry';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    LocalStorageService,
    {
      provide: StorageService,
      inject: [ConfigService, LocalStorageService],
      useFactory: (
        config: ConfigService,
        localStorage: LocalStorageService,
      ): StorageService => {
        const driver = (
          config.get<string>('STORAGE_DRIVER') ?? 'local'
        ).toLowerCase();

        if (driver === 'local') return localStorage;
        if (driver === 's3') return new S3StorageService(config);

        throw new Error('STORAGE_DRIVER must be either "local" or "s3"');
      },
    },
    {
      provide: StorageRegistry,
      inject: [StorageService, LocalStorageService],
      useFactory: (
        defaultStorage: StorageService,
        localStorage: LocalStorageService,
      ) => new StorageRegistry(defaultStorage, localStorage),
    },
  ],
  exports: [StorageRegistry, StorageService],
})
export class StorageModule {}
