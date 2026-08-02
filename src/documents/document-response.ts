import { Prisma } from '@prisma/client';

export const documentPublicSelect = {
  id: true,
  organizationId: true,
  name: true,
  fileUrl: true,
  category: true,
  originalName: true,
  mimeType: true,
  size: true,
  personId: true,
  investmentId: true,
  unitId: true,
  developmentId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentSelect;

export function documentDownloadPath(id: string): string {
  return `/documents/${id}/download`;
}

export function presentDocument<
  T extends { id: string; storageKey: string; storageProvider: string },
>(document: T) {
  const { storageKey, storageProvider, ...metadata } = document;
  void storageKey;
  void storageProvider;
  const downloadUrl = documentDownloadPath(document.id);

  return {
    ...metadata,
    fileUrl: downloadUrl,
    downloadUrl,
  };
}
