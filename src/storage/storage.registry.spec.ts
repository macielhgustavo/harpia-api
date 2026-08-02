import { StorageRegistry } from './storage.registry';
import type { StorageService } from './storage.service';

describe('StorageRegistry', () => {
  it('uses a document record provider instead of the current default driver', () => {
    const localStorage = createStorage('local');
    const s3Storage = createStorage('s3');
    const registry = new StorageRegistry(s3Storage, localStorage);

    expect(registry.resolve('local')).toBe(localStorage);
    expect(registry.resolve('s3')).toBe(s3Storage);
  });
});

function createStorage(provider: 'local' | 's3'): StorageService {
  return {
    provider,
    upload: jest.fn(),
    getDownload: jest.fn(),
    delete: jest.fn(),
  };
}
