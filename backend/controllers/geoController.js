import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';
import { geocodeSearch } from '../services/geocodeService.js';

/**
 * GET /api/geo/search?q=...
 * Convert ZIP / city / address → lat/lng for Discover radius search.
 * Does not persist the query. Does not expose provider details.
 */
export const searchLocations = async (req, res) => {
  try {
    const { q, limit } = req.validated;
    const results = await geocodeSearch(q, { limit });

    if (!results.length) {
      return successResponse(
        res,
        { results: [] },
        'No matching locations found. Try a ZIP code, city, or fuller address.',
      );
    }

    return successResponse(res, { results }, 'Locations found');
  } catch (error) {
    if (error?.code === 'GEOCODE_UNAVAILABLE' || error?.code === 'GEOCODE_PROVIDER_ERROR') {
      return errorResponse(res, error.message, error.status || 503);
    }
    logger.error('Geocode search error:', error);
    return errorResponse(res, 'Failed to search locations', 500);
  }
};
