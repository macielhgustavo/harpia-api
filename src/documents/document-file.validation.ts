import { BadRequestException } from '@nestjs/common';

export const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;

interface ValidatedDocumentFile {
  extension: string;
  mimeType: string;
}

const ALLOWED_FILE_TYPES: Record<
  string,
  { extension: string; hasExpectedContent: (buffer: Buffer) => boolean }
> = {
  'application/pdf': {
    extension: 'pdf',
    hasExpectedContent: (buffer) =>
      buffer.subarray(0, 5).toString() === '%PDF-',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: 'docx',
    hasExpectedContent: (buffer) =>
      hasZipHeader(buffer) && buffer.includes(Buffer.from('word/')),
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extension: 'xlsx',
    hasExpectedContent: (buffer) =>
      hasZipHeader(buffer) && buffer.includes(Buffer.from('xl/')),
  },
  'image/png': {
    extension: 'png',
    hasExpectedContent: (buffer) =>
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/jpeg': {
    extension: 'jpg',
    hasExpectedContent: (buffer) =>
      buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
};

export function validateDocumentFile(
  file?: Express.Multer.File,
): ValidatedDocumentFile {
  if (!file) throw new BadRequestException('Arquivo é obrigatório');

  if (file.size > MAX_DOCUMENT_FILE_SIZE) {
    throw new BadRequestException('O arquivo não pode exceder 25 MB');
  }

  const allowedType = ALLOWED_FILE_TYPES[file.mimetype];
  if (
    !allowedType ||
    !file.buffer ||
    !allowedType.hasExpectedContent(file.buffer)
  ) {
    throw new BadRequestException('Tipo de arquivo não permitido');
  }

  return { extension: allowedType.extension, mimeType: file.mimetype };
}

function hasZipHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}
