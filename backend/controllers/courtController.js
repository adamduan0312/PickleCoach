import { CourtLocation, CoachCourtLocation, CoachProfile } from '../models/index.js';
import { Op } from 'sequelize';
import { successResponse, errorResponse, createErrorResponse, createResponse, paginatedResponse } from '../utils/response.js';
import { getPagination, getPagingData } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { courtCreatePayloadRejectsCoachCourtFields } from '../utils/validateCourtCreatePayload.js';
import { parseCoachCourtLinkCoachNotesFromBody } from '../utils/coachCourtLinkNotes.js';
import { publicCourtDirectoryWhere } from '../utils/courtPublicDirectory.js';
import { findPublicActiveCoach } from '../utils/userLifecycle.js';
import { serializeCourtForPublicViewer } from '../utils/courtAddressVisibility.js';
import { distanceMiles as courtDupDistanceMiles, rankCourtDuplicateCandidates } from '../utils/courtDuplicateMatch.js';

/** Safety cap when listing all courts with no pagination (DoS prevention). */
const MAX_LIST_ALL_COURTS = 10000;
const MAX_LIST_ALL_COACH_COURTS = 10000;

/** Public court fields for list/search (no creator or coach joins). */
const PUBLIC_COURT_LIST_ATTRIBUTES = [
  'id',
  'name',
  'address_line1',
  'city',
  'state',
  'postal_code',
  'country',
  'latitude',
  'longitude',
  'is_private',
];

/** Geo list/re-query cap — aligned with OSM discovery import cap. */
const GEO_COURT_RESULT_LIMIT = 100;

/** Coach–court link fields in coach/student APIs (rate_modifier stored in DB for future pricing). */
const COACH_COURT_LINK_API_ATTRIBUTES = [
  'id',
  'coach_id',
  'court_id',
  'coach_notes',
  'created_at',
  'updated_at',
];

/** Auto-link row returned from POST /api/courts — no relationship metadata (use POST /api/coaches/me/courts for coach_notes). */
const COACH_COURT_LINK_POST_COURT_RESPONSE_ATTRIBUTES = [
  'id',
  'coach_id',
  'court_id',
  'created_at',
  'updated_at',
];

/**
 * Distance between two points in miles (Haversine)
 */
const distanceMiles = (lat1, lng1, lat2, lng2) => courtDupDistanceMiles(lat1, lng1, lat2, lng2);

/** Closest first for geo search; courts missing coords sort last. */
const sortCourtsByDistanceFrom = (courts, originLat, originLng) =>
  [...courts].sort((a, b) => {
    const da = distanceMiles(originLat, originLng, a.latitude, a.longitude);
    const db = distanceMiles(originLat, originLng, b.latitude, b.longitude);
    const na = da == null ? Number.POSITIVE_INFINITY : da;
    const nb = db == null ? Number.POSITIVE_INFINITY : db;
    return na - nb;
  });

/** Text `q` → LIKE across public directory fields. */
function textSearchWhere(q) {
  if (!q) return null;
  const term = `%${String(q).trim()}%`;
  return {
    [Op.or]: [
      { name: { [Op.like]: term } },
      { address_line1: { [Op.like]: term } },
      { city: { [Op.like]: term } },
      { postal_code: { [Op.like]: term } },
      { state: { [Op.like]: term } },
    ],
  };
}

/**
 * Load active courts near a point for duplicate matching (includes private — coaches may create near private).
 */
async function findCourtsNearForDuplicateCheck(lat, lng, radiusMiles = 1) {
  const latRange = radiusMiles / 69;
  const lngRange = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));
  return CourtLocation.findAll({
    where: {
      deleted_at: null,
      latitude: { [Op.between]: [lat - latRange, lat + latRange] },
      longitude: { [Op.between]: [lng - lngRange, lng + lngRange] },
    },
    attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
    limit: 50,
  });
}

/**
 * GET /api/courts
 * Public directory only: excludes courts with `is_private: true` (discovery flag —
 * see `publicCourtDirectoryWhere`). Does not affect coach/booking surfaces.
 * Note: coach court lists still redact private *addresses* for students; that is
 * address visibility, not directory discovery.
 * - No lat/lng: all courts (capped) when page & limit omitted; else paginated.
 * - With lat/lng (+ radius) and **no** `q`: local public courts + OSM/Overpass discovery
 *   (always attempt external discovery; existing local courts do not block it).
 * - Optional `q`: text filter on name / street / city / ZIP / state (DB-only; no Overpass).
 */
export const searchCourts = async (req, res) => {
  try {
    const { lat, lng, radius, page, limit, q } = req.validated;
    const textWhere = textSearchWhere(q);

    if (lat == null || lng == null) {
      const where = publicCourtDirectoryWhere(textWhere ? { [Op.and]: [textWhere] } : {});
      if (page == null && limit == null) {
        const rows = await CourtLocation.findAll({
          where,
          attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
          order: [['id', 'ASC']],
          limit: MAX_LIST_ALL_COURTS,
        });

        return res.json(createResponse(rows, 'Courts retrieved successfully'));
      }

      const pageNum = page ?? 1;
      const limitNum = Math.min(limit ?? 10, 100);
      const offset = (pageNum - 1) * limitNum;

      const { count, rows } = await CourtLocation.findAndCountAll({
        where,
        attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
        limit: limitNum,
        offset,
        order: [['id', 'ASC']],
      });

      return paginatedResponse(
        res,
        rows,
        {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.max(1, Math.ceil(count / limitNum)),
        },
        'Courts retrieved successfully'
      );
    }

    const latitude = lat;
    const longitude = lng;
    const radiusMiles = radius;

    // Calculate bounding box (rough approximation)
    const latRange = radiusMiles / 69; // ~69 miles per degree latitude
    const lngRange = radiusMiles / (69 * Math.cos(latitude * Math.PI / 180));

    const geoParts = {
      latitude: {
        [Op.between]: [latitude - latRange, latitude + latRange],
      },
      longitude: {
        [Op.between]: [longitude - lngRange, longitude + lngRange],
      },
    };
    const where = publicCourtDirectoryWhere(
      textWhere ? { [Op.and]: [geoParts, textWhere] } : geoParts,
    );

    const mapGeoResults = (rows) => sortCourtsByDistanceFrom(rows, latitude, longitude).map((c) => {
      const plain = c.get ? c.get({ plain: true }) : { ...c };
      const d = distanceMiles(latitude, longitude, plain.latitude, plain.longitude);
      if (d != null) plain.distance_miles = Math.round(d * 10) / 10;
      return plain;
    });

    const loadLocalGeoCourts = async () => {
      const rows = await CourtLocation.findAll({
        where,
        attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
        limit: GEO_COURT_RESULT_LIMIT,
      });
      return mapGeoResults(rows);
    };

    let ordered = await loadLocalGeoCourts();

    // Geographic nearby discovery: always attempt OSM when there is no text `q`.
    // Existing local courts must NOT skip Overpass. Text search stays DB-only.
    if (!q) {
      try {
        const { discoverCourtsNearby } = await import('../services/courtImportService.js');
        const importedCourts = await discoverCourtsNearby(latitude, longitude, radiusMiles);
        ordered = await loadLocalGeoCourts();
        const msg = importedCourts.length > 0
          ? `Courts retrieved successfully (${importedCourts.length} imported)`
          : 'Courts retrieved successfully';
        return res.json(createResponse(ordered, msg));
      } catch (importError) {
        logger.error('Court nearby OSM discovery failed:', importError);
        // Keep local results (possibly empty) — never 500 solely because Overpass failed.
        return res.json(createResponse(
          ordered,
          ordered.length > 0
            ? 'Courts retrieved successfully (external discovery unavailable)'
            : 'Courts retrieved successfully (external discovery unavailable)',
        ));
      }
    }

    return res.json(createResponse(ordered, 'Courts retrieved successfully'));
  } catch (error) {
    logger.error('Error searching courts:', error);
    return res.status(500).json(createErrorResponse('Failed to search courts'));
  }
};

/**
 * GET /api/courts/:id
 * Public directory only: courts with `is_private: true` return **404** (same message
 * as missing) — hidden from public discovery by id, not from coach-linked surfaces.
 * For coach-linked courts (including discovery-hidden), use `GET /api/coaches/:id/courts`.
 */
export const getCourt = async (req, res) => {
  try {
    const courtId = req.params.id != null ? parseInt(req.params.id, 10) : null;
    if (!courtId || Number.isNaN(courtId)) {
      return res.status(400).json(createErrorResponse('Valid court ID is required'));
    }

    const court = await CourtLocation.findOne({
      where: publicCourtDirectoryWhere({ id: courtId }),
      attributes: [
        'id',
        'name',
        'address_line1',
        'city',
        'state',
        'postal_code',
        'country',
        'latitude',
        'longitude',
        'is_private',
        'source',
        'created_at',
        'updated_at',
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
 * POST /api/courts/duplicate-check
 * Geocoded proposal → nearby PickleCoach courts with high/possible confidence.
 * Does not create. Auth: coach or admin.
 */
export const checkCourtDuplicates = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    if (!userRoles.includes('coach') && !userRoles.includes('admin')) {
      return res.status(403).json(createErrorResponse('Only coaches and admins can check court duplicates'));
    }

    const proposed = {
      name: req.validated.name,
      address_line1: req.validated.address_line1,
      city: req.validated.city,
      state: req.validated.state,
      postal_code: req.validated.postal_code,
      country: req.validated.country || 'US',
      latitude: req.validated.latitude,
      longitude: req.validated.longitude,
    };

    const nearby = await findCourtsNearForDuplicateCheck(proposed.latitude, proposed.longitude, 1);
    const ranked = rankCourtDuplicateCandidates(proposed, nearby.map((c) => c.get({ plain: true })));

    return res.json(createResponse(ranked, 'Duplicate check complete'));
  } catch (error) {
    logger.error('Error checking court duplicates:', error);
    return res.status(500).json(createErrorResponse('Failed to check for duplicate courts'));
  }
};

/**
 * DELETE /api/courts/:id
 * Soft delete a court (global marketplace row). **Admin only** — coaches remove courts from their profile with
 * `DELETE /api/coaches/me/courts/:courtId` (unlink only), not this route.
 */
export const deleteCourt = async (req, res) => {
  try {
    const userRoles = req.user.roles || [];
    if (!userRoles.includes('admin')) {
      return res.status(403).json(createErrorResponse('Only admins can delete courts globally'));
    }

    const courtId = req.params.id;
    const court = await CourtLocation.findOne({ where: { id: courtId, deleted_at: null } });

    if (!court) {
      return res.status(404).json(createErrorResponse('Court not found'));
    }

    await court.update({ deleted_at: new Date() });
    // Keep coach_court_locations rows so restoring the court (create-or-reuse) restores
    // every prior coach link. Soft-deleted courts are already excluded from discovery joins.
    return res.json(createResponse(null, 'Court deleted successfully'));
  } catch (error) {
    logger.error('Error deleting court:', error);
    return res.status(500).json(createErrorResponse('Failed to delete court'));
  }
};

/**
 * POST /api/courts
 * Create a new court, or reuse an existing shared court_locations row and link the coach.
 * Identity key: (name, address_line1, city, state, postal_code, country).
 *
 * Rules:
 * - Exact identity (active or soft-deleted) → reuse (restore if soft-deleted); never overwrite fields.
 * - Court names are NOT globally unique — "Holiday Park" may exist in many cities/states.
 * - Same/nearby coordinates (geographic duplicate gate) → 409 with existing candidates to select.
 * - Different name, same address → allow (multiple courts at one venue).
 * - OSM imports use osm_type + osm_id as stable external identity (separate from this path).
 */
export const createCourt = async (req, res) => {
  try {
    const {
      name,
      address_line1,
      city,
      state,
      postal_code,
      country,
      latitude,
      longitude,
      is_private,
      acknowledge_possible_duplicates,
    } = req.validated || req.body;
    const userId = req.user.id;
    const userRoles = req.user.roles || [];
    const countryNorm = country || 'US';

    if (!userRoles.includes('coach') && !userRoles.includes('admin')) {
      return res.status(403).json(createErrorResponse('Only coaches and admins can create courts'));
    }

    const coachCourtFieldRejection = courtCreatePayloadRejectsCoachCourtFields(req.body);
    if (coachCourtFieldRejection.rejected) {
      return res.status(400).json(createErrorResponse(coachCourtFieldRejection.message));
    }

    // Coaches must geocode before create so distance + duplicate checks are meaningful.
    if (userRoles.includes('coach') && (latitude == null || longitude == null)) {
      return res.status(400).json(createErrorResponse(
        'latitude and longitude are required when creating a court. Confirm the address location first.',
      ));
    }

    const identityFields = {
      name,
      address_line1,
      city,
      state,
      postal_code,
      country: countryNorm,
    };

    // Exact identity including soft-deleted (unique index still covers deleted rows).
    let court = await CourtLocation.findOne({ where: identityFields });
    let courtWasCreated = false;
    let courtWasRestored = false;

    if (court) {
      if (court.deleted_at) {
        await court.update({ deleted_at: null });
        courtWasRestored = true;
        await court.reload();
      }
      // Reuse — do not overwrite name/address/coords/is_private.
    } else {
      // Proximity / fuzzy duplicate gate (new rows only). Names alone never block create —
      // the same display name can legitimately exist in different cities/states.
      if (latitude != null && longitude != null) {
        const nearby = await findCourtsNearForDuplicateCheck(
          parseFloat(latitude),
          parseFloat(longitude),
          1,
        );
        const ranked = rankCourtDuplicateCandidates(
          {
            ...identityFields,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
          },
          nearby.map((c) => c.get({ plain: true })),
        );

        if (ranked.high_confidence.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'COURT_DUPLICATE_HIGH',
            message:
              'We found an existing court that is very likely this location. Please use the existing court instead of creating a new one.',
            data: ranked,
          });
        }

        if (ranked.possible.length > 0 && !acknowledge_possible_duplicates) {
          return res.status(409).json({
            success: false,
            error: 'COURT_DUPLICATE_POSSIBLE',
            message:
              'We found nearby courts that may already be this location. Review them, or confirm this is a different location.',
            data: ranked,
          });
        }
      }

      try {
        court = await CourtLocation.create({
          ...identityFields,
          latitude: latitude != null ? parseFloat(latitude) : null,
          longitude: longitude != null ? parseFloat(longitude) : null,
          is_private: Boolean(is_private),
          created_by_user_id: userId,
          source: 'manual',
        });
        courtWasCreated = true;
      } catch (createErr) {
        // Race: another request created/restored the same identity — reuse that row.
        if (createErr?.name === 'SequelizeUniqueConstraintError') {
          court = await CourtLocation.findOne({ where: identityFields });
          if (court?.deleted_at) {
            await court.update({ deleted_at: null });
            courtWasRestored = true;
            await court.reload();
          }
        }
        if (!court) {
          throw createErr;
        }
      }
    }

    // Coaches are linked to the court (create or reuse). Existing shared fields are not overwritten.
    // Coaches may teach at any valid court — no geographic cluster limit between their courts.
    if (userRoles.includes('coach')) {
      let coachCourt = await CoachCourtLocation.findOne({
        where: { coach_id: userId, court_id: court.id },
      });
      let linkWasCreated = false;

      if (!coachCourt) {
        try {
          coachCourt = await CoachCourtLocation.create({
            coach_id: userId,
            court_id: court.id,
          });
          linkWasCreated = true;
        } catch (linkErr) {
          if (linkErr?.name === 'SequelizeUniqueConstraintError') {
            coachCourt = await CoachCourtLocation.findOne({
              where: { coach_id: userId, court_id: court.id },
            });
            linkWasCreated = false;
          } else {
            throw linkErr;
          }
        }
      }

      if (!coachCourt) {
        return res.status(500).json(createErrorResponse('Failed to link court to coach'));
      }

      const courtData = await CourtLocation.findByPk(court.id, {
        attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
      });
      const coachCourtData = await CoachCourtLocation.findByPk(coachCourt.id, {
        attributes: COACH_COURT_LINK_POST_COURT_RESPONSE_ATTRIBUTES,
      });

      const status = courtWasCreated || linkWasCreated ? 201 : 200;
      let message = 'Court already linked';
      if (courtWasCreated) {
        message = 'Court created successfully';
      } else if (courtWasRestored && linkWasCreated) {
        message = 'Existing court restored and linked successfully';
      } else if (linkWasCreated) {
        message = 'Existing court linked successfully';
      } else if (courtWasRestored) {
        message = 'Existing court restored';
      }

      return res.status(status).json(
        createResponse({ court: courtData, coachCourt: coachCourtData }, message),
      );
    }

    // Admin: no auto-link.
    if (courtWasCreated) {
      return res.status(201).json(createResponse(court, 'Court created successfully'));
    }
    if (courtWasRestored) {
      return res.status(200).json(createResponse(court, 'Court restored'));
    }
    return res.status(200).json(createResponse(court, 'Court already exists'));
  } catch (error) {
    logger.error('Error creating court:', error);
    return res.status(500).json(createErrorResponse('Failed to create court'));
  }
};

/**
 * GET /api/coaches/:id/courts
 * List courts where a coach teaches (for students viewing a coach's profile).
 * Public endpoint; no auth required.
 * Private-court exact address is always redacted here (booking endpoints unlock by status).
 */
export const getCoachCourtsById = async (req, res) => {
  try {
    const coachId = req.params.id != null ? parseInt(req.params.id, 10) : null;
    const { page, limit } = req.validated || {};
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_COACH_COURTS, offset: 0 };
    if (!coachId || Number.isNaN(coachId)) {
      return res.status(400).json(createErrorResponse('Valid coach ID is required'));
    }

    const coach = await findPublicActiveCoach(coachId);
    if (!coach) {
      return res.status(404).json(createErrorResponse('Coach not found'));
    }

    const coachCourts = await CoachCourtLocation.findAndCountAll({
      where: { coach_id: coachId },
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: { deleted_at: null },
          required: true,
          attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
        },
      ],
      limit: queryLimit,
      offset,
      order: [['created_at', 'ASC']],
    });

    const data = coachCourts.rows.map((link) => {
      const court = link.court;
      const serialized = serializeCourtForPublicViewer(court, {
        includeId: true,
        idKey: 'court_id',
        latKey: 'lat',
        lngKey: 'lng',
      });
      return serialized;
    });

    if (!isPaginated) {
      return res.status(200).json(createResponse(data, 'Courts retrieved successfully'));
    }

    const response = getPagingData(coachCourts, page, queryLimit);
    return paginatedResponse(res, data, response.pagination, 'Courts retrieved successfully');
  } catch (error) {
    logger.error('Error listing coach courts by id:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve courts'));
  }
};

/**
 * GET /api/coaches/me/courts
 * List courts associated with the authenticated coach
 */
export const getMyCoachCourts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit } = req.validated || {};
    const isPaginated = page != null || limit != null;
    const { limit: queryLimit, offset } = isPaginated
      ? getPagination(page, limit)
      : { limit: MAX_LIST_ALL_COACH_COURTS, offset: 0 };

    if (!(req.user.roles || []).includes('coach')) {
      return res.status(403).json(createErrorResponse(`Only coaches can view their courts. Your roles: ${(req.user.roles || []).join(', ') || 'none'}. Add the coach role via PUT /api/auth/me/role with body { "role": "coach" } if you intend to coach.`));
    }

    const coachCourts = await CoachCourtLocation.findAndCountAll({
      where: { coach_id: userId },
      attributes: COACH_COURT_LINK_API_ATTRIBUTES,
      include: [
        {
          model: CourtLocation,
          as: 'court',
          where: { deleted_at: null },
          required: true,
          attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
        },
      ],
      limit: queryLimit,
      offset,
      order: [['created_at', 'ASC']],
    });

    if (!isPaginated) {
      return res.status(200).json(createResponse(coachCourts.rows, 'Courts retrieved successfully'));
    }
    const response = getPagingData(coachCourts, page, queryLimit);
    return paginatedResponse(res, coachCourts.rows, response.pagination, 'Courts retrieved successfully');
  } catch (error) {
    logger.error('Error listing coach courts:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve courts'));
  }
};

/**
 * POST /api/coaches/me/courts
 * Link an existing court to the coach's available courts.
 * To create new courts (public or private), use POST /api/courts instead; coaches are auto-linked when they create.
 * If already linked: body must include `coach_notes` to update coach_court_locations.coach_notes (200); otherwise 409.
 */
export const addCoachCourt = async (req, res) => {
  try {
    const userId = req.user.id;
    const { court_id } = req.body;
    const { coachNotesProvided, coachNotes } = parseCoachCourtLinkCoachNotesFromBody(req.body);

    if (!(req.user.roles || []).includes('coach')) {
      return res.status(403).json(createErrorResponse(`Only coaches can add courts to their profile. Your roles: ${(req.user.roles || []).join(', ') || 'none'}.`));
    }

    const courtId = court_id != null ? parseInt(court_id, 10) : null;
    if (!courtId || Number.isNaN(courtId)) {
      return res.status(400).json(createErrorResponse('Court ID is required and must be a number'));
    }

    const courtToAdd = await CourtLocation.findOne({
      where: { id: courtId, deleted_at: null },
    });
    if (!courtToAdd) {
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
      if (!coachNotesProvided) {
        return res.status(409).json(createErrorResponse('Coach is already linked to this court'));
      }
      await existing.update({ coach_notes: coachNotes });
      const court = await CourtLocation.findByPk(courtId, {
        attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
      });
      const coachCourtData = await CoachCourtLocation.findByPk(existing.id, {
        attributes: COACH_COURT_LINK_API_ATTRIBUTES,
      });
      return res
        .status(200)
        .json(createResponse({ coachCourt: coachCourtData, court }, 'Coach court link updated'));
    }

    const coachCourt = await CoachCourtLocation.create({
      coach_id: userId,
      court_id: courtId,
      coach_notes: coachNotes,
    });

    const court = await CourtLocation.findByPk(courtId, {
      attributes: PUBLIC_COURT_LIST_ATTRIBUTES,
    });
    const coachCourtData = await CoachCourtLocation.findByPk(coachCourt.id, {
      attributes: COACH_COURT_LINK_API_ATTRIBUTES,
    });

    return res.status(201).json(createResponse({ coachCourt: coachCourtData, court }, 'Court added successfully'));
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

/**
 * DELETE /api/coaches/me/courts/:courtId
 * Unlink this coach from a court (`coach_court_locations` only). Does not soft-delete `court_locations` or affect other coaches.
 * `:courtId` is `court_locations.id` (same as `court_id` on GET /api/coaches/me/courts).
 * Success body includes `court_id` and `name` of the court unlinked from your profile.
 */
export const deleteCoachCourt = async (req, res) => {
  try {
    const userId = req.user.id;
    const courtId = req.params.courtId != null ? parseInt(req.params.courtId, 10) : null;

    if (!(req.user.roles || []).includes('coach')) {
      return res.status(403).json(createErrorResponse(`Only coaches can remove courts from their profile. Your roles: ${(req.user.roles || []).join(', ') || 'none'}.`));
    }
    if (!courtId || Number.isNaN(courtId)) {
      return res.status(400).json(createErrorResponse('Valid court ID is required'));
    }

    const court = await CourtLocation.findOne({
      where: { id: courtId, deleted_at: null },
      attributes: ['id', 'name'],
    });
    if (!court) {
      return res.status(404).json(createErrorResponse('Court not found'));
    }

    const removed = await CoachCourtLocation.destroy({
      where: { coach_id: userId, court_id: courtId },
    });
    if (removed === 0) {
      return res.status(404).json(createErrorResponse('You are not linked to this court'));
    }

    return res.status(200).json(
      createResponse(
        { court_id: court.id, name: court.name ?? null },
        'Court removed from your profile',
      ),
    );
  } catch (error) {
    logger.error('Error removing coach court:', error);
    return res.status(500).json(createErrorResponse('Failed to remove court'));
  }
};

