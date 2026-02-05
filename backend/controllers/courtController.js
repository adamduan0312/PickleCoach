import { CourtLocation, CoachCourtLocation, User } from '../models/index.js';
import { Op } from 'sequelize';
import { successResponse, errorResponse, createErrorResponse, createResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';

/**
 * GET /api/courts
 * Search courts by location (lazy import if needed)
 */
export const searchCourts = async (req, res) => {
  try {
    const { lat, lng, radius } = req.validated; // radius in miles
    const latitude = lat;
    const longitude = lng;
    const radiusMiles = radius;

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

    // Lazy import: If no courts found, import from external APIs
    if (courts.length === 0) {
      try {
        const { lazyImportCourts } = await import('../services/courtImportService.js');
        const importedCourts = await lazyImportCourts(latitude, longitude, radiusMiles);
        
        // Re-fetch courts after import
        const allCourts = await CourtLocation.findAll({
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
        
        return res.json(createResponse(allCourts, `Courts retrieved successfully (${importedCourts.length} imported)`));
      } catch (importError) {
        logger.error('Court lazy import failed:', importError);
        // Return empty array if import fails
        return res.json(createResponse([], 'Courts retrieved successfully (import failed)'));
      }
    }

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
 * GET /api/coaches/me/courts
 * List courts associated with the authenticated coach
 */
export const getMyCoachCourts = async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'coach') {
      return res.status(403).json(createErrorResponse('Only coaches can view their courts'));
    }

    const coachCourts = await CoachCourtLocation.findAll({
      where: { coach_id: userId },
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: { deleted_at: null },
          required: true,
          include: [
            {
              model: User,
              as: 'createdBy',
              attributes: ['id', 'full_name'],
            },
          ],
        },
      ],
      order: [['preferred', 'DESC'], ['created_at', 'ASC']],
    });

    return res.status(200).json(createResponse(coachCourts, 'Courts retrieved successfully'));
  } catch (error) {
    logger.error('Error listing coach courts:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve courts'));
  }
};

/**
 * POST /api/coaches/me/courts
 * Link an existing court to the coach's available courts.
 * To create new courts (public or private), use POST /api/courts instead; coaches are auto-linked when they create a court.
 */
export const addCoachCourt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { court_id, rate_modifier, preferred, notes } = req.body;

    if (req.user.role !== 'coach') {
      return res.status(403).json(createErrorResponse('Only coaches can add courts to their profile'));
    }

    const courtId = court_id != null ? parseInt(court_id, 10) : null;
    if (!courtId || Number.isNaN(courtId)) {
      return res.status(400).json(createErrorResponse('Court ID is required and must be a number'));
    }

    const courtExists = await CourtLocation.findOne({
      where: { id: courtId, deleted_at: null },
    });
    if (!courtExists) {
      return res.status(404).json(createErrorResponse('Court not found'));
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
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(404).json(createErrorResponse('Court not found'));
    }
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json(createErrorResponse('Coach is already linked to this court'));
    }
    const message = process.env.NODE_ENV === 'development' && error?.message
      ? error.message
      : 'Failed to add court';
    return res.status(500).json(createErrorResponse(message));
  }
};

