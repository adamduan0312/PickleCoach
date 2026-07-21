import { Lesson, User, Booking } from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { isPubliclyActiveUser } from '../utils/userLifecycle.js';
import * as coachMarketplaceEligibility from '../services/coachMarketplaceEligibility.js';

const MAX_LIST_ALL_LESSONS = 10000;

/** Mutable deps for unit tests (ESM named exports are read-only). */
export const lessonByIdDeps = {
  getCoachMarketplaceEligibility: (coachId) =>
    coachMarketplaceEligibility.getCoachMarketplaceEligibility(coachId),
};

/** Strip eligibility join clutter; public lesson cards only need coach id/name/avatar. */
function shapePublicLessonRow(lessonInstance) {
  const json = lessonInstance.get ? lessonInstance.get({ plain: true }) : { ...lessonInstance };
  if (json.coach && typeof json.coach === 'object') {
    json.coach = {
      id: json.coach.id,
      full_name: json.coach.full_name,
      avatar_url: json.coach.avatar_url ?? null,
    };
  }
  return json;
}

/** Coach owner or admin may view **inactive** (not deleted) lessons by id — unpublished, recoverable. */
function canViewInactiveLessonById(user, lesson) {
  if (!user || !lesson) return false;
  const roles = user.roles || [];
  if (roles.includes('admin')) return true;
  const ownerId = lesson.coach_id ?? lesson.get?.('coach_id');
  return Number(user.id) === Number(ownerId);
}

function isLessonPubliclyVisibleById(lesson) {
  if (!lesson || lesson.deleted_at) return false;
  const active = lesson.is_active ?? lesson.get?.('is_active');
  return active === true || active === 1;
}

/** Soft-deleted lessons are historical (bookings only); coach lesson APIs treat them as missing. */
function isLessonDeleted(lesson) {
  return lesson?.deleted_at != null;
}

export const getLessons = async (req, res) => {
  try {
    const { page, limit, coach_id, min_price, max_price } = req.validated;

    const where = { is_active: true, deleted_at: null };
    if (coach_id) where.coach_id = coach_id;
    if (min_price || max_price) {
      where.price = {};
      if (min_price) where.price[Op.gte] = parseFloat(min_price);
      if (max_price) where.price[Op.lte] = parseFloat(max_price);
    }

    const coachInclude = coachMarketplaceEligibility.marketplaceEligibleCoachIncludeForLessonBrowse();

    if (page == null && limit == null) {
      const lessons = await Lesson.findAll({
        where,
        include: [coachInclude],
        limit: MAX_LIST_ALL_LESSONS,
        order: [['created_at', 'DESC']],
        subQuery: false,
      });
      return successResponse(
        res,
        lessons.map(shapePublicLessonRow),
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
      subQuery: false,
      order: [['created_at', 'DESC']],
    });

    const response = getPagingData(
      { count: lessons.count, rows: lessons.rows.map(shapePublicLessonRow) },
      page,
      queryLimit,
    );
    return paginatedResponse(res, response.items, response.pagination, 'Lessons retrieved successfully');
  } catch (error) {
    logger.error('Get lessons error:', error);
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
      include: [{ model: User, as: 'coach', attributes: ['id', 'full_name', 'avatar_url'] }],
      limit: queryLimit,
      offset,
      order: [['created_at', 'DESC']],
    });

    if (!isPaginated) {
      return successResponse(res, lessons.rows, 'My lessons retrieved successfully');
    }

    const response = getPagingData(lessons, page, queryLimit);
    return paginatedResponse(res, response.items, response.pagination, 'My lessons retrieved successfully');
  } catch (error) {
    logger.error('Get my lessons error:', error);
    return errorResponse(res, 'Failed to retrieve my lessons', 500);
  }
};

export const getLessonById = async (req, res) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findByPk(id, {
      include: [
        {
          model: User,
          as: 'coach',
          attributes: ['id', 'full_name', 'avatar_url', 'is_active', 'deleted_at'],
        },
        { model: Booking, as: 'bookings', limit: 5, order: [['scheduled_at', 'DESC']] },
      ],
    });

    if (!lesson) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    // Soft-deleted: not accessible via coach APIs (row kept for bookings/history only).
    if (lesson.deleted_at) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    const privileged = canViewInactiveLessonById(req.user, lesson);
    if (!isLessonPubliclyVisibleById(lesson) && !privileged) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    // Suspended/deleted coaches: hide from public/student browse; owner/admin may still load by id.
    if (!isPubliclyActiveUser(lesson.coach) && !privileged) {
      return errorResponse(res, 'Lesson not found', 404);
    }

    // Option A MVP: public lesson pages only for marketplace-eligible coaches
    // (same definition as GET /api/lessons / GET /api/coaches). Owner/admin always allowed.
    if (!privileged) {
      const eligibility = await lessonByIdDeps.getCoachMarketplaceEligibility(lesson.coach_id);
      if (!eligibility.listed) {
        return errorResponse(res, 'Lesson not found', 404);
      }
    }

    const payload = typeof lesson.toJSON === 'function' ? lesson.toJSON() : { ...lesson };
    if (payload.coach) {
      // Keep public coach shape aligned with list endpoints (no lifecycle internals).
      delete payload.coach.is_active;
      delete payload.coach.deleted_at;
    }

    return successResponse(res, payload, 'Lesson retrieved successfully');
  } catch (error) {
    logger.error('Get lesson error:', error);
    return errorResponse(res, 'Failed to retrieve lesson', 500);
  }
};

export const createLesson = async (req, res) => {
  try {
    const { title, description, duration_minutes, price, max_students } = req.validated;

    if (!(req.user.roles || []).includes('coach') && !(req.user.roles || []).includes('admin')) {
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

    return successResponse(res, lesson, 'Lesson created successfully', 201);
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

    return successResponse(res, lesson, 'Lesson updated successfully');
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
