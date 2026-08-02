export function buildAttachmentContentDisposition(
  originalName: string,
): string {
  const safeName = originalName.replace(/[\r\n]/g, '').trim() || 'document';
  const fallbackName = safeName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');

  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
