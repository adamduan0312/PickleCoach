/**
 * Local disk storage for coach gallery photos.
 * Public paths are `/uploads/coach-photos/<filename>`; coach_photos.url stores that path.
 */
import fs from 'fs';
import path from 'path';
import { BACKEND_ROOT } from './avatarStorage.js';

export const COACH_PHOTO_UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads', 'coach-photos');
export const COACH_PHOTO_PUBLIC_PREFIX = '/uploads/coach-photos/';

export function ensureCoachPhotoUploadDir() {
  fs.mkdirSync(COACH_PHOTO_UPLOAD_DIR, { recursive: true });
}

/** @param {string} filename — basename only */
export function publicPathForCoachPhotoFilename(filename) {
  return `${COACH_PHOTO_PUBLIC_PREFIX}${filename}`;
}

/**
 * Absolute filesystem path for a managed coach photo path, or null (external URL / traversal).
 * @param {string|null|undefined} publicPath
 */
export function resolveManagedCoachPhotoFile(publicPath) {
  if (!publicPath || typeof publicPath !== 'string' || !publicPath.startsWith(COACH_PHOTO_PUBLIC_PREFIX)) return null;
  const name = publicPath.slice(COACH_PHOTO_PUBLIC_PREFIX.length);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  const resolved = path.resolve(COACH_PHOTO_UPLOAD_DIR, name);
  return resolved.startsWith(path.resolve(COACH_PHOTO_UPLOAD_DIR) + path.sep) ? resolved : null;
}

/** Best-effort delete of a managed coach photo file. Ignores missing/external URLs. */
export function deleteManagedCoachPhotoFile(publicPath) {
  const file = resolveManagedCoachPhotoFile(publicPath);
  if (!file) return false;
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Remove just-uploaded multer files (e.g. when the request is rejected after upload). */
export function discardUploadedFiles(files) {
  for (const f of files || []) {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
  }
}
