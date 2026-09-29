/**
 * Multer middleware for profile photo uploads.
 */
import multer from 'multer';
import { randomUUID } from 'crypto';
import {
  AVATAR_UPLOAD_DIR,
  ensureAvatarUploadDir,
  extensionForAvatarMime,
  isAllowedAvatarMime,
} from '../utils/avatarStorage.js';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureAvatarUploadDir();
      cb(null, AVATAR_UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = extensionForAvatarMime(file.mimetype) || '.jpg';
    const userId = req.user?.id != null ? String(req.user.id) : 'anon';
    cb(null, `${userId}-${randomUUID()}${ext}`);
  },
});

export const avatarUpload = multer({
  storage,
  limits: { fileSize: MAX_AVATAR_BYTES },
  fileFilter(_req, file, cb) {
    if (!isAllowedAvatarMime(file.mimetype)) {
      const err = new Error('Please choose a JPG, PNG, or WebP image.');
      err.status = 400;
      err.code = 'INVALID_AVATAR_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
});

/**
 * Express wrapper: single field `photo`, maps multer errors to JSON responses.
 */
export function handleAvatarUpload(req, res, next) {
  avatarUpload.single('photo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Photo must be 2 MB or smaller.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Could not upload photo.',
      });
    }
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      message: err.message || 'Could not upload photo.',
    });
  });
}
