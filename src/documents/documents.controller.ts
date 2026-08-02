import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { buildAttachmentContentDisposition } from '../storage/storage.utils';
import { MAX_DOCUMENT_FILE_SIZE } from './document-file.validation';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('personId') personId?: string,
    @Query('investmentId') investmentId?: string,
    @Query('unitId') unitId?: string,
    @Query('developmentId') developmentId?: string,
  ) {
    return this.documentsService.findAll(user.organizationId, {
      personId,
      investmentId,
      unitId,
      developmentId,
    });
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const download = await this.documentsService.download(
      id,
      user.organizationId,
    );

    if (download.type === 'url') {
      return response.redirect(download.url);
    }

    response.setHeader('Content-Type', download.mimeType);
    response.setHeader(
      'Content-Disposition',
      buildAttachmentContentDisposition(download.originalName),
    );
    download.stream.once('error', () => {
      if (!response.headersSent) {
        response.status(500).end();
        return;
      }
      response.destroy();
    });
    return download.stream.pipe(response);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.findOne(id, user.organizationId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
    }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.create(user.organizationId, dto, file);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentsService.remove(id, user.organizationId);
  }
}
