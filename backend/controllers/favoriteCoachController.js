import { UniqueConstraintError } from 'sequelize';
import {
  CoachCourtLocation,
  CoachProfile,
  CourtLocation,
  FavoriteCoach,
  User,
  UserReliability,
  UserRole,
} from '../models/index.js';
import { errorResponse, successResponse } from '../utils/response.js';
import { serializeCoachListItem } from '../utils/userDto.js';
import { coachIsFavoritable } from '../utils/favoriteCoachEligibility.js';
import { logger } from '../config/logger.js';

const COACH_INCLUDES = [
  { model: UserRole, as: 'userRoles', attributes: ['role'], required: false },
  { model: CoachProfile, as: 'coachProfile', required: false },
  {
    model: UserReliability,
    as: 'reliabilities',
    where: { role: 'coach' },
    required: false,
    attributes: ['role', 'reliability_score', 'last_updated'],
  },
  {
    model: CoachCourtLocation,
    as: 'coachCourts',
    required: false,
    include: [{ model: CourtLocation, as: 'court', required: false }],
  },
];

async function loadCoachForFavorite(coachId) {
  return User.findOne({
    where: { id: coachId },
    include: COACH_INCLUDES,
  });
}

function serializeFavorite(row) {
  const coach = row.coach;
  return {
    ...serializeCoachListItem(coach),
    available: coachIsFavoritable(coach),
    favorited_at: row.created_at,
  };
}

/** GET /api/students/me/favorites */
export const listFavoriteCoaches = async (req, res) => {
  try {
    const rows = await FavoriteCoach.findAll({
      where: { student_id: req.user.id },
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'coach', required: true, include: COACH_INCLUDES }],
    });
    return successResponse(res, rows.map(serializeFavorite), 'Favorite coaches retrieved');
  } catch (error) {
    logger.error('List favorite coaches error:', error);
    return errorResponse(res, 'Failed to load favorite coaches', 500);
  }
};

/** GET /api/students/me/favorites/ids — one call for Discover and profile hearts. */
export const listFavoriteCoachIds = async (req, res) => {
  try {
    const rows = await FavoriteCoach.findAll({
      where: { student_id: req.user.id },
      attributes: ['coach_id'],
    });
    return successResponse(res, { coach_ids: rows.map((row) => row.coach_id) }, 'Favorite coaches retrieved');
  } catch (error) {
    logger.error('List favorite coach ids error:', error);
    return errorResponse(res, 'Failed to load favorite coaches', 500);
  }
};

/** POST /api/students/me/favorites — saving the same coach again is a success, not an error. */
export const addFavoriteCoach = async (req, res) => {
  try {
    const coachId = req.validated.coach_id;
    const studentId = req.user.id;
    if (coachId === studentId) {
      return errorResponse(res, 'You can’t save your own profile.', 400);
    }
    const coach = await loadCoachForFavorite(coachId);
    if (!coachIsFavoritable(coach)) {
      return errorResponse(res, 'Coach not found', 404);
    }
    let created = true;
    try {
      await FavoriteCoach.create({ student_id: studentId, coach_id: coachId });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      created = false;
    }
    return successResponse(
      res,
      { coach_id: coachId, created },
      created ? 'Coach saved' : 'Coach already saved',
      created ? 201 : 200,
    );
  } catch (error) {
    logger.error('Add favorite coach error:', error);
    return errorResponse(res, 'Failed to save coach', 500);
  }
};

/** DELETE /api/students/me/favorites/:coachId — removing one that isn't saved is still a success. */
export const removeFavoriteCoach = async (req, res) => {
  try {
    const coachId = Number(req.params.coachId);
    if (!Number.isInteger(coachId) || coachId < 1) {
      return errorResponse(res, 'Coach not found', 400);
    }
    await FavoriteCoach.destroy({ where: { student_id: req.user.id, coach_id: coachId } });
    return successResponse(res, { coach_id: coachId, removed: true }, 'Coach removed from favorites');
  } catch (error) {
    logger.error('Remove favorite coach error:', error);
    return errorResponse(res, 'Failed to remove coach', 500);
  }
};
