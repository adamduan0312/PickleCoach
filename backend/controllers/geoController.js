import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';
import { geocodeSearch, suggestCityLevelPlaces } from '../services/geocodeService.js';

/**
 * GET /api/geo/places?q=...
 * City-level suggestions for the coach "Based in" field ("Dav" → Davie, FL). No coordinates,
 * streets, or ZIPs in labels. Saving the profile re-validates server-side.
 */
export const suggestPlaces = async (req, res) => {
  try {
    const { q, limit } = req.validated;
    const results = await suggestCityLevelPlaces(q, { limit });
    return successResponse(res, { results }, results.length ? 'Places found' : 'No matching places found');
  } catch (error) {
    if (error?.code === 'GEOCODE_UNAVAILABLE' || error?.code === 'GEOCODE_PROVIDER_ERROR') {
      return errorResponse(res, error.message, error.status || 503);
    }
    logger.error('Place suggestion error:', error);
    return errorResponse(res, 'Failed to suggest places', 500);
  }
};

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
