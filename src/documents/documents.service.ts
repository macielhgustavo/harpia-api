import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-events';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageRegistry } from '../storage/storage.registry';
import {
  StorageDownload,
  StorageObjectNotFoundError,
  StorageService,
} from '../storage/storage.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { documentDownloadPath, presentDocument } from './document-response';
import { validateDocumentFile } from './document-file.validation';

function getDocumentInclude(includeFinancialData: boolean) {
  return {
    person: { select: { id: true, name: true } },
    investment: includeFinancialData
      ? { select: { id: true, amount: true } }
      : false,
    unit: { select: { id: true, identifier: true } },
    development: { select: { id: true, name: true } },
  } satisfies Prisma.DocumentInclude;
}

interface DocumentFilters {
  personId?: string;
  investmentId?: string;
  unitId?: string;
  developmentId?: string;
}

interface MutationActor {
  id: string;
  organizationId: string;
}

type DocumentDownload = StorageDownload & {
  originalName: string;
  mimeType: string;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly defaultStorage: StorageService,
    private readonly storageRegistry: StorageRegistry,
    private readonly auditService: AuditService,
  ) {}

  async findAll(
    organizationId: string,
    filters: DocumentFilters,
    includeFinancialData = false,
  ) {
    if (filters.investmentId && !includeFinancialData) {
      throw new ForbiddenException(
        'Você não tem permissão para consultar documentos financeiros.',
      );
    }

    const where: Prisma.DocumentWhereInput = {
      organizationId,
      ...(includeFinancialData ? {} : { investmentId: null }),
    };
    if (filters.personId) where.personId = filters.personId;
    if (filters.investmentId) where.investmentId = filters.investmentId;
    if (filters.unitId) where.unitId = filters.unitId;
    if (filters.developmentId) where.developmentId = filters.developmentId;

    const documents = await this.prisma.document.findMany({
      where,
      include: getDocumentInclude(includeFinancialData),
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => presentDocument(document));
  }

  async findOne(
    id: string,
    organizationId: string,
    includeFinancialData = false,
  ) {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        organizationId,
        ...(includeFinancialData ? {} : { investmentId: null }),
      },
      include: getDocumentInclude(includeFinancialData),
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    return presentDocument(document);
  }

  async create(
    actor: MutationActor,
    dto: CreateDocumentDto,
    file: Express.Multer.File,
    includeFinancialData = false,
  ) {
    const validatedFile = validateDocumentFile(file);
    if (dto.investmentId && !includeFinancialData) {
      throw new ForbiddenException(
        'Você não tem permissão para vincular documentos a investimentos.',
      );
    }
    await this.assertLinksInOrg(dto, actor.organizationId);

    const id = randomUUID();
    const storageKey = `documents/${randomUUID()}.${validatedFile.extension}`;

    await this.defaultStorage.upload({
      key: storageKey,
      body: file.buffer,
      contentType: validatedFile.mimeType,
    });

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const createdDocument = await tx.document.create({
          data: {
            id,
            organizationId: actor.organizationId,
            name: dto.name,
            // Preserved for old consumers, but it now resolves through JWT.
            fileUrl: documentDownloadPath(id),
            storageKey,
            storageProvider: this.defaultStorage.provider,
            originalName: file.originalname || 'document',
            mimeType: validatedFile.mimeType,
            size: file.size,
            category: dto.category,
            personId: dto.personId,
            investmentId: dto.investmentId,
            unitId: dto.unitId,
            developmentId: dto.developmentId,
          },
          include: getDocumentInclude(includeFinancialData),
        });

        await this.auditService.record(
          {
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
            entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
            entityId: createdDocument.id,
            metadata: {
              category: createdDocument.category,
              personId: createdDocument.personId,
              investmentId: createdDocument.investmentId,
              unitId: createdDocument.unitId,
              developmentId: createdDocument.developmentId,
            },
          },
          tx,
        );

        return createdDocument;
      });
      return presentDocument(document);
    } catch (error) {
      // The database insert failed after the provider accepted the object.
      // Cleanup must not hide the original database error.
      try {
        await this.defaultStorage.delete(storageKey);
      } catch (cleanupError) {
        // Preserve the original DB failure, but make a retained private object
        // observable without logging its object key, name or contents.
        this.logger.error(
          JSON.stringify({
            event: 'document_storage_compensation_failed',
            documentId: id,
            organizationId: actor.organizationId,
            storageProvider: this.defaultStorage.provider,
            errorName:
              cleanupError instanceof Error
                ? cleanupError.name
                : 'UnknownStorageError',
          }),
        );
      }
      throw error;
    }
  }

  async download(
    id: string,
    actor: MutationActor,
    includeFinancialData = false,
  ): Promise<DocumentDownload> {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(includeFinancialData ? {} : { investmentId: null }),
      },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');

    try {
      const storage = this.storageRegistry.resolve(document.storageProvider);
      const download = await storage.getDownload({
        key: document.storageKey,
        originalName: document.originalName,
        mimeType: document.mimeType,
      });
      await this.auditService.record({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
        entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
        entityId: document.id,
      });
      return {
        ...download,
        originalName: document.originalName,
        mimeType: document.mimeType,
      };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException('Arquivo do documento não encontrado');
      }
      throw error;
    }
  }

  async remove(id: string, actor: MutationActor, includeFinancialData = false) {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(includeFinancialData ? {} : { investmentId: null }),
      },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');

    try {
      const storage = this.storageRegistry.resolve(document.storageProvider);
      await storage.delete(document.storageKey);
    } catch (error) {
      if (!(error instanceof StorageObjectNotFoundError)) throw error;
    }

    // Deleting storage first preserves the endpoint's failure contract and
    // avoids acknowledging deletion while retaining private bytes. If the DB
    // transaction fails, a retry is safe because missing objects are accepted.
    const deletedDocument = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.document.delete({ where: { id } });
      await this.auditService.record(
        {
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          action: AUDIT_ACTIONS.DOCUMENT_DELETED,
          entityType: AUDIT_ENTITY_TYPES.DOCUMENT,
          entityId: deleted.id,
        },
        tx,
      );
      return deleted;
    });

    return presentDocument(deletedDocument);
  }

  // Validates that each optional relationship belongs to the active tenant.
  private async assertLinksInOrg(
    dto: CreateDocumentDto,
    organizationId: string,
  ) {
    if (dto.personId) {
      await this.assertInOrg(
        this.prisma.person.findFirst({
          where: { id: dto.personId, organizationId },
          select: { id: true },
        }),
        'Pessoa',
      );
    }
    if (dto.investmentId) {
      await this.assertInOrg(
        this.prisma.investment.findFirst({
          where: { id: dto.investmentId, organizationId },
          select: { id: true },
        }),
        'Aporte',
      );
    }
    if (dto.unitId) {
      await this.assertInOrg(
        this.prisma.unit.findFirst({
          where: { id: dto.unitId, organizationId },
          select: { id: true },
        }),
        'Unidade',
      );
    }
    if (dto.developmentId) {
      await this.assertInOrg(
        this.prisma.development.findFirst({
          where: { id: dto.developmentId, organizationId },
          select: { id: true },
        }),
        'Empreendimento',
      );
    }
  }

  private async assertInOrg(
    query: Promise<{ id: string } | null>,
    label: string,
  ) {
    const found = await query;
    if (!found) {
      throw new BadRequestException(`${label} inválido para esta organização`);
    }
  }
}
