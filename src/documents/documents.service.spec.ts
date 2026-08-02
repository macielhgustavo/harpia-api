import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentCategory } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageRegistry } from '../storage/storage.registry';
import type {
  StorageDownload,
  StorageDownloadInput,
  StorageService,
  StorageUploadInput,
} from '../storage/storage.service';
import { MAX_DOCUMENT_FILE_SIZE } from './document-file.validation';
import { DocumentsService } from './documents.service';

const PDF_BUFFER = Buffer.from('%PDF-1.7\nminimal document');

describe('DocumentsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let storageRegistry: ReturnType<typeof createStorageRegistryMock>;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = createStorageMock();
    storageRegistry = createStorageRegistryMock(storage);
    service = new DocumentsService(
      prisma as unknown as PrismaService,
      storage,
      storageRegistry as unknown as StorageRegistry,
    );
  });

  it('uploads a valid document and stores private metadata', async () => {
    const document = createDocument();
    prisma.document.create.mockResolvedValue(document);

    const result = await service.create(
      'org-a',
      { name: 'Contrato' },
      pdfFile(),
    );

    const [upload] = storage.upload.mock.calls[0];
    expect(upload.key).toMatch(/^documents\/[\w-]+\.pdf$/);
    expect(upload.body).toBe(PDF_BUFFER);
    expect(upload.contentType).toBe('application/pdf');

    const [createArguments] = prisma.document.create.mock.calls[0];
    expect(createArguments.data).toMatchObject({
      organizationId: 'org-a',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
      size: PDF_BUFFER.length,
      storageProvider: 'local',
    });
    expect(result).toMatchObject({
      fileUrl: '/documents/document-1/download',
      downloadUrl: '/documents/document-1/download',
      originalName: 'contract.pdf',
    });
    expect(result).not.toHaveProperty('storageKey');
    expect(result).not.toHaveProperty('storageProvider');
  });

  it('rejects an upload larger than 25 MB before storage', async () => {
    const file = pdfFile({ size: MAX_DOCUMENT_FILE_SIZE + 1 });

    await expect(
      service.create('org-a', { name: 'Contrato' }, file),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type even when the file has an allowed extension', async () => {
    const file = pdfFile({
      mimetype: 'text/plain',
      originalname: 'contract.pdf',
    });

    await expect(
      service.create('org-a', { name: 'Contrato' }, file),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a link to an entity that does not exist', async () => {
    prisma.person.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        'org-a',
        { name: 'Contrato', personId: 'missing-person' },
        pdfFile(),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a link to an entity from another organization', async () => {
    prisma.person.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        'org-a',
        { name: 'Contrato', personId: 'person-from-org-b' },
        pdfFile(),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.person.findFirst).toHaveBeenCalledWith({
      where: { id: 'person-from-org-b', organizationId: 'org-a' },
      select: { id: true },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('returns a valid local download only for its organization', async () => {
    const stream = Readable.from(PDF_BUFFER);
    prisma.document.findFirst.mockResolvedValue(createDocument());
    storage.getDownload.mockResolvedValue({ type: 'stream', stream });

    const download = await service.download('document-1', 'org-a');

    expect(download).toEqual(
      expect.objectContaining({
        type: 'stream',
        stream,
        originalName: 'contract.pdf',
        mimeType: 'application/pdf',
      }),
    );
    expect(storage.getDownload).toHaveBeenCalledWith({
      key: 'documents/private-key.pdf',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
    });
    expect(storageRegistry.resolve).toHaveBeenCalledWith('local');
  });

  it('returns 404 instead of downloading a document from another organization', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.download('document-1', 'org-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: 'document-1', organizationId: 'org-a' },
    });
    expect(storage.getDownload).not.toHaveBeenCalled();
  });

  it('deletes the stored object before deleting a valid record', async () => {
    const document = createDocument();
    prisma.document.findFirst.mockResolvedValue(document);
    prisma.document.delete.mockResolvedValue(document);

    await service.remove('document-1', 'org-a');

    expect(storage.delete).toHaveBeenCalledWith('documents/private-key.pdf');
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: 'document-1' },
    });
    expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.document.delete.mock.invocationCallOrder[0],
    );
    expect(storageRegistry.resolve).toHaveBeenCalledWith('local');
  });

  it('returns 404 instead of deleting a document from another organization', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.remove('document-1', 'org-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });

  it('removes the stored object when the database insert fails', async () => {
    prisma.document.create.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.create('org-a', { name: 'Contrato' }, pdfFile()),
    ).rejects.toThrow('database unavailable');

    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\/[\w-]+\.pdf$/),
    );
  });
});

interface PrismaMock {
  document: {
    findMany: jest.Mock<Promise<unknown>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [Prisma.DocumentCreateArgs]>;
    delete: jest.Mock<Promise<unknown>, [unknown]>;
  };
  person: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
  investment: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
  unit: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
  development: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
}

interface StorageMock {
  provider: 'local';
  upload: jest.Mock<Promise<void>, [StorageUploadInput]>;
  getDownload: jest.Mock<Promise<StorageDownload>, [StorageDownloadInput]>;
  delete: jest.Mock<Promise<void>, [string]>;
}

interface StorageRegistryMock {
  resolve: jest.Mock<StorageService, [string]>;
}

function createPrismaMock(): PrismaMock {
  return {
    document: {
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [Prisma.DocumentCreateArgs]>(),
      delete: jest.fn<Promise<unknown>, [unknown]>(),
    },
    person: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
    investment: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
    unit: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
    development: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
  };
}

function createStorageMock(): StorageMock {
  return {
    provider: 'local' as const,
    upload: jest
      .fn<Promise<void>, [StorageUploadInput]>()
      .mockResolvedValue(undefined),
    getDownload: jest.fn<Promise<StorageDownload>, [StorageDownloadInput]>(),
    delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  };
}

function createStorageRegistryMock(storage: StorageMock): StorageRegistryMock {
  return {
    resolve: jest.fn<StorageService, [string]>().mockReturnValue(storage),
  };
}

function createDocument() {
  return {
    id: 'document-1',
    organizationId: 'org-a',
    name: 'Contrato',
    fileUrl: '/documents/document-1/download',
    storageKey: 'documents/private-key.pdf',
    storageProvider: 'local',
    originalName: 'contract.pdf',
    mimeType: 'application/pdf',
    size: PDF_BUFFER.length,
    category: DocumentCategory.CONTRATO,
    personId: null,
    investmentId: null,
    unitId: null,
    developmentId: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    person: null,
    investment: null,
    unit: null,
    development: null,
  };
}

function pdfFile(overrides: Partial<Express.Multer.File> = {}) {
  const file = {
    fieldname: 'file',
    originalname: 'contract.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: PDF_BUFFER.length,
    buffer: PDF_BUFFER,
    destination: '',
    filename: '',
    path: '',
    stream: Readable.from(PDF_BUFFER),
  } as Express.Multer.File;

  return { ...file, ...overrides };
}
