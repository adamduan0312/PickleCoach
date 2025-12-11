import { CourtLocation, CoachCourtLocation, User } from '../models/index.js';
import { Op } from 'sequelize';
import { createResponse, createErrorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';

/**
 * GET /api/courts
 * Search courts by location (lazy import if needed)
 */
export const searchCourts = async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query; // radius in miles

    if (!lat || !lng) {
      return res.status(400).json(createErrorResponse('Latitude and longitude are required'));
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusMiles = parseFloat(radius);

    // Calculate bounding box (rough approximation)
    const latRange = radiusMiles / 69; // ~69 miles per degree latitude
    const lngRange = radiusMiles / (69 * Math.cos(latitude * Math.PI / 180));

    const courts = await CourtLocation.findAll({
      where: {
        deleted_at: null,
        latitude: {
          [Op.between]: [latitude - latRange, latitude + latRange],
        },
        longitude: {
          [Op.between]: [longitude - lngRange, longitude + lngRange],
        },
      },
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'full_name'],
        },
      ],
      limit: 100,
    });

    // TODO: If no courts found, trigger lazy import from external API (Pickleheads, OpenStreetMap)
    // For now, return empty array

    return res.json(createResponse(courts, 'Courts retrieved successfully'));
  } catch (error) {
    logger.error('Error searching courts:', error);
    return res.status(500).json(createErrorResponse('Failed to search courts'));
  }
};

/**
 * GET /api/courts/:id
 * Get court details
 */
export const getCourt = async (req, res) => {
  try {
    const { id } = req.params;

    const court = await CourtLocation.findByPk(id, {
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'full_name'],
        },
        {
          model: User,
          as: 'coaches',
          through: { attributes: ['rate_modifier', 'preferred', 'notes'] },
          attributes: ['id', 'full_name'],
        },
      ],
    });

    if (!court) {
      return res.status(404).json(createErrorResponse('Court not found'));
    }

    return res.json(createResponse(court, 'Court retrieved successfully'));
  } catch (error) {
    logger.error('Error getting court:', error);
    return res.status(500).json(createErrorResponse('Failed to get court'));
  }
};

/**
 * POST /api/courts
 * Create a new court (coach or admin only)
 */
export const createCourt = async (req, res) => {
  try {
    const { name, address, latitude, longitude, is_private, notes } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== 'coach' && userRole !== 'admin') {
      return res.status(403).json(createErrorResponse('Only coaches and admins can create courts'));
    }

    if (!name) {
      return res.status(400).json(createErrorResponse('Court name is required'));
    }

    // Check for duplicate
    const existing = await CourtLocation.findOne({
      where: {
        name,
        address: address || null,
        deleted_at: null,
      },
    });

    if (existing) {
      return res.status(409).json(createErrorResponse('Court with this name and address already exists'));
    }

    const court = await CourtLocation.create({
      name,
      address,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      is_private: is_private || false,
      is_verified: userRole === 'admin', // Auto-verify if admin creates
      created_by_user_id: userId,
      source: 'manual',
    });

    // If coach created it, automatically link them to it
    if (userRole === 'coach') {
      await CoachCourtLocation.create({
        coach_id: userId,
        court_id: court.id,
        preferred: true,
        notes: notes || null,
      });
    }

    return res.status(201).json(createResponse(court, 'Court created successfully'));
  } catch (error) {
    logger.error('Error creating court:', error);
    return res.status(500).json(createErrorResponse('Failed to create court'));
  }
};

/**
 * POST /api/coaches/me/courts
 * Coach adds themselves to an existing court or creates a private court
 */
export const addCoachCourt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { court_id, rate_modifier, preferred, notes, create_private } = req.body;

    if (req.user.role !== 'coach') {
      return res.status(403).json(createErrorResponse('Only coaches can add courts'));
    }

    let courtId = court_id;

    // If creating a private court
    if (create_private) {
      const { name, address, latitude, longitude, notes: courtNotes } = req.body;
      if (!name) {
        return res.status(400).json(createErrorResponse('Court name is required for private courts'));
      }

      const privateCourt = await CourtLocation.create({
        name,
        address,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        is_private: true,
        is_verified: false,
        created_by_user_id: userId,
        source: 'manual',
      });

      courtId = privateCourt.id;
    }

    if (!courtId) {
      return res.status(400).json(createErrorResponse('Court ID is required'));
    }

    // Check if already linked
    const existing = await CoachCourtLocation.findOne({
      where: {
        coach_id: userId,
        court_id: courtId,
      },
    });

    if (existing) {
      return res.status(409).json(createErrorResponse('Coach is already linked to this court'));
    }

    const coachCourt = await CoachCourtLocation.create({
      coach_id: userId,
      court_id: courtId,
      rate_modifier: rate_modifier ? parseFloat(rate_modifier) : null,
      preferred: preferred || false,
      notes: notes || null,
    });

    const court = await CourtLocation.findByPk(courtId, {
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'full_name'],
        },
      ],
    });

    return res.status(201).json(createResponse({ coachCourt, court }, 'Court added successfully'));
  } catch (error) {
    logger.error('Error adding coach court:', error);
    return res.status(500).json(createErrorResponse('Failed to add court'));
  }
};

