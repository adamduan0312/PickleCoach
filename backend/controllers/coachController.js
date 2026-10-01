import {
  User,
  UserRole,
  CoachProfile,
  CoachAvailability,
  Lesson,
  Booking,
  Review,
  CoachCourtLocation,
  CourtLocation,
  UserReliability,
  sequelize,
} from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { logger } from '../config/logger.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';
import { serializeCoachPublicUser, serializeCoachListItem, serializeCoachProfilePublic, distanceMiles } from '../utils/userDto.js';
import { sortMarketplaceCoaches } from '../utils/marketplaceCoachRank.js';
import { resolveCoachRating } from '../utils/coachRating.js';
import { resolveCoachLocation } from '../utils/coachLocation.js';
import { certificationsForStorage } from '../utils/coachCertifications.js';
import { calendarDateInTimezone, toYmdApi } from '../utils/dateOnly.js';
import { availabilityConflictMessage, validateAvailabilityDates } from '../utils/availabilityRules.js';
import { PUBLIC_ACTIVE_USER_WHERE, findPublicActiveCoach } from '../utils/userLifecycle.js';
import { serializeAvailability } from '../utils/availabilityDto.js';
import {
  marketplaceDiscoveryIncludes,
  marketplaceDiscoveryProfileWhereBase,
  getCoachMarketplaceEligibility,
  syncCoachStripeReadyFromAccount,
} from '../services/coachMarketplaceEligibility.js';
import { listCoachOccupiedBookingIntervals } from '../services/bookingService.js';

const MAX_LIST_ALL_COACHES = 10000;
const MAX_LIST_ALL_AVAILABILITY = 10000;

export const getCoaches = async (req, res) => {
  try {
    const roles = req.user.roles || [];
    /** Marketplace browse: same public cards for students, coaches, and admins. Booking still requires student. */
    if (!roles.includes('student') && !roles.includes('coach') && !roles.includes('admin')) {
      return errorResponse(res, 'Authentication with a student, coach, or admin role is required', 403);
    }

    const {
      page,
      limit,
      lat,
      lng,
      radius,
      rating_system,
      min_skill_rating,
      max_skill_rating,
      min_rating,
      court_location_id,
    } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_COACHES, offset: 0 };
    const isGeoSearch = lat != null && lng != null;

    // Public discovery: Active accounts only (exclude Suspended + Deleted)
    const where = { ...PUBLIC_ACTIVE_USER_WHERE };

    // Marketplace eligibility (DB-only): stripe_ready + later includes for lesson/court/availability
    const profileWhereParts = [{ ...marketplaceDiscoveryProfileWhereBase() }];
    if (min_rating) {
      profileWhereParts.push({ rating_average: { [Op.gte]: parseFloat(min_rating) } });
    }
    // Skill bounds are only accepted with rating_system (validated), so they never span scales.
    if (rating_system) {
      profileWhereParts.push({ rating_system, skill_rating: { [Op.ne]: null } });
      if (min_skill_rating != null) {
        profileWhereParts.push({ skill_rating: { [Op.gte]: min_skill_rating } });
      }
      if (max_skill_rating != null) {
        profileWhereParts.push({ skill_rating: { [Op.lte]: max_skill_rating } });
      }
    }
    const profileWhere =
      profileWhereParts.length === 1
        ? profileWhereParts[0]
        : { [Op.and]: profileWhereParts };

    const courtWhere = { deleted_at: null };
    if (court_location_id != null) {
      const courtExists = await CourtLocation.findOne({
        where: { id: court_location_id, deleted_at: null },
        attributes: ['id'],
      });
      if (!courtExists) {
        return errorResponse(res, 'Court not found', 404);
      }
      courtWhere.id = court_location_id;
    }
    if (isGeoSearch) {
      const latRange = radius / 69;
      const lngRange = radius / (69 * Math.cos(lat * Math.PI / 180));
      courtWhere.latitude = { [Op.between]: [lat - latRange, lat + latRange] };
      courtWhere.longitude = { [Op.between]: [lng - lngRange, lng + lngRange] };
    }

    const includes = [
      // attributes: ['role'] is required — the effective-roles filter below reads coach.userRoles.
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: ['role'] },
      {
        model: CoachProfile,
        as: 'coachProfile',
        where: profileWhere,
        required: true,
      },
      {
        model: UserReliability,
        as: 'reliabilities',
        where: { role: 'coach' },
        required: false,
        attributes: ['role', 'reliability_score', 'last_updated'],
      },
      ...marketplaceDiscoveryIncludes({ courtWhere }),
    ];

    // Avoid Sequelize DISTINCT-subquery + ORDER BY on included CoachProfile (MySQL: unknown column in order clause).
    const coaches = await User.findAndCountAll({
      where,
      subQuery: false,
      include: includes,
      limit: queryLimit,
      offset,
      order: [['coachProfile', 'rating_average', 'DESC']],
      distinct: true, // Count query still uses COUNT(DISTINCT User.id); row query needs accurate ordering
    });

    let filteredCoaches = coaches.rows.filter((coach) =>
      getEffectiveRolesForUserRecord(coach).includes('coach'),
    );
    if (filteredCoaches.length !== coaches.rows.length) {
      coaches.count = Math.max(0, coaches.count - (coaches.rows.length - filteredCoaches.length));
    }
    if (isGeoSearch) {
      const radiusMiles = parseFloat(radius);
      filteredCoaches = filteredCoaches.filter((coach) => {
        if (!coach.coachCourts || coach.coachCourts.length === 0) return false;
        return coach.coachCourts.some((coachCourt) => {
          const court = coachCourt.court;
          if (!court || court.latitude == null || court.longitude == null) return false;
          return distanceMiles(lat, lng, court.latitude, court.longitude) <= radiusMiles;
        });
      });
      coaches.count = filteredCoaches.length;
    }

    const shaped = filteredCoaches.map((c) =>
      serializeCoachListItem(c, {
        searchLat: isGeoSearch ? lat : null,
        searchLng: isGeoSearch ? lng : null,
      }),
    );

    const ranked = sortMarketplaceCoaches(shaped, {
      hasLocation: isGeoSearch,
      ratingSystem: rating_system ?? null,
      minSkill: min_skill_rating ?? null,
      maxSkill: max_skill_rating ?? null,
    });

    if (!isPaginated) {
      return successResponse(res, ranked, 'Coaches retrieved successfully');
    }

    const response = getPagingData(
      { count: coaches.count, rows: ranked },
      page,
      queryLimit
    );
    return paginatedResponse(res, response.items, response.pagination, 'Coaches retrieved successfully');
  } catch (error) {
    logger.error('Get coaches error:', error);
    return errorResponse(res, 'Failed to retrieve coaches', 500);
  }
};

export const getCoachById = async (req, res) => {
  try {
    const { id } = req.params;
    const coach = await User.findOne({
      where: { id, ...PUBLIC_ACTIVE_USER_WHERE },
      include: [
        // attributes: ['role'] is required — the effective-roles check below reads coach.userRoles.
        { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: ['role'] },
        { model: CoachProfile, as: 'coachProfile', where: { deleted_at: null }, required: false },
        { model: CoachAvailability, as: 'availabilities' },
        { model: Lesson, as: 'lessons', where: { is_active: true, deleted_at: null }, required: false },
        { model: Review, as: 'reviewsReceived', required: false, limit: 10, order: [['created_at', 'DESC']], include: [{ model: User, as: 'student', attributes: ['id', 'full_name', 'avatar_url'] }] },
        {
          model: UserReliability,
          as: 'reliabilities',
          where: { role: 'coach' },
          required: false,
          attributes: ['role', 'reliability_score', 'last_updated'],
        },
      ],
    });

    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }
    if (!getEffectiveRolesForUserRecord(coach).includes('coach')) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const payload = serializeCoachPublicUser(coach);
    if (Array.isArray(payload.availabilities)) {
      payload.availabilities = payload.availabilities.map(serializeAvailability);
    }

    // Coach-first marketplace: only expose lesson offerings when coach is listable.
    const eligibility = await getCoachMarketplaceEligibility(coach.id);
    if (!eligibility.listed) {
      payload.lessons = [];
    }

    return successResponse(res, payload, 'Coach retrieved successfully');
  } catch (error) {
    logger.error('Get coach error:', error);
    return errorResponse(res, 'Failed to retrieve coach', 500);
  }
};

export const createCoachProfile = async (req, res) => {
  try {
    const {
      headline,
      bio,
      experience_years,
      skill_rating,
      rating_system,
      certifications,
      location,
    } = req.validated;
    const targetUserId = req.user.id;

    const existingProfile = await CoachProfile.findOne({ where: { user_id: targetUserId } });
    if (existingProfile) {
      return errorResponse(res, 'Coach profile already exists', 409);
    }

    const rating = resolveCoachRating({ skill_rating, rating_system });
    if (!rating.ok) return coachProfileValidationError(res, req, rating);
    const basedIn = await resolveCoachLocation({ location });
    if (!basedIn.ok) return coachProfileValidationError(res, req, basedIn);

    const profile = await CoachProfile.create({
      user_id: targetUserId,
      headline,
      bio,
      experience_years: experience_years ?? 0,
      skill_rating: rating.skill_rating,
      rating_system: rating.rating_system,
      certifications: certificationsForStorage(certifications),
      location: basedIn.location,
    });

    return successResponse(
      res,
      serializeCoachProfilePublic(profile),
      'Coach profile created successfully',
      201,
    );
  } catch (error) {
    if (isGeocodeOutage(error)) return errorResponse(res, error.message, error.status || 503);
    logger.error('Create coach profile error:', error);
    // Include error details in response for debugging
    const errorMessage = error.message || 'Failed to create coach profile';
    return errorResponse(res, errorMessage, 500);
  }
};

function coachProfileValidationError(res, req, result) {
  return res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: [{ field: result.field, message: result.message }],
    requestId: req.id,
  });
}

function isGeocodeOutage(error) {
  return error?.code === 'GEOCODE_UNAVAILABLE' || error?.code === 'GEOCODE_PROVIDER_ERROR';
}

/**
 * Validates the effective rating pair (after merge) and the "Based in" place before writing anything.
 * @param {import('sequelize').Model} profile @param {object} validated
 * @returns {Promise<{ ok: true } | { ok: false, field: string, message: string }>}
 */
async function applyCoachProfileUpdate(profile, validated) {
  const {
    headline,
    bio,
    experience_years,
    certifications,
  } = validated;
  const rating = resolveCoachRating(validated, profile);
  if (!rating.ok) return rating;
  const basedIn = await resolveCoachLocation(validated, profile);
  if (!basedIn.ok) return basedIn;
  await profile.update({
    headline: headline !== undefined ? headline : profile.headline,
    bio: bio !== undefined ? bio : profile.bio,
    experience_years: experience_years !== undefined ? experience_years : profile.experience_years,
    skill_rating: rating.skill_rating,
    rating_system: rating.rating_system,
    certifications: certifications !== undefined ? certificationsForStorage(certifications) : profile.certifications,
    location: basedIn.location,
  });
  return { ok: true };
}

/**
 * PUT /api/coaches/me/profile — authenticated coach updates **their own** profile (no user id in URL).
 */
export const updateMyCoachProfile = async (req, res) => {
  try {
    const profile = await CoachProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }
    const result = await applyCoachProfileUpdate(profile, req.validated);
    if (!result.ok) return coachProfileValidationError(res, req, result);
    return successResponse(
      res,
      serializeCoachProfilePublic(profile),
      'Coach profile updated successfully',
    );
  } catch (error) {
    if (isGeocodeOutage(error)) return errorResponse(res, error.message, error.status || 503);
    logger.error('Update my coach profile error:', error);
    return errorResponse(res, 'Failed to update coach profile', 500);
  }
};

/**
 * PUT /api/coaches/profile/:id — **admin only**. `:id` is the coach’s **user id** (support / corrections).
 * Coaches must use **`PUT /api/coaches/me/profile`** instead.
 */
export const updateCoachProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await CoachProfile.findOne({ where: { user_id: id } });

    if (!profile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }

    const result = await applyCoachProfileUpdate(profile, req.validated);
    if (!result.ok) return coachProfileValidationError(res, req, result);
    return successResponse(
      res,
      serializeCoachProfilePublic(profile),
      'Coach profile updated successfully',
    );
  } catch (error) {
    if (isGeocodeOutage(error)) return errorResponse(res, error.message, error.status || 503);
    logger.error('Update coach profile error:', error);
    return errorResponse(res, 'Failed to update coach profile', 500);
  }
};

/** Normalize "9:00" or "09:00" to "09:00:00" for storage. */
function normalizeTimeOfDay(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
  if (parts.length === 3) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  return null;
}

/** JSON shape for availability rows (stable DATEONLY strings). */
function shapeAvailabilityForApi(row) {
  return serializeAvailability(row);
}

/** Normalize time string to "HH:mm:ss" for comparison. */
function toComparableTime(t) {
  if (!t || typeof t !== 'string') return null;
  const n = normalizeTimeOfDay(t.trim());
  return n && n.length === 5 ? `${n.slice(0, 5)}:00` : n;
}

/** True if two time-of-day ranges (HH:mm or HH:mm:ss) intersect. */
function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = toComparableTime(aStart);
  const ae = toComparableTime(aEnd);
  const bs = toComparableTime(bStart);
  const be = toComparableTime(bEnd);
  if (!as || !ae || !bs || !be) return false;
  return as < be && bs < ae;
}

/** True if two date-only ranges (YYYY-MM-DD or null for unbounded) overlap. */
function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = aStart || '0000-01-01';
  const aE = aEnd || '9999-12-31';
  const bS = bStart || '0000-01-01';
  const bE = bEnd || '9999-12-31';
  return aS <= bE && bS <= aE;
}

function availabilityFieldError(res, req, field, message) {
  return res.status(400).json({
    success: false,
    error: 'Validation failed',
    message,
    details: [{ field, message }],
    requestId: req.id,
  });
}

/** Past/ceiling date checks against "today" in the coach's own timezone. */
function checkAvailabilityDates(req, startDate, endDate) {
  const today = calendarDateInTimezone(new Date(), req.user.timezone || 'UTC');
  return validateAvailabilityDates({ start_date: startDate, end_date: endDate }, { today });
}

/**
 * First same-weekday window (earliest start) whose date range and time range overlap the requested one,
 * turned into a 400 error that names it; null when there is no conflict.
 */
function availabilityConflictError(rows, weekday, requested) {
  const conflict = [...rows]
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
    .find((row) =>
      dateRangesOverlap(requested.start_date, requested.end_date, toYmdApi(row.start_date), toYmdApi(row.end_date))
      && timeRangesOverlap(requested.start_time, requested.end_time, row.start_time, row.end_time));
  if (!conflict) return null;
  const err = new Error(availabilityConflictMessage({
    weekday,
    existing: {
      start_time: conflict.start_time,
      end_time: conflict.end_time,
      start_date: toYmdApi(conflict.start_date),
      end_date: toYmdApi(conflict.end_date),
    },
    requested,
  }));
  err.statusCode = 400;
  err.conflictId = conflict.id;
  return err;
}

function availabilityConflictResponse(res, req, err) {
  return res.status(400).json({
    success: false,
    error: 'Availability overlap',
    message: err.message,
    conflict_availability_id: err.conflictId,
    requestId: req.id,
  });
}

/**
 * POST /api/coaches/me/availability
 * Coach only (route); `coach_id` is always `req.user.id` — never taken from the body or URL coach param.
 */
export const createAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, `Only coaches can create availability. Your roles: ${(req.user.roles || []).join(', ') || 'none'}.`, 403);
    }

    const coach_id = req.user.id;
    const { weekday, start_date, end_date, start_time, end_time } = req.validated;

    const resolvedStartDate = start_date ?? null;
    const resolvedEndDate = end_date ?? null;
    const resolvedStartTime = normalizeTimeOfDay(start_time);
    const resolvedEndTime = normalizeTimeOfDay(end_time);

    const dates = checkAvailabilityDates(req, resolvedStartDate, resolvedEndDate);
    if (!dates.ok) return availabilityFieldError(res, req, dates.field, dates.message);

    let availability;
    try {
      availability = await sequelize.transaction(async (t) => {
        // Serialize concurrent create/update for this coach (empty-table gap-lock safe).
        await User.findByPk(coach_id, { transaction: t, lock: t.LOCK.UPDATE });

        const existing = await CoachAvailability.findAll({
          where: { coach_id, weekday },
          attributes: ['id', 'start_date', 'end_date', 'start_time', 'end_time'],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        const conflict = availabilityConflictError(existing, weekday, {
          start_date: resolvedStartDate,
          end_date: resolvedEndDate,
          start_time: resolvedStartTime,
          end_time: resolvedEndTime,
        });
        if (conflict) throw conflict;

        return CoachAvailability.create(
          {
            coach_id,
            weekday,
            start_date: resolvedStartDate,
            end_date: resolvedEndDate,
            start_time: resolvedStartTime,
            end_time: resolvedEndTime,
          },
          { transaction: t },
        );
      });
    } catch (err) {
      if (err?.statusCode === 400) return availabilityConflictResponse(res, req, err);
      throw err;
    }

    return successResponse(res, shapeAvailabilityForApi(availability), 'Availability created successfully');
  } catch (error) {
    logger.error('Create availability error:', error);
    return errorResponse(res, 'Failed to create availability', 500);
  }
};

async function listCoachAvailabilityForResponse(req, res, coachId, { includeOccupiedSlots = false } = {}) {
  const { page, limit } = req.validated || {};
  const isPaginated = page != null || limit != null;
  const { limit: queryLimit, offset } = isPaginated
    ? getPagination(page, limit)
    : { limit: MAX_LIST_ALL_AVAILABILITY, offset: 0 };

  const availabilities = await CoachAvailability.findAndCountAll({
    where: { coach_id: coachId },
    limit: queryLimit,
    offset,
    order: [
      ['weekday', 'ASC'],
      ['start_time', 'ASC'],
    ],
  });

  const shapedRows = availabilities.rows.map((r) => shapeAvailabilityForApi(r));

  let occupiedSlots = null;
  if (includeOccupiedSlots) {
    occupiedSlots = await listCoachOccupiedBookingIntervals(coachId);
  }

  if (!isPaginated) {
    if (occupiedSlots) {
      return res.status(200).json({
        success: true,
        message: 'Availability retrieved successfully',
        data: shapedRows,
        occupied_slots: occupiedSlots,
      });
    }
    return successResponse(res, shapedRows, 'Availability retrieved successfully');
  }
  const response = getPagingData({ count: availabilities.count, rows: shapedRows }, page, queryLimit);
  if (occupiedSlots) {
    return res.status(200).json({
      success: true,
      message: 'Availability retrieved successfully',
      data: response.items,
      pagination: response.pagination,
      occupied_slots: occupiedSlots,
    });
  }
  return paginatedResponse(res, response.items, response.pagination, 'Availability retrieved successfully');
}

/**
 * GET /api/coaches/:id/availability
 * Student or admin only (route). Used for booking another coach’s public weekly windows.
 */
export const getCoachAvailability = async (req, res) => {
  try {
    const coachId = parseInt(req.params.id, 10);
    if (!Number.isFinite(coachId) || coachId < 1) {
      return errorResponse(res, 'Invalid coach ID', 400);
    }
    const coach = await findPublicActiveCoach(coachId);
    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }
    return await listCoachAvailabilityForResponse(req, res, coachId, { includeOccupiedSlots: true });
  } catch (error) {
    logger.error('Get availability error:', error);
    return errorResponse(res, 'Failed to retrieve availability', 500);
  }
};

/**
 * GET /api/coaches/me/availability
 * Lists only the authenticated coach’s availability rows.
 */
export const getMyCoachAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only coaches can list their availability', 403);
    }
    return await listCoachAvailabilityForResponse(req, res, req.user.id);
  } catch (error) {
    logger.error('Get my availability error:', error);
    return errorResponse(res, 'Failed to retrieve availability', 500);
  }
};

/**
 * PUT /api/coaches/me/availability/:id
 * Replace/update one slot; ownership enforced (`coach_id` must match `req.user.id`).
 */
export const updateMyAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only coaches can update availability', 403);
    }

    const availabilityId = parseInt(req.params.id, 10);
    if (!Number.isFinite(availabilityId)) {
      return errorResponse(res, 'Invalid availability ID', 400);
    }

    const coach_id = req.user.id;
    const { weekday, start_date, end_date, start_time, end_time } = req.validated;

    const resolvedStartDate = start_date ?? null;
    const resolvedEndDate = end_date ?? null;
    const resolvedStartTime = normalizeTimeOfDay(start_time);
    const resolvedEndTime = normalizeTimeOfDay(end_time);

    const dates = checkAvailabilityDates(req, resolvedStartDate, resolvedEndDate);
    if (!dates.ok) return availabilityFieldError(res, req, dates.field, dates.message);

    let row;
    try {
      row = await sequelize.transaction(async (t) => {
        await User.findByPk(coach_id, { transaction: t, lock: t.LOCK.UPDATE });

        const locked = await CoachAvailability.findByPk(availabilityId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked) {
          const err = new Error('Availability not found');
          err.statusCode = 404;
          throw err;
        }
        if (locked.coach_id !== coach_id) {
          const err = new Error('You can only update your own availability');
          err.statusCode = 403;
          throw err;
        }

        const existing = await CoachAvailability.findAll({
          where: {
            coach_id,
            weekday,
            id: { [Op.ne]: availabilityId },
          },
          attributes: ['id', 'start_date', 'end_date', 'start_time', 'end_time'],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        const conflict = availabilityConflictError(existing, weekday, {
          start_date: resolvedStartDate,
          end_date: resolvedEndDate,
          start_time: resolvedStartTime,
          end_time: resolvedEndTime,
        });
        if (conflict) throw conflict;

        await locked.update(
          {
            weekday,
            start_date: resolvedStartDate,
            end_date: resolvedEndDate,
            start_time: resolvedStartTime,
            end_time: resolvedEndTime,
          },
          { transaction: t },
        );
        await locked.reload({ transaction: t });
        return locked;
      });
    } catch (err) {
      if (err?.statusCode === 404) return errorResponse(res, err.message, 404);
      if (err?.statusCode === 403) return errorResponse(res, err.message, 403);
      if (err?.statusCode === 400) return availabilityConflictResponse(res, req, err);
      throw err;
    }

    return successResponse(res, shapeAvailabilityForApi(row), 'Availability updated successfully');
  } catch (error) {
    logger.error('Update availability error:', error);
    return errorResponse(res, 'Failed to update availability', 500);
  }
};

/**
 * DELETE /api/coaches/me/availability/:id
 * Coach only; can only delete their own availability.
 */
export const deleteAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, `Only coaches can delete their availability. Your roles: ${(req.user.roles || []).join(', ') || 'none'}. Add the coach role via PUT /api/auth/me/role with body { "role": "coach" } if you intend to coach.`, 403);
    }

    const availabilityId = parseInt(req.params.id, 10);
    if (!Number.isFinite(availabilityId)) {
      return errorResponse(res, 'Invalid availability ID', 400);
    }
    const availability = await CoachAvailability.findByPk(availabilityId);

    if (!availability) {
      return errorResponse(res, 'Availability not found', 404);
    }

    if (availability.coach_id !== req.user.id) {
      return errorResponse(res, 'You can only delete your own availability', 403);
    }

    await availability.destroy();
    return successResponse(res, null, 'Availability deleted successfully');
  } catch (error) {
    logger.error('Delete availability error:', error);
    return errorResponse(res, 'Failed to delete availability', 500);
  }
};

/**
 * GET /api/coaches/me/marketplace-status
 * Checklist for whether this coach appears in student discovery.
 * Optionally refreshes local stripe_ready from Stripe (single coach — OK to call Stripe).
 *
 * Dev/seed Connect ids (`acct_davie_*`, `acct_testflow_*`, … — see
 * {@link isDevSeedStripeConnectAccountId}) skip live Stripe sync so Discover
 * (DB `stripe_ready`) and this checklist stay aligned for QA fixtures.
 */
export const getMyMarketplaceStatus = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach') && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Only coaches can check marketplace status', 403);
    }

    const coachId = (req.user.roles || []).includes('admin') && req.query.coach_id
      ? Number(req.query.coach_id)
      : req.user.id;
    if (!Number.isFinite(coachId)) {
      return errorResponse(res, 'Coach ID is required', 400);
    }

    const coachProfile = await CoachProfile.findOne({ where: { user_id: coachId } });
    if (coachProfile?.stripe_account_id && !isDevSeedStripeConnectAccountId(coachProfile.stripe_account_id)) {
      try {
        const stripe = (await import('../services/stripeService.js')).default;
        const account = await stripe.accounts.retrieve(coachProfile.stripe_account_id);
        await syncCoachStripeReadyFromAccount(coachProfile, account);
      } catch (syncErr) {
        logger.warn('Marketplace status: Stripe sync failed; using DB stripe_ready', {
          coachId,
          message: syncErr.message,
        });
      }
    } else if (coachProfile?.stripe_ready && !coachProfile.stripe_account_id) {
      await coachProfile.update({ stripe_ready: false, stripe_onboarding_completed_at: null });
    }

    const eligibility = await getCoachMarketplaceEligibility(coachId);
    return successResponse(res, eligibility, 'Marketplace status retrieved successfully');
  } catch (error) {
    logger.error('Get marketplace status error:', error);
    return errorResponse(res, 'Failed to retrieve marketplace status', 500);
  }
};

/** Mutable deps for unit tests (ESM named exports are read-only). */
export const stripeConnectOnboardDeps = {
  loadStripeService: () => import('../services/stripeService.js'),
  loadAudit: () => import('../utils/audit.js'),
};

/**
 * Fake Connect account ids used by local seed scripts. Live Stripe sync would
 * mark them not-ready and unlist coaches that Discover still shows via DB stripe_ready.
 *
 * Keep in sync with seed scripts (`acct_davie_*`, `acct_pinecrest_*`, `acct_rating_*`,
 * `acct_diverse_*`, `acct_testflow_*`, `acct_seed_*`). Do **not** treat `acct_restored_*`
 * as seed — those are intentionally cleared as invalid.
 */
export function isDevSeedStripeConnectAccountId(accountId) {
  const id = String(accountId || '');
  return (
    id.startsWith('acct_testflow_')
    || id.startsWith('acct_seed_')
    || id.startsWith('acct_davie_')
    || id.startsWith('acct_pinecrest_')
    || id.startsWith('acct_rating_')
    || id.startsWith('acct_diverse_')
  );
}

/** Mutable deps for GET stripe-connect/status unit tests. */
export const stripeConnectStatusDeps = {
  loadStripeService: () => import('../services/stripeService.js'),
};

/**
 * True when Stripe says the Connect account id is gone / never existed.
 * Used to clear stale seed or deleted-dashboard account ids instead of 500ing.
 */
export function isStripeConnectAccountMissingError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const type = String(error.type || '');
  const statusCode = Number(error.statusCode || error.status || 0);
  const message = String(error.message || '');

  // Bad API credentials / misconfiguration — never treat as "account gone"
  if (type === 'StripeAuthenticationError' || statusCode === 401) {
    return false;
  }

  if (code === 'resource_missing') return true;
  if (statusCode === 404 && /account/i.test(message)) return true;

  // Live Stripe often returns PermissionError + account_invalid for deleted /
  // inaccessible Connect accounts (probe: 403, "does not have access… or does not exist").
  if (code === 'account_invalid' || type === 'StripePermissionError') {
    if (
      /no such account|account does not exist|does not have access to account|could not be found/i.test(
        message,
      )
    ) {
      return true;
    }
  }

  if (
    type === 'StripeInvalidRequestError' &&
    /no such account|no such customer|could not be found|invalid.*account/i.test(message)
  ) {
    return true;
  }

  return false;
}

/**
 * Stripe Connect account ids look like `acct_1ABC…` (alphanumeric after prefix).
 * Seed fakes such as `acct_testflow_seed` are not valid Stripe ids — clear locally
 * without calling Stripe (avoids opaque failures / connection noise).
 */
export function isPlausibleStripeConnectAccountId(accountId) {
  return typeof accountId === 'string' && /^acct_[A-Za-z0-9]+$/.test(accountId);
}

/**
 * POST /api/coaches/me/stripe-connect/onboard
 * Initiate or resume Stripe Connect onboarding for coach.
 *
 * The Connect account is created exactly once; Account Links are single-use and
 * expire (~5 min), so every call while `stripe_ready` is false mints a fresh link
 * for the existing account (Stripe's `refresh_url` pattern). Coaches who abandon
 * onboarding mid-flow can always come back — never 409 on an unfinished account.
 */
export const initiateStripeConnectOnboarding = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach') && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, `Only coaches can onboard with Stripe Connect. Your roles: ${(req.user.roles || []).join(', ') || 'none'}.`, 403);
    }

    const coachId = (req.user.roles || []).includes('admin') ? req.body.coach_id : req.user.id;
    if (!coachId) {
      return errorResponse(res, 'Coach ID is required', 400);
    }

    const coach = await User.findByPk(coachId, {
      include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
    });
    const coachRoles = getEffectiveRolesForUserRecord(coach);
    if (!coach || !coachRoles.includes('coach')) {
      return errorResponse(res, 'Coach not found', 404);
    }

    const coachProfile = await CoachProfile.findOne({ where: { user_id: coachId } });
    if (!coachProfile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }

    // Finished accounts manage themselves via the Express Dashboard — nothing to onboard.
    if (coachProfile.stripe_ready) {
      return errorResponse(res, 'Stripe Connect onboarding is already complete', 409);
    }

    const { createConnectAccount, createAccountLink } = await stripeConnectOnboardDeps.loadStripeService();
    const { logAudit } = await stripeConnectOnboardDeps.loadAudit();

    // Create the Connect account only on the first call; reuse it on retries.
    let accountId = coachProfile.stripe_account_id;
    const isNewAccount = !accountId;
    if (isNewAccount) {
      const account = await createConnectAccount(coach.email, {
        user_id: coachId.toString(),
        coach_profile_id: coachProfile.id.toString(),
      });
      accountId = account.id;

      // Not yet ready for marketplace until hosted onboarding completes
      await coachProfile.update({
        stripe_account_id: accountId,
        stripe_ready: false,
        stripe_onboarding_completed_at: null,
      });
    }

    // Always mint a fresh onboarding link (previous links may be used or expired)
    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || `${process.env.APP_URL || 'http://localhost:3000'}/coach/onboarding/return`;
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL || `${process.env.APP_URL || 'http://localhost:3000'}/coach/onboarding/refresh`;

    const accountLink = await createAccountLink(accountId, returnUrl, refreshUrl);

    await logAudit(
      req.user.id,
      isNewAccount ? 'stripe_connect_onboarding_initiated' : 'stripe_connect_onboarding_link_refreshed',
      'coach_profiles',
      coachProfile.id,
      null,
      { stripe_account_id: accountId },
      req,
    );

    return successResponse(
      res,
      {
        account_id: accountId,
        onboarding_url: accountLink.url,
        expires_at: accountLink.expires_at,
      },
      isNewAccount
        ? 'Stripe Connect onboarding initiated successfully'
        : 'Stripe Connect onboarding link refreshed successfully',
      isNewAccount ? 201 : 200,
    );
  } catch (error) {
    logger.error('Stripe Connect onboarding error:', error);
    return errorResponse(res, 'Failed to initiate Stripe Connect onboarding', 500);
  }
};

/**
 * GET /api/coaches/me/stripe-connect/status
 * Get Stripe Connect account status and sync local stripe_ready for discovery.
 *
 * Missing/invalid Connect account ids (deleted in Dashboard, seed fakes like
 * `acct_testflow_seed`) clear local state and return 200 `onboarded: false`
 * so the coach can re-onboard — same spirit as marketplace-status Stripe soft-fail.
 * Transient Stripe failures return 502 (not an opaque 500).
 */
export const getStripeConnectStatus = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach') && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Only coaches can check Stripe Connect status', 403);
    }

    const coachId = (req.user.roles || []).includes('admin') ? req.query.coach_id : req.user.id;
    if (!coachId) {
      return errorResponse(res, 'Coach ID is required', 400);
    }

    const coachProfile = await CoachProfile.findOne({ where: { user_id: coachId } });
    if (!coachProfile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }

    if (!coachProfile.stripe_account_id) {
      if (coachProfile.stripe_ready) {
        await coachProfile.update({ stripe_ready: false, stripe_onboarding_completed_at: null });
      }
      return successResponse(res, {
        onboarded: false,
        account_id: null,
        stripe_ready: false,
      }, 'Coach not onboarded with Stripe Connect');
    }

    const storedAccountId = coachProfile.stripe_account_id;

    // Dev seed Connect ids are intentional QA fixtures (Discover uses DB stripe_ready).
    // Do not clear them or call Stripe — that was unlisting seed coaches while Discover
    // still showed them until the next list query after AuthContext refreshed status.
    if (isDevSeedStripeConnectAccountId(storedAccountId)) {
      return successResponse(
        res,
        {
          onboarded: Boolean(coachProfile.stripe_ready),
          account_id: storedAccountId,
          stripe_ready: Boolean(coachProfile.stripe_ready),
          seed_connect_account: true,
        },
        'Dev seed Stripe Connect account — local stripe_ready used (no live Stripe sync)',
      );
    }

    if (!isPlausibleStripeConnectAccountId(storedAccountId)) {
      logger.warn('Stripe Connect status: stored account id is not a valid Stripe Connect id; clearing', {
        coachId,
        accountId: storedAccountId,
      });
      await coachProfile.update({
        stripe_account_id: null,
        stripe_ready: false,
        stripe_onboarding_completed_at: null,
      });
      return successResponse(
        res,
        {
          onboarded: false,
          account_id: null,
          stripe_ready: false,
          cleared_invalid_account: true,
        },
        'Stored Stripe Connect account id was invalid; local state cleared',
      );
    }

    try {
      const stripeMod = await stripeConnectStatusDeps.loadStripeService();
      const stripe = stripeMod.default || stripeMod;
      const account = await stripe.accounts.retrieve(storedAccountId);
      const stripeReady = await syncCoachStripeReadyFromAccount(coachProfile, account);

      return successResponse(res, {
        onboarded: true,
        account_id: coachProfile.stripe_account_id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        email: account.email,
        stripe_ready: stripeReady,
      }, 'Stripe Connect status retrieved successfully');
    } catch (stripeError) {
      if (isStripeConnectAccountMissingError(stripeError)) {
        logger.warn('Stripe Connect status: stored account missing in Stripe; clearing local Connect state', {
          coachId,
          accountId: storedAccountId,
          message: stripeError.message,
          code: stripeError.code,
        });
        await coachProfile.update({
          stripe_account_id: null,
          stripe_ready: false,
          stripe_onboarding_completed_at: null,
        });
        return successResponse(
          res,
          {
            onboarded: false,
            account_id: null,
            stripe_ready: false,
            cleared_invalid_account: true,
          },
          'Stored Stripe Connect account was invalid or deleted; local state cleared',
        );
      }

      logger.error('Get Stripe Connect status Stripe error:', stripeError);
      return errorResponse(
        res,
        'Temporarily unable to retrieve Stripe Connect status from Stripe',
        502,
        null,
        {
          code: 'stripe_connect_status_unavailable',
          account_id: storedAccountId,
          stripe_ready: !!coachProfile.stripe_ready,
        },
      );
    }
  } catch (error) {
    logger.error('Get Stripe Connect status error:', error);
    return errorResponse(res, 'Failed to retrieve Stripe Connect status', 500);
  }
};
