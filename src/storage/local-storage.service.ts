import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, open, unlink, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import {
  StorageDownload,
  StorageDownloadInput,
  StorageObjectNotFoundError,
  StorageProviderError,
  StorageService,
  StorageUploadInput,
} from './storage.service';

@Injectable()
export class LocalStorageService extends StorageService {
  readonly provider = 'local' as const;
  private readonly rootPath: string;

  constructor(config: ConfigService) {
    super();
    this.rootPath = resolve(
      process.cwd(),
      config.get<string>('STORAGE_LOCAL_PATH') ?? './uploads',
    );
  }

  async upload(input: StorageUploadInput): Promise<void> {
    const filePath = this.resolveStoragePath(input.key);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.body);
    } catch {
      throw new StorageProviderError();
    }
  }

  async getDownload(input: StorageDownloadInput): Promise<StorageDownload> {
    const filePath = this.resolveStoragePath(input.key);

    try {
      const fileHandle = await open(filePath, 'r');
      return { type: 'stream', stream: fileHandle.createReadStream() };
    } catch (error) {
      if (this.hasCode(error, 'ENOENT')) {
        throw new StorageObjectNotFoundError();
      }
      throw new StorageProviderError();
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveStoragePath(key);

    try {
      await unlink(filePath);
    } catch (error) {
      if (!this.hasCode(error, 'ENOENT')) {
        throw new StorageProviderError();
      }
    }
  }

  private resolveStoragePath(key: string): string {
    if (!key || key.includes('\0')) {
      throw new StorageProviderError('Invalid document storage key');
    }

    const filePath = resolve(this.rootPath, key);
    const pathFromRoot = relative(this.rootPath, filePath);
    if (
      !pathFromRoot ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..\\`) ||
      pathFromRoot.startsWith('../') ||
      isAbsolute(pathFromRoot)
    ) {
      throw new StorageProviderError('Invalid document storage key');
    }

    return filePath;
  }

  private hasCode(error: unknown, code: string): boolean {
    return (error as NodeJS.ErrnoException | undefined)?.code === code;
  }
}
