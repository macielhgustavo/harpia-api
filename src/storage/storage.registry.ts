import {
  StorageProvider,
  StorageProviderError,
  StorageService,
} from './storage.service';

/**
 * Resolves the driver that owns an existing object. The default driver is used
 * for new uploads, while existing records keep using their stored provider.
 */
export class StorageRegistry {
  private readonly storages = new Map<StorageProvider, StorageService>();

  constructor(defaultStorage: StorageService, localStorage: StorageService) {
    this.storages.set('local', localStorage);
    this.storages.set(defaultStorage.provider, defaultStorage);
  }

  resolve(provider: string): StorageService {
    const storage = this.storages.get(provider as StorageProvider);
    if (!storage) {
      throw new StorageProviderError(
        'Document storage provider is unavailable',
      );
    }
    return storage;
  }
}
