import { Readable } from 'stream';

export type StorageProvider = 'local' | 's3';

export interface StorageUploadInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageDownloadInput {
  key: string;
  originalName: string;
  mimeType: string;
}

export type StorageDownload =
  | {
      type: 'stream';
      stream: Readable;
    }
  | {
      type: 'url';
      url: string;
    };

/**
 * Contract implemented by every document storage driver.
 *
 * Storage keys are internal identifiers and must never be derived from or
 * exposed as the original file name.
 */
export abstract class StorageService {
  abstract readonly provider: StorageProvider;

  abstract upload(input: StorageUploadInput): Promise<void>;

  abstract getDownload(input: StorageDownloadInput): Promise<StorageDownload>;

  abstract delete(key: string): Promise<void>;
}

export class StorageObjectNotFoundError extends Error {
  constructor() {
    super('Stored object not found');
    this.name = StorageObjectNotFoundError.name;
  }
}

/** A deliberately generic error safe to surface as an internal API error. */
export class StorageProviderError extends Error {
  constructor(message = 'Document storage operation failed') {
    super(message);
    this.name = StorageProviderError.name;
  }
}
