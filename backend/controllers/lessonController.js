import { Lesson, User } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { findPublicActiveCoach } from '../utils/userLifecycle.js';
import * as coachMarketplaceEligibility from '../services/coachMarketplaceEligibility.js';
import { buildAdminLessonsWhere, buildLessonPriceWhere } from '../utils/lessonListQuery.js';
import {
  serializePublicMarketplaceLesson,
  serializeCoachOwnerLesson,
  serializeAdminLesson,
  serializeLessonDetail,
} from '../utils/lessonDto.js';

const MAX_LIST_ALL_LESSONS = 10000;

/** Mutable deps for unit tests (ESM named exports are read-only). */
export const lessonByIdDeps = {
  getCoachMarketplaceEligibility: (coachId) =>
    coachMarketplaceEligibility.getCoachMarketplaceEligibility(coachId),
  findPublicActiveCoach: (coachId) => findPublicActiveCoach(coachId),
};

/** Soft-deleted lessons are historical (bookings only); coach lesson APIs treat them as missing. */
function isLessonDeleted(lesson) {
  return lesson?.deleted_at != null;
}

/**
 * GET /api/lessons — **deprecated**. Lesson-first marketplace catalog removed.
 * Discover lessons via GET /api/coaches/:id/lessons (coach-first).
 */
export const getLessons = async (req, res) => {
  return errorResponse(
    res,
    'GET /api/lessons is gone. Lessons are discovered through coaches: GET /api/coaches/:id/lessons. Coach inventory: GET /api/coaches/me/lessons. Admin inventory: GET /api/admin/lessons.',
    410,
    null,
    { code: 'lesson_catalog_removed' },
  );
};

/**
 * GET /api/coaches/:id/lessons
 * Student/marketplace discovery of a coach's public offerings.
 * Active + not deleted; coach must be marketplace-eligible (same as GET /api/coaches).
 */
export const getCoachLessonsById = async (req, res) => {
  try {
    const coachId = req.params.id != null ? parseInt(req.params.id, 10) : null;
    if (!coachId || Number.isNaN(coachId)) {
      return errorResponse(res, 'Valid coach ID is required', 400);
    }

    const coach = await lessonByIdDeps.findPublicActiveCoach(coachId);
    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const eligibility = await lessonByIdDeps.getCoachMarketplaceEligibility(coachId);
    if (!eligibility.listed) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const { page, limit } = req.validated || {};
    const where = {
      coach_id: coachId,
      is_active: true,
      deleted_at: null,
    };

    if (page == null && limit == null) {
      const lessons = await Lesson.findAll({
        where,
        limit: MAX_LIST_ALL_LESSONS,
        order: [['created_at', 'DESC']],
      });
      return successResponse(
        res,
        lessons.map(serializePublicMarketplaceLesson),
        'Lessons retrieved successfully',
      );
    }

    const { limit: queryLimit, offset } = getPagination(page, limit);
    const lessons = await Lesson.findAndCountAll({
      where,
      limit: queryLimit,
      offset,
      distinct: true,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(
      { count: lessons.count, rows: lessons.rows.map(serializePublicMarketplaceLesson) },
      page,
      queryLimit,
    );
    return paginatedResponse(
      res,
      response.items,
      response.pagination,
      'Lessons retrieved successfully',
    );
  } catch (error) {
    logger.error('Get coach lessons by id error:', error);
    return errorResponse(res, 'Failed to retrieve lessons', 500);
  }
};

/**
 * GET /api/admin/lessons
 * Admin inventory — all coaches' lessons, no marketplace eligibility gate.
 * Default: non-deleted (active + inactive). Pass include_deleted=true for soft-deleted too.
 */
export const getAdminLessons = async (req, res) => {
  try {
    const { page, limit, coach_id, is_active, include_deleted, deleted, min_price, max_price } =
      req.validated || {};

    const where = buildAdminLessonsWhere({ coach_id, is_active, include_deleted, deleted });
    const priceWhere = buildLessonPriceWhere({ min_price, max_price });
    if (priceWhere) where.price = priceWhere;

    const coachInclude = {
      model: User,
      as: 'coach',
      attributes: ['id', 'full_name', 'email', 'is_active', 'deleted_at'],
      required: false,
    };

    if (page == null && limit == null) {
      const lessons = await Lesson.findAll({
        where,
        include: [coachInclude],
        limit: MAX_LIST_ALL_LESSONS,
        order: [['created_at', 'DESC']],
      });
      return successResponse(
        res,
        lessons.map(serializeAdminLesson),
        'Lessons retrieved successfully',
      );
    }

    const { limit: queryLimit, offset } = getPagination(page, limit);
    const lessons = await Lesson.findAndCountAll({
      where,
      include: [coachInclude],
      limit: queryLimit,
      offset,
      distinct: true,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(
      { count: lessons.count, rows: lessons.rows.map(serializeAdminLesson) },
      page,
      queryLimit,
    );
    return paginatedResponse(
      res,
      response.items,
      response.pagination,
      'Lessons retrieved successfully',
    );
  } catch (error) {
    logger.error('Get admin lessons error:', error);
    return errorResponse(res, 'Failed to retrieve lessons', 500);
  }
};

export const getMyLessons = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only coaches can view their lessons', 403);
    }

    const { page, limit } = req.validated || {};
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_LESSONS, offset: 0 };

    const lessons = await Lesson.findAndCountAll({
      where: {
        coach_id: req.user.id,
        deleted_at: null,
      },
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    const rows = lessons.rows.map(serializeCoachOwnerLesson);

    if (!isPaginated) {
      return successResponse(res, rows, 'My lessons retrieved successfully');
    }

    const response = getPagingData({ count: lessons.count, rows }, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'My lessons retrieved successfully');
  } catch (error) {
    logger.error('Get my lessons error:', error);
    return errorResponse(res, 'Failed to retrieve my lessons', 500);
  }
};

/**
 * GET /api/lessons/:id
 * Authenticated resource access only — not marketplace discovery.
 * Coach owner: own lessons (including inactive). Admin: any lesson (including soft-deleted).
 * Students discover offerings via GET /api/coaches/:id/lessons.
 */
export const getLessonById = async (req, res) => {
  try {
    if (!req.user) {
      return errorResponse(res, 'Authentication required', 401);
    }

    const { id } = req.params;
    const roles = req.user.roles || [];
    const isAdmin = roles.includes('admin');

    const lesson = await Lesson.findByPk(id, {
      include: isAdmin
        ? [
            {
              model: User,
              as: 'coach',
              attributes: ['id', 'full_name', 'email', 'is_active', 'deleted_at'],
            },
          ]
        : [],
    });

    if (!lesson) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    const isOwner = Number(req.user.id) === Number(lesson.coach_id);

    if (!isAdmin && !isOwner) {
      return errorResponse(
        res,
        'Lesson detail by id is for the lesson owner or admin. Browse offerings via GET /api/coaches/:id/lessons.',
        403,
        null,
        { code: 'lesson_detail_not_for_discovery' },
      );
    }

    // Soft-deleted: coach owner treats as missing; admin may still load for support.
    if (lesson.deleted_at && !isAdmin) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    return successResponse(
      res,
      serializeLessonDetail(lesson, { viewerIsAdmin: isAdmin }),
      'Lesson retrieved successfully',
    );
  } catch (error) {
    logger.error('Get lesson error:', error);
    return errorResponse(res, 'Failed to retrieve lesson', 500);
  }
};

/**
 * POST /api/lessons — coach only (creates for req.user.id).
 * Admins moderate existing lessons via PUT/DELETE /api/lessons/:id, not create.
 */
export const createLesson = async (req, res) => {
  try {
    const { title, description, duration_minutes, price, max_students } = req.validated;

    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only coaches can create lessons', 403);
    }

    const lesson = await Lesson.create({
      coach_id: req.user.id,
      title,
      description,
      duration_minutes,
      price,
      max_students: max_students || 1,
    });

    return successResponse(res, serializeCoachOwnerLesson(lesson), 'Lesson created successfully', 201);
  } catch (error) {
    logger.error('Create lesson error:', error);
    return errorResponse(res, 'Failed to create lesson', 500);
  }
};

export const updateLesson = async (req, res) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findByPk(id);

    if (!lesson) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    if (isLessonDeleted(lesson)) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    if (req.user.id !== lesson.coach_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { title, description, duration_minutes, price, max_students, is_active } = req.validated;

    await lesson.update({
      title: title || lesson.title,
      description: description !== undefined ? description : lesson.description,
      // Use explicit undefined checks (not `||`) so duration/price stay consistent with Joi min() and with effective_hourly_rate = price / (duration_minutes / 60).
      duration_minutes: duration_minutes !== undefined ? duration_minutes : lesson.duration_minutes,
      price: price !== undefined ? price : lesson.price,
      max_students: max_students !== undefined ? max_students : lesson.max_students,
      is_active: is_active !== undefined ? is_active : lesson.is_active,
    });

    return successResponse(res, serializeCoachOwnerLesson(lesson), 'Lesson updated successfully');
  } catch (error) {
    logger.error('Update lesson error:', error);
    return errorResponse(res, 'Failed to update lesson', 500);
  }
};

export const deleteLesson = async (req, res) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findByPk(id);

    if (!lesson) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    if (isLessonDeleted(lesson)) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    if (req.user.id !== lesson.coach_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    await lesson.update({ deleted_at: new Date(), is_active: false });

    return successResponse(res, null, 'Lesson deleted successfully');
  } catch (error) {
    logger.error('Delete lesson error:', error);
    return errorResponse(res, 'Failed to delete lesson', 500);
  }
};
