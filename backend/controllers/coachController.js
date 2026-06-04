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
} from '../models/index.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/sequelize.js';
import { logger } from '../config/logger.js';
import { getEffectiveRolesForUserRecord } from '../utils/roleGovernance.js';
import { toYmdApi } from '../utils/dateOnly.js';

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * Returns distance in miles
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const MAX_LIST_ALL_COACHES = 10000;
const MAX_LIST_ALL_AVAILABILITY = 10000;

const slimCoachReliabilityFromRows = (reliabilityRows) => {
  const rel = (reliabilityRows || []).find((r) => r.role === 'coach');
  if (!rel) {
    return { reliability_score: 100, last_updated: null };
  }
  return {
    reliability_score: parseFloat(rel.reliability_score),
    last_updated: rel.last_updated,
  };
};

const shapeCoachForListing = (coachInstance) => {
  const json = coachInstance.toJSON();
  const relRows = json.reliabilities;
  delete json.reliabilities;
  json.reliability = slimCoachReliabilityFromRows(relRows);
  return json;
};

export const getCoaches = async (req, res) => {
  try {
    const roles = req.user.roles || [];
    /** Coach-only accounts use coach tooling to find students; student + coach and admins may browse. */
    if (!roles.includes('student') && !roles.includes('admin')) {
      return errorResponse(res, 'Only students and admins can search for coaches', 403);
    }

    const { page, limit, lat, lng, radius, min_skill_rating, max_skill_rating, min_rating } = req.validated;
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_COACHES, offset: 0 };

    const where = { is_active: true };

    const profileWhereParts = [];
    if (min_rating) {
      profileWhereParts.push({ rating_average: { [Op.gte]: parseFloat(min_rating) } });
    }
    if (min_skill_rating != null || max_skill_rating != null) {
      profileWhereParts.push({ skill_rating: { [Op.ne]: null } });
      if (min_skill_rating != null) {
        profileWhereParts.push({ skill_rating: { [Op.gte]: min_skill_rating } });
      }
      if (max_skill_rating != null) {
        profileWhereParts.push({ skill_rating: { [Op.lte]: max_skill_rating } });
      }
    }
    const profileWhere =
      profileWhereParts.length === 0
        ? {}
        : profileWhereParts.length === 1
          ? profileWhereParts[0]
          : { [Op.and]: profileWhereParts };

    const includes = [
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: [] },
      {
        model: CoachProfile,
        as: 'coachProfile',
        where: profileWhereParts.length > 0 ? profileWhere : undefined,
        required: true,
      },
      {
        model: UserReliability,
        as: 'reliabilities',
        where: { role: 'coach' },
        required: false,
        attributes: ['role', 'reliability_score', 'last_updated'],
      },
    ];

    // If GPS coordinates provided, filter by courts within radius
    if (lat != null && lng != null) {
      const latitude = lat;
      const longitude = lng;
      const radiusMiles = radius;

      // Calculate bounding box (rough approximation for initial filtering)
      const latRange = radiusMiles / 69; // ~69 miles per degree latitude
      const lngRange = radiusMiles / (69 * Math.cos(latitude * Math.PI / 180));

      includes.push({
        model: CoachCourtLocation,
        as: 'coachCourts',
        required: true,
        include: [{
          model: CourtLocation,
          as: 'court',
          where: {
            deleted_at: null,
            latitude: {
              [Op.between]: [latitude - latRange, latitude + latRange],
            },
            longitude: {
              [Op.between]: [longitude - lngRange, longitude + lngRange],
            },
          },
        required: true,
      }],
      });
    }

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

    // If GPS search, filter by exact distance (post-query filtering for accuracy)
    let filteredCoaches = coaches.rows;
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radiusMiles = parseFloat(radius);

      filteredCoaches = coaches.rows.filter(coach => {
        // Check if coach has any court within radius
        if (!coach.coachCourts || coach.coachCourts.length === 0) return false;
        
        return coach.coachCourts.some(coachCourt => {
          const court = coachCourt.court;
          if (!court || !court.latitude || !court.longitude) return false;
          const distance = calculateDistance(latitude, longitude, court.latitude, court.longitude);
          return distance <= radiusMiles;
        });
      });

      // Update count for pagination
      coaches.count = filteredCoaches.length;
    }

    const shaped = filteredCoaches.map((c) => shapeCoachForListing(c));

    if (!isPaginated) {
      return successResponse(res, shaped, 'Coaches retrieved successfully');
    }

    const response = getPagingData(
      { count: coaches.count, rows: shaped },
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
      where: { id, is_active: true, deleted_at: null },
      include: [
        { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: [] },
        { model: CoachProfile, as: 'coachProfile' },
        { model: CoachAvailability, as: 'availabilities' },
        { model: Lesson, as: 'lessons', where: { is_active: true, deleted_at: null }, required: false },
        { model: Review, as: 'reviewsReceived', limit: 10, order: [['created_at', 'DESC']] },
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

    const payload = coach.toJSON();
    payload.reliability = slimCoachReliabilityFromRows(payload.reliabilities);
    delete payload.reliabilities;
    if (Array.isArray(payload.availabilities)) {
      payload.availabilities = payload.availabilities.map(shapeAvailabilityForApi);
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

    const profile = await CoachProfile.create({
      user_id: targetUserId,
      headline,
      bio,
      experience_years: experience_years ?? 0,
      skill_rating: skill_rating ?? null,
      rating_system: rating_system ?? 'self',
      certifications,
      location,
    });

    return successResponse(res, profile, 'Coach profile created successfully', 201);
  } catch (error) {
    logger.error('Create coach profile error:', error);
    // Include error details in response for debugging
    const errorMessage = error.message || 'Failed to create coach profile';
    return errorResponse(res, errorMessage, 500);
  }
};

/** @param {import('sequelize').Model} profile @param {object} validated */
async function applyCoachProfileUpdate(profile, validated) {
  const {
    headline,
    bio,
    experience_years,
    skill_rating,
    rating_system,
    certifications,
    location,
  } = validated;
  await profile.update({
    headline: headline !== undefined ? headline : profile.headline,
    bio: bio !== undefined ? bio : profile.bio,
    experience_years: experience_years !== undefined ? experience_years : profile.experience_years,
    skill_rating: skill_rating !== undefined ? skill_rating : profile.skill_rating,
    rating_system: rating_system !== undefined ? rating_system : profile.rating_system,
    certifications: certifications !== undefined ? certifications : profile.certifications,
    location: location !== undefined ? location : profile.location,
  });
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
    await applyCoachProfileUpdate(profile, req.validated);
    return successResponse(res, profile, 'Coach profile updated successfully');
  } catch (error) {
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

    await applyCoachProfileUpdate(profile, req.validated);
    return successResponse(res, profile, 'Coach profile updated successfully');
  } catch (error) {
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
  const plain = row && typeof row.get === 'function' ? row.get({ plain: true }) : { ...row };
  return {
    ...plain,
    start_date: toYmdApi(plain.start_date),
    end_date: toYmdApi(plain.end_date),
  };
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

    // Prevent overlapping availability: same coach, same weekday, overlapping date range and overlapping time range.
    const existing = await CoachAvailability.findAll({
      where: { coach_id, weekday },
      attributes: ['id', 'start_date', 'end_date', 'start_time', 'end_time'],
    });
    for (const row of existing) {
      const dateOverlap = dateRangesOverlap(
        resolvedStartDate,
        resolvedEndDate,
        toYmdApi(row.start_date),
        toYmdApi(row.end_date)
      );
      if (!dateOverlap) continue;

      const timeOverlap = timeRangesOverlap(
        resolvedStartTime,
        resolvedEndTime,
        row.start_time,
        row.end_time
      );
      if (timeOverlap) {
        return errorResponse(
          res,
          'This availability overlaps an existing slot for the same day and date range. Use a non-overlapping time window (e.g. 09:00–12:00 and 13:00–17:00).',
          400
        );
      }
    }

    const availability = await CoachAvailability.create({
      coach_id,
      weekday,
      start_date: resolvedStartDate,
      end_date: resolvedEndDate,
      start_time: resolvedStartTime,
      end_time: resolvedEndTime,
    });

    return successResponse(res, shapeAvailabilityForApi(availability), 'Availability created successfully', 201);
  } catch (error) {
    logger.error('Create availability error:', error);
    return errorResponse(res, 'Failed to create availability', 500);
  }
};

async function listCoachAvailabilityForResponse(req, res, coachId) {
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

  if (!isPaginated) {
    return successResponse(res, shapedRows, 'Availability retrieved successfully');
  }
  const response = getPagingData({ count: availabilities.count, rows: shapedRows }, page, queryLimit);
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
    return await listCoachAvailabilityForResponse(req, res, coachId);
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

    const row = await CoachAvailability.findByPk(availabilityId);
    if (!row) {
      return errorResponse(res, 'Availability not found', 404);
    }
    if (row.coach_id !== req.user.id) {
      return errorResponse(res, 'You can only update your own availability', 403);
    }

    const coach_id = req.user.id;
    const { weekday, start_date, end_date, start_time, end_time } = req.validated;

    const resolvedStartDate = start_date ?? null;
    const resolvedEndDate = end_date ?? null;
    const resolvedStartTime = normalizeTimeOfDay(start_time);
    const resolvedEndTime = normalizeTimeOfDay(end_time);

    const existing = await CoachAvailability.findAll({
      where: {
        coach_id,
        weekday,
        id: { [Op.ne]: availabilityId },
      },
      attributes: ['id', 'start_date', 'end_date', 'start_time', 'end_time'],
    });
    for (const other of existing) {
      const dateOverlap = dateRangesOverlap(
        resolvedStartDate,
        resolvedEndDate,
        toYmdApi(other.start_date),
        toYmdApi(other.end_date)
      );
      if (!dateOverlap) continue;

      const timeOverlap = timeRangesOverlap(
        resolvedStartTime,
        resolvedEndTime,
        other.start_time,
        other.end_time
      );
      if (timeOverlap) {
        return errorResponse(
          res,
          'This availability overlaps an existing slot for the same day and date range. Use a non-overlapping time window (e.g. 09:00–12:00 and 13:00–17:00).',
          400
        );
      }
    }

    await row.update({
      weekday,
      start_date: resolvedStartDate,
      end_date: resolvedEndDate,
      start_time: resolvedStartTime,
      end_time: resolvedEndTime,
    });
    await row.reload();

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
 * POST /api/coaches/me/stripe-connect/onboard
 * Initiate Stripe Connect onboarding for coach
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

    // Check if already onboarded
    if (coachProfile.stripe_account_id) {
      return errorResponse(res, 'Coach already has a Stripe Connect account', 409);
    }

    const { createConnectAccount, createAccountLink } = await import('../services/stripeService.js');
    const { logAudit } = await import('../utils/audit.js');

    // Create Stripe Connect account
    const account = await createConnectAccount(coach.email, {
      user_id: coachId.toString(),
      coach_profile_id: coachProfile.id.toString(),
    });

    // Update coach profile with Stripe account ID
    await coachProfile.update({
      stripe_account_id: account.id,
    });

    // Create onboarding link
    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || `${process.env.APP_URL || 'http://localhost:3000'}/coach/onboarding/return`;
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL || `${process.env.APP_URL || 'http://localhost:3000'}/coach/onboarding/refresh`;
    
    const accountLink = await createAccountLink(account.id, returnUrl, refreshUrl);

    await logAudit(req.user.id, 'stripe_connect_onboarding_initiated', 'coach_profiles', coachProfile.id, null, {
      stripe_account_id: account.id,
    }, req);

    return successResponse(res, {
      account_id: account.id,
      onboarding_url: accountLink.url,
      expires_at: accountLink.expires_at,
    }, 'Stripe Connect onboarding initiated successfully', 201);
  } catch (error) {
    logger.error('Stripe Connect onboarding error:', error);
    return errorResponse(res, 'Failed to initiate Stripe Connect onboarding', 500);
  }
};

/**
 * GET /api/coaches/me/stripe-connect/status
 * Get Stripe Connect account status
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
      return successResponse(res, {
        onboarded: false,
        account_id: null,
      }, 'Coach not onboarded with Stripe Connect');
    }

    // Get account details from Stripe
    const stripe = (await import('../services/stripeService.js')).default;
    const account = await stripe.accounts.retrieve(coachProfile.stripe_account_id);

    return successResponse(res, {
      onboarded: true,
      account_id: coachProfile.stripe_account_id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      email: account.email,
    }, 'Stripe Connect status retrieved successfully');
  } catch (error) {
    logger.error('Get Stripe Connect status error:', error);
    return errorResponse(res, 'Failed to retrieve Stripe Connect status', 500);
  }
};
