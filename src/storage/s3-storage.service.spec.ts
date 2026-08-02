import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageService } from './s3-storage.service';
import { StorageObjectNotFoundError } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('S3StorageService', () => {
  beforeEach(() => {
    jest.mocked(getSignedUrl).mockReset();
  });

  it('generates a signed URL using the configured short expiration', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client = {
      send,
    } as unknown as S3Client;
    const signedUrl = jest.mocked(getSignedUrl);
    signedUrl.mockResolvedValue('https://storage.example/signed-document');
    const storage = new S3StorageService(
      new ConfigService({
        S3_BUCKET: 'private-documents',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        S3_FORCE_PATH_STYLE: 'false',
        SIGNED_URL_EXPIRATION_SECONDS: '120',
      }),
      client,
    );

    const result = await storage.getDownload({
      key: 'documents/private-key.pdf',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
    });

    expect(send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    expect(signedUrl).toHaveBeenCalledWith(client, expect.anything(), {
      expiresIn: 120,
    });
    expect(result).toEqual({
      type: 'url',
      url: 'https://storage.example/signed-document',
    });
  });

  it('maps an S3 missing-object response to a controlled error', async () => {
    const client = {
      send: jest.fn().mockRejectedValue({ name: 'NotFound' }),
    } as unknown as S3Client;
    const storage = new S3StorageService(
      new ConfigService({
        S3_BUCKET: 'private-documents',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_SECRET_ACCESS_KEY: 'secret-key',
      }),
      client,
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
