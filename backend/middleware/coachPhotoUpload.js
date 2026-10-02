/**
 * Multer middleware for coach gallery photo uploads (multipart field `photos`, one or more files).
 */
import multer from 'multer';
import { randomUUID } from 'crypto';
import { extensionForAvatarMime, isAllowedAvatarMime } from '../utils/avatarStorage.js';
import { COACH_PHOTO_UPLOAD_DIR, ensureCoachPhotoUploadDir } from '../utils/coachPhotoStorage.js';
import { MAX_COACH_PHOTOS, MAX_COACH_PHOTO_BYTES } from '../utils/coachPhotos.js';

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureCoachPhotoUploadDir();
      cb(null, COACH_PHOTO_UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    const ext = extensionForAvatarMime(file.mimetype) || '.jpg';
    cb(null, `${req.user?.id ?? 'anon'}-${randomUUID()}${ext}`);
  },
});

const coachPhotoUpload = multer({
  storage,
  limits: { fileSize: MAX_COACH_PHOTO_BYTES, files: MAX_COACH_PHOTOS },
  fileFilter(_req, file, cb) {
    if (!isAllowedAvatarMime(file.mimetype)) {
      const err = new Error('Please choose JPG, PNG, or WebP images.');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `Each photo must be ${MAX_COACH_PHOTO_BYTES / (1024 * 1024)} MB or smaller.`,
  LIMIT_FILE_COUNT: `You can have up to ${MAX_COACH_PHOTOS} photos.`,
};

/** Express wrapper: maps multer errors to JSON responses. */
export function handleCoachPhotoUpload(req, res, next) {
  coachPhotoUpload.array('photos', MAX_COACH_PHOTOS)(req, res, (err) => {
    if (!err) return next();
    const message = (err instanceof multer.MulterError && MULTER_MESSAGES[err.code]) || err.message || 'Could not upload photos.';
    return res.status(err.status || 400).json({ success: false, message });
  });
}
