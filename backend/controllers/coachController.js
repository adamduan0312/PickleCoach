import { User, UserRole, CoachProfile, CoachAvailability, Lesson, Booking, Review, CoachCourtLocation, CourtLocation } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';
import { sequelize } from '../models/sequelize.js';
import { logger } from '../config/logger.js';

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

export const getCoaches = async (req, res) => {
  try {
    // Only students and admins can search/list coaches (e.g. to find someone to book). Coaches don't use this to find other coaches.
    if (req.user && (req.user.roles || []).includes('coach')) {
      return errorResponse(res, 'Only students and admins can search for coaches', 403);
    }

    const { page, limit, lat, lng, radius, skill_level, min_rating } = req.validated;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = { is_active: true };
    const profileWhere = {};

    if (skill_level) profileWhere.skill_level = skill_level;
    if (min_rating) profileWhere.rating_average = { [Op.gte]: parseFloat(min_rating) };

    const includes = [
      { model: UserRole, as: 'userRoles', where: { role: 'coach' }, required: true, attributes: [] },
      {
        model: CoachProfile,
        as: 'coachProfile',
        where: Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
        required: true,
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

    const coaches = await User.findAndCountAll({
      where,
      include: includes,
      limit: queryLimit,
      offset,
      order: [['coachProfile', 'rating_average', 'DESC']],
      distinct: true, // Important for joins that create duplicates
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

    const response = getPagingData(
      { count: coaches.count, rows: filteredCoaches },
      page,
      queryLimit
    );
    return successResponse(res, response.items, 'Coaches retrieved successfully');
  } catch (error) {
    logger.error('Get coaches error:', error);
    return errorResponse(res, 'Failed to retrieve coaches', 500);
  }
};

export const getCoachById = async (req, res) => {
  try {
    const { id } = req.params;
    const coach = await User.findOne({
      where: { id, role: 'coach' },
      include: [
        { model: CoachProfile, as: 'coachProfile' },
        { model: CoachAvailability, as: 'availabilities' },
        { model: Lesson, as: 'lessons', where: { is_active: true, deleted_at: null }, required: false },
        { model: Review, as: 'reviewsReceived', limit: 10, order: [['created_at', 'DESC']] },
      ],
    });

    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    return successResponse(res, coach, 'Coach retrieved successfully');
  } catch (error) {
    logger.error('Get coach error:', error);
    return errorResponse(res, 'Failed to retrieve coach', 500);
  }
};

export const createCoachProfile = async (req, res) => {
  try {
    const { headline, bio, hourly_rate, experience_years, skill_level, certifications, location } = req.body;
    const targetUserId = req.user.id;

    const existingProfile = await CoachProfile.findOne({ where: { user_id: targetUserId } });
    if (existingProfile) {
      return errorResponse(res, 'Coach profile already exists', 409);
    }

    const profile = await CoachProfile.create({
      user_id: targetUserId,
      headline,
      bio,
      hourly_rate: hourly_rate || 0,
      experience_years: experience_years ?? 0,
      skill_level: skill_level || 'intermediate',
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

export const updateCoachProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await CoachProfile.findOne({ where: { user_id: id } });

    if (!profile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }

    if (req.user.id !== profile.user_id && !(req.user.roles || []).includes('admin')) {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { headline, bio, hourly_rate, experience_years, skill_level, certifications, location } = req.validated;

    await profile.update({
      headline: headline !== undefined ? headline : profile.headline,
      bio: bio !== undefined ? bio : profile.bio,
      hourly_rate: hourly_rate !== undefined ? hourly_rate : profile.hourly_rate,
      experience_years: experience_years !== undefined ? experience_years : profile.experience_years,
      skill_level: skill_level || profile.skill_level,
      certifications: certifications !== undefined ? certifications : profile.certifications,
      location: location !== undefined ? location : profile.location,
    });

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

/** From a Date, return YYYY-MM-DD for DATEONLY. */
function toDateOnly(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

/** From a Date, return HH:mm:ss for time-of-day. */
function toTimeOnly(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return date.toTimeString().slice(0, 8);
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

export const createAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, `Only coaches can create availability. Your roles: ${(req.user.roles || []).join(', ') || 'none'}.`, 403);
    }

    const coach_id = req.user.id;
    const { weekday, start_datetime, end_datetime, start_date, end_date, start_time, end_time } = req.validated;

    // Avoid redundancy: client can send either (start_date, end_date, start_time, end_time) OR (start_datetime, end_datetime).
    // Derive date/time from datetimes when only datetimes are provided.
    const startDt = start_datetime ? new Date(start_datetime) : null;
    const endDt = end_datetime ? new Date(end_datetime) : null;
    const resolvedStartDate = start_date ?? (startDt ? toDateOnly(startDt) : null);
    const resolvedEndDate = end_date ?? (endDt ? toDateOnly(endDt) : null);
    const resolvedStartTime = normalizeTimeOfDay(start_time) ?? (startDt ? toTimeOnly(startDt) : null);
    const resolvedEndTime = normalizeTimeOfDay(end_time) ?? (endDt ? toTimeOnly(endDt) : null);

    // Prevent overlapping availability: same coach, same weekday, overlapping date range and overlapping time range.
    const existing = await CoachAvailability.findAll({
      where: { coach_id, weekday },
      attributes: ['start_date', 'end_date', 'start_time', 'end_time', 'start_datetime', 'end_datetime'],
    });
    for (const row of existing) {
      const dateOverlap = dateRangesOverlap(
        resolvedStartDate,
        resolvedEndDate,
        row.start_date,
        row.end_date
      );
      if (!dateOverlap) continue;

      const rowStartTime = row.start_time ?? (row.start_datetime ? toTimeOnly(row.start_datetime) : null);
      const rowEndTime = row.end_time ?? (row.end_datetime ? toTimeOnly(row.end_datetime) : null);
      const timeOverlap = timeRangesOverlap(
        resolvedStartTime,
        resolvedEndTime,
        rowStartTime,
        rowEndTime
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
      start_datetime: startDt,
      end_datetime: endDt,
      start_date: resolvedStartDate,
      end_date: resolvedEndDate,
      start_time: resolvedStartTime,
      end_time: resolvedEndTime,
    });

    return successResponse(res, availability, 'Availability created successfully', 201);
  } catch (error) {
    logger.error('Create availability error:', error);
    return errorResponse(res, 'Failed to create availability', 500);
  }
};

export const getCoachAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const availabilities = await CoachAvailability.findAll({
      where: { coach_id: id },
      order: [['weekday', 'ASC'], ['start_datetime', 'ASC']],
    });

    return successResponse(res, availabilities, 'Availability retrieved successfully');
  } catch (error) {
    logger.error('Get availability error:', error);
    return errorResponse(res, 'Failed to retrieve availability', 500);
  }
};

/**
 * Delete a coach availability slot (hard delete)
 * DELETE /api/coaches/availability/:id
 * Coach only; can only delete their own availability.
 */
export const deleteAvailability = async (req, res) => {
  try {
    if (!(req.user.roles || []).includes('coach')) {
      return errorResponse(res, `Only coaches can delete their availability. Your roles: ${(req.user.roles || []).join(', ') || 'none'}. Switch via PUT /api/auth/me/role with body { "role": "coach" } if needed.`, 403);
    }

    const availabilityId = req.params.id;
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
    const coachRoles = coach?.userRoles?.map((r) => r.role) ?? [];
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
