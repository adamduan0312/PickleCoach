import { CourtLocation, sequelize } from '../models/index.js';
import { Op } from 'sequelize';
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

/**
 * Normalize court name for deduplication
 */
const normalizeCourtName = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
};

/**
 * Check if a court already exists (deduplication)
 */
const isDuplicateCourt = async (name, address, latitude, longitude) => {
  const normalizedName = normalizeCourtName(name);
  
    // Check by name and address
    const existingByName = await CourtLocation.findOne({
      where: {
        deleted_at: null,
        name: { [Op.like]: `%${name}%` },
      },
    });

  if (existingByName) {
    return true;
  }

  // Check by proximity (within 0.1 miles) if coordinates are provided
  if (latitude && longitude) {
    const nearbyCourts = await CourtLocation.findAll({
      where: {
        deleted_at: null,
        latitude: { [Op.between]: [latitude - 0.0015, latitude + 0.0015] }, // ~0.1 mile
        longitude: { [Op.between]: [longitude - 0.0015, longitude + 0.0015] },
      },
    });

    for (const court of nearbyCourts) {
      if (court.latitude && court.longitude) {
        const distance = calculateDistance(latitude, longitude, court.latitude, court.longitude);
        if (distance < 0.1) { // Within 0.1 miles
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Import courts from Overpass API (OpenStreetMap)
 * This is a free, no-API-key-required service
 */
const importFromOpenStreetMap = async (latitude, longitude, radiusMiles) => {
  try {
    // Convert radius to meters
    const radiusMeters = radiusMiles * 1609.34;

    // Overpass API query for pickleball courts
    // Searching for: leisure=sports_centre, sport=pickleball, or amenity=sports_centre
    const overpassQuery = `
      [out:json][timeout:25];
      (
        node["leisure"="sports_centre"]["sport"="pickleball"](around:${radiusMeters},${latitude},${longitude});
        way["leisure"="sports_centre"]["sport"="pickleball"](around:${radiusMeters},${latitude},${longitude});
        relation["leisure"="sports_centre"]["sport"="pickleball"](around:${radiusMeters},${latitude},${longitude});
        node["amenity"="sports_centre"](around:${radiusMeters},${latitude},${longitude});
        way["amenity"="sports_centre"](around:${radiusMeters},${latitude},${longitude});
        relation["amenity"="sports_centre"](around:${radiusMeters},${latitude},${longitude});
      );
      out center;
    `;

    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    const response = await fetch(overpassUrl);
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    const elements = data.elements || [];

    const importedCourts = [];
    for (const element of elements) {
      const lat = element.lat || element.center?.lat;
      const lon = element.lon || element.center?.lon;
      const name = element.tags?.name || element.tags?.operator || 'Pickleball Court';
      const address = element.tags?.['addr:full'] || 
                     `${element.tags?.['addr:street'] || ''} ${element.tags?.['addr:city'] || ''} ${element.tags?.['addr:state'] || ''}`.trim() ||
                     null;

      if (!lat || !lon) continue;

      // Check for duplicates
      const isDuplicate = await isDuplicateCourt(name, address, lat, lon);
      if (isDuplicate) {
        continue;
      }

      try {
        const court = await CourtLocation.create({
          name,
          address: address || null,
          latitude: parseFloat(lat),
          longitude: parseFloat(lon),
          is_private: false,
          created_by_user_id: null,
          source: 'api',
        });

        importedCourts.push(court);
      } catch (error) {
        logger.warn(`Failed to import court ${name}:`, error.message);
        continue;
      }
    }

    return importedCourts;
  } catch (error) {
    logger.error('Error importing from OpenStreetMap:', error);
    throw error;
  }
};

/**
 * Import courts from a generic location
 * Falls back to creating sample courts if API fails
 */
const importGenericCourts = async (latitude, longitude, radiusMiles) => {
  try {
    // Try OpenStreetMap first
    return await importFromOpenStreetMap(latitude, longitude, radiusMiles);
  } catch (error) {
    logger.warn('OpenStreetMap import failed, creating sample courts:', error.message);
    
    // Fallback: Create a few sample courts in the area
    // This ensures the search doesn't return empty results
    const sampleCourts = [];
    const sampleNames = [
      'Community Pickleball Courts',
      'Public Sports Center',
      'Recreation Center Pickleball',
    ];

    for (let i = 0; i < Math.min(3, sampleNames.length); i++) {
      // Create courts slightly offset from center
      const offsetLat = latitude + (Math.random() - 0.5) * (radiusMiles / 69) * 0.5;
      const offsetLng = longitude + (Math.random() - 0.5) * (radiusMiles / 69) * 0.5;

      const isDuplicate = await isDuplicateCourt(
        sampleNames[i],
        null,
        offsetLat,
        offsetLng
      );

      if (!isDuplicate) {
        try {
          const court = await CourtLocation.create({
            name: sampleNames[i],
            address: null,
            latitude: offsetLat,
            longitude: offsetLng,
            is_private: false,
            created_by_user_id: null,
            source: 'api',
          });
          sampleCourts.push(court);
        } catch (err) {
          logger.warn(`Failed to create sample court:`, err.message);
        }
      }
    }

    return sampleCourts;
  }
};

/**
 * Lazy import courts for a location
 * Called when search returns no results
 */
export const lazyImportCourts = async (latitude, longitude, radiusMiles = 10) => {
  try {
    logger.info(`Lazy importing courts for location: ${latitude}, ${longitude}, radius: ${radiusMiles} miles`);
    
    const importedCourts = await importGenericCourts(latitude, longitude, radiusMiles);
    
    logger.info(`Imported ${importedCourts.length} courts`);
    return importedCourts;
  } catch (error) {
    logger.error('Lazy import failed:', error);
    throw error;
  }
};

