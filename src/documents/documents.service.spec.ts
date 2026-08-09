import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocumentCategory } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import type { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageRegistry } from '../storage/storage.registry';
import {
  StorageObjectNotFoundError,
  type StorageDownload,
  type StorageDownloadInput,
  type StorageService,
  type StorageUploadInput,
} from '../storage/storage.service';
import { MAX_DOCUMENT_FILE_SIZE } from './document-file.validation';
import { DocumentsService } from './documents.service';

const PDF_BUFFER = Buffer.from('%PDF-1.7\nminimal document');
const ACTOR = { id: 'user-a', organizationId: 'org-a' };

describe('DocumentsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let storageRegistry: ReturnType<typeof createStorageRegistryMock>;
  let audit: ReturnType<typeof createAuditMock>;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = createStorageMock();
    storageRegistry = createStorageRegistryMock(storage);
    audit = createAuditMock();
    service = new DocumentsService(
      prisma as unknown as PrismaService,
      storage,
      storageRegistry as unknown as StorageRegistry,
      audit as unknown as AuditService,
    );
  });

  it('uploads a valid document and stores private metadata', async () => {
    const document = createDocument();
    prisma.document.create.mockResolvedValue(document);

    const result = await service.create(ACTOR, { name: 'Contrato' }, pdfFile());

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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-a',
        actorUserId: 'user-a',
        action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
        entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
        entityId: 'document-1',
      }),
      prisma,
    );
  });

  it('rejects an upload larger than 25 MB before storage', async () => {
    const file = pdfFile({ size: MAX_DOCUMENT_FILE_SIZE + 1 });

    await expect(
      service.create(ACTOR, { name: 'Contrato' }, file),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type even when the file has an allowed extension', async () => {
    const file = pdfFile({
      mimetype: 'text/plain',
      originalname: 'contract.pdf',
    });

    await expect(
      service.create(ACTOR, { name: 'Contrato' }, file),
    ).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a link to an entity that does not exist', async () => {
    prisma.person.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        ACTOR,
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
        ACTOR,
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

    const download = await service.download('document-1', ACTOR);

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
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: 'org-a',
      actorUserId: 'user-a',
      action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
      entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
      entityId: 'document-1',
    });
  });

  it('returns 404 instead of downloading a document from another organization', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.download('document-1', ACTOR)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'document-1',
        organizationId: 'org-a',
        investmentId: null,
      },
    });
    expect(storage.getDownload).not.toHaveBeenCalled();
  });

  it('hides investment-linked documents from callers without financial access', async () => {
    prisma.document.findMany.mockResolvedValue([]);

    await expect(service.findAll('org-a', {})).resolves.toEqual([]);
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', investmentId: null },
      include: {
        person: { select: { id: true, name: true } },
        investment: false,
        unit: { select: { id: true, identifier: true } },
        development: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    await expect(
      service.findAll('org-a', { investmentId: 'investment-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns investment context only to callers with financial access', async () => {
    prisma.document.findMany.mockResolvedValue([]);

    await service.findAll('org-a', { investmentId: 'investment-1' }, true);

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', investmentId: 'investment-1' },
      include: {
        person: { select: { id: true, name: true } },
        investment: { select: { id: true, amount: true } },
        unit: { select: { id: true, identifier: true } },
        development: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('removes private bytes before committing the deletion and audit', async () => {
    const document = createDocument();
    prisma.document.findFirst.mockResolvedValue(document);
    prisma.document.delete.mockResolvedValue(document);

    await service.remove('document-1', ACTOR);

    expect(storage.delete).toHaveBeenCalledWith('documents/private-key.pdf');
    expect(prisma.document.delete).toHaveBeenCalledWith({
      where: { id: 'document-1' },
    });
    expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.document.delete.mock.invocationCallOrder[0],
    );
    expect(storageRegistry.resolve).toHaveBeenCalledWith('local');
    expect(audit.record).toHaveBeenCalledWith(
      {
        organizationId: 'org-a',
        actorUserId: 'user-a',
        action: AUDIT_ACTIONS.DOCUMENT_DELETED,
        entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
        entityId: 'document-1',
      },
      prisma,
    );
  });

  it('returns 404 instead of deleting a document from another organization', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.remove('document-1', ACTOR)).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });

  it('does not delete or audit the record when private-object cleanup fails', async () => {
    const document = createDocument();
    prisma.document.findFirst.mockResolvedValue(document);
    prisma.document.delete.mockResolvedValue(document);
    storage.delete.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.remove('document-1', ACTOR)).rejects.toThrow(
      'provider unavailable',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.document.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('allows a safe retry when the private object was already removed', async () => {
    const document = createDocument();
    prisma.document.findFirst.mockResolvedValue(document);
    prisma.document.delete.mockResolvedValue(document);
    storage.delete.mockRejectedValue(new StorageObjectNotFoundError());

    await expect(service.remove('document-1', ACTOR)).resolves.toMatchObject({
      id: 'document-1',
    });

    expect(prisma.document.delete).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), prisma);
  });

  it('removes the stored object when the database insert fails', async () => {
    prisma.document.create.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.create(ACTOR, { name: 'Contrato' }, pdfFile()),
    ).rejects.toThrow('database unavailable');

    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\/[\w-]+\.pdf$/),
    );
  });

  it('removes the stored object when the transactional audit fails', async () => {
    prisma.document.create.mockResolvedValue(createDocument());
    audit.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      service.create(ACTOR, { name: 'Contrato' }, pdfFile()),
    ).rejects.toThrow('audit unavailable');

    expect(audit.record).toHaveBeenCalledWith(expect.anything(), prisma);
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\/[\w-]+\.pdf$/),
    );
  });

  it('reports a failed upload compensation without masking the database error or logging object details', async () => {
    const databaseError = new Error('database unavailable');
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prisma.document.create.mockRejectedValue(databaseError);
    storage.delete.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.create(ACTOR, { name: 'Contrato' }, pdfFile()),
    ).rejects.toBe(databaseError);

    const serializedLog = String(loggerError.mock.calls[0]?.[0]);
    expect(serializedLog).toContain(
      '"event":"document_storage_compensation_failed"',
    );
    expect(serializedLog).toMatch(/"documentId":"[\w-]+"/);
    expect(serializedLog).toContain('"organizationId":"org-a"');
    expect(serializedLog).toContain('"storageProvider":"local"');
    expect(serializedLog).toContain('"errorName":"Error"');
    expect(serializedLog).not.toContain('storageKey');
    expect(serializedLog).not.toContain('contract.pdf');
    expect(serializedLog).not.toContain('documents/');

    loggerError.mockRestore();
  });
});

interface PrismaMock {
  $transaction: jest.Mock<
    Promise<unknown>,
    [(tx: PrismaMock) => Promise<unknown>]
  >;
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
  const prisma: PrismaMock = {
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: PrismaMock) => Promise<unknown>]
    >(),
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
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  return prisma;
}

function createAuditMock() {
  return {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
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
