import { User, CoachProfile, CoachAvailability, Lesson, Booking, Review, CoachCourtLocation, CourtLocation } from '../models/index.js';
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
    const { page, limit, lat, lng, radius, skill_level, min_rating } = req.validated;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = { role: 'coach', is_active: true };
    const profileWhere = {};

    if (skill_level) profileWhere.skill_level = skill_level;
    if (min_rating) profileWhere.rating_average = { [Op.gte]: parseFloat(min_rating) };

    // Build includes array
    const includes = [{
        model: CoachProfile,
        as: 'coachProfile',
        where: Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
      required: true,
    }];

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
    const { user_id, headline, bio, hourly_rate, experience_years, skill_level, certifications, location } = req.body;

    // Use provided user_id or default to authenticated user's ID
    // Allow admins to create profiles for other users
    const targetUserId = user_id ? parseInt(user_id) : req.user.id;
    
    if (req.user.id !== targetUserId && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    // Verify the target user has coach role (unless admin is creating it)
    if (req.user.role !== 'admin') {
      if (req.user.role !== 'coach') {
        return errorResponse(res, 'Only users with coach role can create coach profiles', 403);
      }
    } else if (user_id) {
      // Admin creating profile for another user - verify that user is a coach
      const targetUser = await User.findByPk(targetUserId);
      if (!targetUser) {
        return errorResponse(res, 'User not found', 404);
      }
      if (targetUser.role !== 'coach') {
        return errorResponse(res, 'Can only create coach profiles for users with coach role', 400);
      }
    }

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

    if (req.user.id !== profile.user_id && req.user.role !== 'admin') {
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

export const createAvailability = async (req, res) => {
  try {
    const { coach_id, weekday, start_datetime, end_datetime, start_date, end_date, recurrence_rule, is_available } = req.validated;

    if (req.user.id !== parseInt(coach_id) && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const availability = await CoachAvailability.create({
      coach_id,
      weekday,
      start_datetime: start_datetime ? new Date(start_datetime) : null,
      end_datetime: end_datetime ? new Date(end_datetime) : null,
      start_date,
      end_date,
      recurrence_rule,
      is_available: is_available !== undefined ? is_available : true,
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
      where: { coach_id: id, is_available: true },
      order: [['weekday', 'ASC'], ['start_datetime', 'ASC']],
    });

    return successResponse(res, availabilities, 'Availability retrieved successfully');
  } catch (error) {
    logger.error('Get availability error:', error);
    return errorResponse(res, 'Failed to retrieve availability', 500);
  }
};

/**
 * POST /api/coaches/me/stripe-connect/onboard
 * Initiate Stripe Connect onboarding for coach
 */
export const initiateStripeConnectOnboarding = async (req, res) => {
  try {
    if (req.user.role !== 'coach' && req.user.role !== 'admin') {
      return errorResponse(res, 'Only coaches can onboard with Stripe Connect', 403);
    }

    const coachId = req.user.role === 'admin' ? req.body.coach_id : req.user.id;
    if (!coachId) {
      return errorResponse(res, 'Coach ID is required', 400);
    }

    const coach = await User.findByPk(coachId);
    if (!coach || coach.role !== 'coach') {
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
    if (req.user.role !== 'coach' && req.user.role !== 'admin') {
      return errorResponse(res, 'Only coaches can check Stripe Connect status', 403);
    }

    const coachId = req.user.role === 'admin' ? req.query.coach_id : req.user.id;
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
