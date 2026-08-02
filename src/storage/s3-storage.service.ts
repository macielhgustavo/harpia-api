import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  StorageDownload,
  StorageDownloadInput,
  StorageObjectNotFoundError,
  StorageProviderError,
  StorageService,
  StorageUploadInput,
} from './storage.service';
import { buildAttachmentContentDisposition } from './storage.utils';

const DEFAULT_SIGNED_URL_EXPIRATION_SECONDS = 300;
const MAX_SIGNED_URL_EXPIRATION_SECONDS = 3600;

@Injectable()
export class S3StorageService extends StorageService {
  readonly provider = 's3' as const;
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly signedUrlExpirationSeconds: number;

  constructor(config: ConfigService, client?: S3Client) {
    super();
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.signedUrlExpirationSeconds = this.getSignedUrlExpiration(config);
    this.client =
      client ??
      new S3Client({
        endpoint: config.get<string>('S3_ENDPOINT') || undefined,
        region: config.getOrThrow<string>('S3_REGION'),
        forcePathStyle: this.parseBoolean(
          config.get<string>('S3_FORCE_PATH_STYLE'),
        ),
        credentials: {
          accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
        },
      });
  }

  async upload(input: StorageUploadInput): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch {
      throw new StorageProviderError();
    }
  }

  async getDownload(input: StorageDownloadInput): Promise<StorageDownload> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: input.key }),
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new StorageObjectNotFoundError();
      }
      throw new StorageProviderError();
    }

    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ResponseContentType: input.mimeType,
          ResponseContentDisposition: buildAttachmentContentDisposition(
            input.originalName,
          ),
        }),
        { expiresIn: this.signedUrlExpirationSeconds },
      );
      return { type: 'url', url };
    } catch {
      throw new StorageProviderError();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      throw new StorageProviderError();
    }
  }

  private getSignedUrlExpiration(config: ConfigService): number {
    const rawValue = config.get<string>('SIGNED_URL_EXPIRATION_SECONDS');
    if (!rawValue) return DEFAULT_SIGNED_URL_EXPIRATION_SECONDS;

    const value = Number(rawValue);
    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_SIGNED_URL_EXPIRATION_SECONDS
    ) {
      throw new Error(
        `SIGNED_URL_EXPIRATION_SECONDS must be an integer between 1 and ${MAX_SIGNED_URL_EXPIRATION_SECONDS}`,
      );
    }
    return value;
  }

  private parseBoolean(value?: string): boolean {
    return value?.trim().toLowerCase() === 'true';
  }

  private isNotFound(error: unknown): boolean {
    const s3Error = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      s3Error.name === 'NoSuchKey' ||
      s3Error.name === 'NotFound' ||
      s3Error.$metadata?.httpStatusCode === 404
    );
  }
}
