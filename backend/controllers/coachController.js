import { User, CoachProfile, CoachAvailability, Lesson, Booking, Review } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { Op } from 'sequelize';

export const getCoaches = async (req, res) => {
  try {
    const { page = 1, limit = 10, skill_level, location, min_rating } = req.query;
    const { limit: queryLimit, offset } = getPagination(page, limit);

    const where = { role: 'coach', is_active: true };
    const profileWhere = {};

    if (skill_level) profileWhere.skill_level = skill_level;
    if (location) profileWhere.location = { [Op.like]: `%${location}%` };
    if (min_rating) profileWhere.rating_average = { [Op.gte]: parseFloat(min_rating) };

    const coaches = await User.findAndCountAll({
      where,
      include: [{
        model: CoachProfile,
        as: 'coachProfile',
        where: Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
        required: true,
      }],
      limit: queryLimit,
      offset,
      order: [['coachProfile', 'rating_average', 'DESC']],
    });

    const response = getPagingData(coaches, page, queryLimit);
    return successResponse(res, response.items, 'Coaches retrieved successfully');
  } catch (error) {
    console.error('Get coaches error:', error);
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
        { model: Lesson, as: 'lessons', where: { is_active: true, deleted_at: null } },
        { model: Review, as: 'reviewsReceived', limit: 10, order: [['created_at', 'DESC']] },
      ],
    });

    if (!coach) {
      return errorResponse(res, 'Coach not found', 404);
    }

    return successResponse(res, coach, 'Coach retrieved successfully');
  } catch (error) {
    console.error('Get coach error:', error);
    return errorResponse(res, 'Failed to retrieve coach', 500);
  }
};

export const createCoachProfile = async (req, res) => {
  try {
    const { user_id, headline, bio, hourly_rate, experience_years, skill_level, certifications, location } = req.body;

    if (req.user.id !== parseInt(user_id) && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const existingProfile = await CoachProfile.findOne({ where: { user_id } });
    if (existingProfile) {
      return errorResponse(res, 'Coach profile already exists', 409);
    }

    const profile = await CoachProfile.create({
      user_id,
      headline,
      bio,
      hourly_rate: hourly_rate || 0,
      experience_years: experience_years || 0,
      skill_level: skill_level || 'intermediate',
      certifications,
      location,
    });

    return successResponse(res, profile, 'Coach profile created successfully', 201);
  } catch (error) {
    console.error('Create coach profile error:', error);
    return errorResponse(res, 'Failed to create coach profile', 500);
  }
};

export const updateCoachProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await CoachProfile.findByPk(id);

    if (!profile) {
      return errorResponse(res, 'Coach profile not found', 404);
    }

    if (req.user.id !== profile.user_id && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const { headline, bio, hourly_rate, experience_years, skill_level, certifications, location } = req.body;

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
    console.error('Update coach profile error:', error);
    return errorResponse(res, 'Failed to update coach profile', 500);
  }
};

export const createAvailability = async (req, res) => {
  try {
    const { coach_id, weekday, start_time, end_time, start_date, end_date, recurrence_rule, is_available } = req.body;

    if (req.user.id !== parseInt(coach_id) && req.user.role !== 'admin') {
      return errorResponse(res, 'Unauthorized', 403);
    }

    const availability = await CoachAvailability.create({
      coach_id,
      weekday,
      start_time,
      end_time,
      start_date,
      end_date,
      recurrence_rule,
      is_available: is_available !== undefined ? is_available : true,
    });

    return successResponse(res, availability, 'Availability created successfully', 201);
  } catch (error) {
    console.error('Create availability error:', error);
    return errorResponse(res, 'Failed to create availability', 500);
  }
};

export const getCoachAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const availabilities = await CoachAvailability.findAll({
      where: { coach_id: id, is_available: true },
      order: [['weekday', 'ASC'], ['start_time', 'ASC']],
    });

    return successResponse(res, availabilities, 'Availability retrieved successfully');
  } catch (error) {
    console.error('Get availability error:', error);
    return errorResponse(res, 'Failed to retrieve availability', 500);
  }
};
