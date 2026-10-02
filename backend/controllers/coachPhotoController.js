/**
 * Coach "On the court" gallery — owner-only management under /api/coaches/me/photos.
 * Public read is embedded in GET /api/coaches/:id as `photos`.
 */
import { CoachPhoto, User, sequelize } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';
import { logger } from '../config/logger.js';
import {
  MAX_COACH_PHOTOS,
  orderCoachPhotos,
  orderWithCover,
  serializeCoachPhotoList,
  validateCoachPhotoOrder,
} from '../utils/coachPhotos.js';
import {
  deleteManagedCoachPhotoFile,
  discardUploadedFiles,
  publicPathForCoachPhotoFilename,
} from '../utils/coachPhotoStorage.js';

const listForCoach = (coachId, transaction) =>
  CoachPhoto.findAll({ where: { coach_id: coachId }, transaction });

/** Serialize concurrent edits of one coach's gallery on the coach's user row. */
const lockCoach = (coachId, transaction) =>
  User.findByPk(coachId, { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });

async function persistOrder(ids, transaction) {
  for (const [position, id] of ids.entries()) {
    await CoachPhoto.update({ position }, { where: { id }, transaction });
  }
}

const respondWithList = async (res, coachId, message, status = 200) =>
  successResponse(res, { photos: serializeCoachPhotoList(await listForCoach(coachId)), max_photos: MAX_COACH_PHOTOS }, message, status);

/** GET /api/coaches/me/photos */
export const getMyCoachPhotos = async (req, res) => {
  try {
    return await respondWithList(res, req.user.id, 'Coach photos retrieved successfully');
  } catch (error) {
    logger.error('Get coach photos error:', error);
    return errorResponse(res, 'Failed to retrieve photos', 500);
  }
};

/** POST /api/coaches/me/photos — multipart field `photos` (one or more JPG/PNG/WebP). */
export const uploadMyCoachPhotos = async (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) {
      return errorResponse(res, 'Please choose at least one photo to upload.', 400);
    }
    const coachId = req.user.id;
    let rejection = null;
    await sequelize.transaction(async (transaction) => {
      await lockCoach(coachId, transaction);
      const existing = orderCoachPhotos(await listForCoach(coachId, transaction));
      const remaining = MAX_COACH_PHOTOS - existing.length;
      if (files.length > remaining) {
        rejection = { remaining };
        return;
      }
      const start = existing.length ? existing[existing.length - 1].position + 1 : 0;
      await CoachPhoto.bulkCreate(
        files.map((f, i) => ({ coach_id: coachId, url: publicPathForCoachPhotoFilename(f.filename), position: start + i })),
        { transaction },
      );
    });

    if (rejection) {
      discardUploadedFiles(files);
      const { remaining } = rejection;
      const message = remaining > 0
        ? `You can add ${remaining} more photo${remaining === 1 ? '' : 's'} (up to ${MAX_COACH_PHOTOS} in total).`
        : `You already have ${MAX_COACH_PHOTOS} photos. Delete one to add another.`;
      return errorResponse(res, message, 400, null, { code: 'coach_photo_limit', remaining, max_photos: MAX_COACH_PHOTOS });
    }

    await logAudit(coachId, 'coach_photos_uploaded', 'coach_photos', null, null, { count: files.length }, req);
    return await respondWithList(res, coachId, files.length === 1 ? 'Photo added' : 'Photos added', 201);
  } catch (error) {
    discardUploadedFiles(files);
    logger.error('Upload coach photos error:', error);
    return errorResponse(res, 'Failed to upload photos', 500);
  }
};

/** PUT /api/coaches/me/photos/order — body `{ photo_ids: number[] }`; the first becomes the cover. */
export const reorderMyCoachPhotos = async (req, res) => {
  try {
    const coachId = req.user.id;
    let invalid = null;
    await sequelize.transaction(async (transaction) => {
      await lockCoach(coachId, transaction);
      const existing = await listForCoach(coachId, transaction);
      const check = validateCoachPhotoOrder(existing.map((p) => p.id), req.validated.photo_ids);
      if (!check.ok) {
        invalid = check.message;
        return;
      }
      await persistOrder(check.ids, transaction);
    });
    if (invalid) return errorResponse(res, invalid, 400, null, { code: 'coach_photo_order_invalid' });
    return await respondWithList(res, coachId, 'Photo order saved');
  } catch (error) {
    logger.error('Reorder coach photos error:', error);
    return errorResponse(res, 'Failed to reorder photos', 500);
  }
};

/** PUT /api/coaches/me/photos/:photoId/cover — moves the photo to the front. */
export const setMyCoachCoverPhoto = async (req, res) => {
  try {
    const coachId = req.user.id;
    const photoId = Number(req.params.photoId);
    let found = true;
    await sequelize.transaction(async (transaction) => {
      await lockCoach(coachId, transaction);
      const ordered = orderCoachPhotos(await listForCoach(coachId, transaction));
      if (!ordered.some((p) => p.id === photoId)) {
        found = false;
        return;
      }
      await persistOrder(orderWithCover(ordered.map((p) => p.id), photoId), transaction);
    });
    if (!found) return errorResponse(res, 'Photo not found', 404);
    return await respondWithList(res, coachId, 'Cover photo updated');
  } catch (error) {
    logger.error('Set coach cover photo error:', error);
    return errorResponse(res, 'Failed to set cover photo', 500);
  }
};

/** DELETE /api/coaches/me/photos/:photoId — the next photo becomes the cover if the cover is removed. */
export const deleteMyCoachPhoto = async (req, res) => {
  try {
    const coachId = req.user.id;
    const photoId = Number(req.params.photoId);
    let removed = null;
    await sequelize.transaction(async (transaction) => {
      await lockCoach(coachId, transaction);
      const ordered = orderCoachPhotos(await listForCoach(coachId, transaction));
      removed = ordered.find((p) => p.id === photoId) || null;
      if (!removed) return;
      await CoachPhoto.destroy({ where: { id: photoId, coach_id: coachId }, transaction });
      await persistOrder(ordered.filter((p) => p.id !== photoId).map((p) => p.id), transaction);
    });
    if (!removed) return errorResponse(res, 'Photo not found', 404);
    deleteManagedCoachPhotoFile(removed.url);
    await logAudit(coachId, 'coach_photo_deleted', 'coach_photos', photoId, removed, null, req);
    return await respondWithList(res, coachId, 'Photo deleted');
  } catch (error) {
    logger.error('Delete coach photo error:', error);
    return errorResponse(res, 'Failed to delete photo', 500);
  }
};
