/**
 * Local disk storage for profile photos (avatars).
 * Public paths are `/uploads/avatars/<filename>`; DB stores that path.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** backend/ root (services/ → ..) */
export const BACKEND_ROOT = path.resolve(__dirname, '..');
export const AVATAR_UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads', 'avatars');
export const AVATAR_PUBLIC_PREFIX = '/uploads/avatars/';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function ensureAvatarUploadDir() {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
}

/**
 * @param {string|null|undefined} mimetype
 */
export function isAllowedAvatarMime(mimetype) {
  return ALLOWED_MIME.has(String(mimetype || '').toLowerCase());
}

/**
 * @param {string} mimetype
 * @returns {'.jpg'|'.png'|'.webp'|null}
 */
export function extensionForAvatarMime(mimetype) {
  const mime = String(mimetype || '').toLowerCase();
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return null;
}

/**
 * @param {string|null|undefined} value — stored avatar_url
 */
export function isManagedAvatarPath(value) {
  if (!value || typeof value !== 'string') return false;
  if (!value.startsWith(AVATAR_PUBLIC_PREFIX)) return false;
  const name = value.slice(AVATAR_PUBLIC_PREFIX.length);
  // Reject path traversal / nested paths
  return Boolean(name) && !name.includes('/') && !name.includes('..') && !name.includes('\\');
}

/**
 * Absolute filesystem path for a managed public avatar path, or null.
 * @param {string|null|undefined} publicPath
 */
export function resolveManagedAvatarFile(publicPath) {
  if (!isManagedAvatarPath(publicPath)) return null;
  const filename = publicPath.slice(AVATAR_PUBLIC_PREFIX.length);
  const full = path.join(AVATAR_UPLOAD_DIR, filename);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(AVATAR_UPLOAD_DIR) + path.sep) && resolved !== path.resolve(AVATAR_UPLOAD_DIR)) {
    return null;
  }
  return resolved;
}

/**
 * @param {string} filename — basename only
 */
export function publicPathForAvatarFilename(filename) {
  return `${AVATAR_PUBLIC_PREFIX}${filename}`;
}

/**
 * Best-effort delete of a managed avatar file. Ignores missing/external URLs.
 * @param {string|null|undefined} publicPath
 */
export function deleteManagedAvatarFile(publicPath) {
  const file = resolveManagedAvatarFile(publicPath);
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
