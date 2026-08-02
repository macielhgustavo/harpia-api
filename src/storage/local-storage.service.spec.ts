import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorageService } from './local-storage.service';
import { StorageObjectNotFoundError } from './storage.service';

describe('LocalStorageService', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'harpia-documents-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('ignores a missing physical file during deletion', async () => {
    const storage = new LocalStorageService(
      new ConfigService({ STORAGE_LOCAL_PATH: temporaryDirectory }),
    );

    await expect(
      storage.delete('documents/missing.pdf'),
    ).resolves.toBeUndefined();
  });

  it('returns a controlled not-found error when the physical file is missing', async () => {
    const storage = new LocalStorageService(
      new ConfigService({ STORAGE_LOCAL_PATH: temporaryDirectory }),
    );

    await expect(
      storage.getDownload({
        key: 'documents/missing.pdf',
        originalName: 'missing.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});
