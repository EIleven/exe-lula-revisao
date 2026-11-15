/** Politica pura do upload; compartilhada pela rota e pelos testes, sem Firebase nem Next. */
export const MAX_MEDIA_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_CONTENT_TYPE = /^(?:image\/(?:png|jpe?g|gif|webp|heic|heif|avif)|video\/[^\s;]+|audio\/[^\s;]+|application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.[^\s;]+|vnd\.ms-[^\s;]+|vnd\.oasis\.opendocument\.[^\s;]+)|text\/plain)$/i;
const SAFE_FILENAME = '[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9]{1,12})?';
const SAFE_RELATIVE_PATH = new RegExp(
  `^(?:avatars/${SAFE_FILENAME}|covers/${SAFE_FILENAME}|postMedia/(?:images|videos|other)/${SAFE_FILENAME}|` +
  `dms/(?:images|videos|audio|files)/${SAFE_FILENAME}|user_files/${SAFE_FILENAME})$`,
);

export function normalizedMediaContentType(raw: string): string {
  return (raw || 'application/octet-stream').toLowerCase().split(';')[0].trim();
}

export function isAllowedMediaContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPE.test(normalizedMediaContentType(contentType));
}

export function isValidMediaStoragePath(storagePath: string, uid: string): boolean {
  if (!uid || !storagePath || storagePath.length > 500 || storagePath.includes('\\') || storagePath.includes('\0')) {
    return false;
  }
  const prefix = `user_uploads/${uid}/`;
  return storagePath.startsWith(prefix) && SAFE_RELATIVE_PATH.test(storagePath.slice(prefix.length));
}

export function contentTypeMatchesMediaPath(storagePath: string, rawContentType: string): boolean {
  const contentType = normalizedMediaContentType(rawContentType);
  if (/\/(?:avatars|covers)\//.test(storagePath)) return contentType.startsWith('image/');
  if (/\/postMedia\/images\//.test(storagePath) || /\/dms\/images\//.test(storagePath)) {
    return contentType.startsWith('image/');
  }
  if (/\/postMedia\/videos\//.test(storagePath) || /\/dms\/videos\//.test(storagePath)) {
    return contentType.startsWith('video/');
  }
  if (/\/dms\/audio\//.test(storagePath)) return contentType.startsWith('audio/');
  return true;
}
