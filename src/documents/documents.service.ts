import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
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

const documentInclude = {
  person: { select: { id: true, name: true } },
  investment: { select: { id: true, amount: true } },
  unit: { select: { id: true, identifier: true } },
  development: { select: { id: true, name: true } },
} satisfies Prisma.DocumentInclude;

interface DocumentFilters {
  personId?: string;
  investmentId?: string;
  unitId?: string;
  developmentId?: string;
}

type DocumentDownload = StorageDownload & {
  originalName: string;
  mimeType: string;
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly defaultStorage: StorageService,
    private readonly storageRegistry: StorageRegistry,
  ) {}

  async findAll(organizationId: string, filters: DocumentFilters) {
    const where: Prisma.DocumentWhereInput = { organizationId };
    if (filters.personId) where.personId = filters.personId;
    if (filters.investmentId) where.investmentId = filters.investmentId;
    if (filters.unitId) where.unitId = filters.unitId;
    if (filters.developmentId) where.developmentId = filters.developmentId;

    const documents = await this.prisma.document.findMany({
      where,
      include: documentInclude,
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => presentDocument(document));
  }

  async findOne(id: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId },
      include: documentInclude,
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    return presentDocument(document);
  }

  async create(
    organizationId: string,
    dto: CreateDocumentDto,
    file: Express.Multer.File,
  ) {
    const validatedFile = validateDocumentFile(file);
    await this.assertLinksInOrg(dto, organizationId);

    const id = randomUUID();
    const storageKey = `documents/${randomUUID()}.${validatedFile.extension}`;

    await this.defaultStorage.upload({
      key: storageKey,
      body: file.buffer,
      contentType: validatedFile.mimeType,
    });

    try {
      const document = await this.prisma.document.create({
        data: {
          id,
          organizationId,
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
        include: documentInclude,
      });
      return presentDocument(document);
    } catch (error) {
      // The database insert failed after the provider accepted the object.
      // Cleanup must not hide the original database error.
      try {
        await this.defaultStorage.delete(storageKey);
      } catch {
        // A cleanup failure is not actionable without masking the DB failure.
      }
      throw error;
    }
  }

  async download(
    id: string,
    organizationId: string,
  ): Promise<DocumentDownload> {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');

    try {
      const storage = this.storageRegistry.resolve(document.storageProvider);
      const download = await storage.getDownload({
        key: document.storageKey,
        originalName: document.originalName,
        mimeType: document.mimeType,
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

  async remove(id: string, organizationId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, organizationId },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');

    try {
      const storage = this.storageRegistry.resolve(document.storageProvider);
      await storage.delete(document.storageKey);
    } catch (error) {
      if (!(error instanceof StorageObjectNotFoundError)) throw error;
    }

    const deletedDocument = await this.prisma.document.delete({
      where: { id },
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
