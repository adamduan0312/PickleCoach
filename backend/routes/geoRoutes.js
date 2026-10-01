import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { geocodeSearchQuerySchema, placeSuggestQuerySchema } from '../config/validation.js';
import * as geoController from '../controllers/geoController.js';

const router = express.Router();

/** Discover location fallback: ZIP / city / address → coordinates (server-side geocode). */
router.get(
  '/search',
  authenticate,
  authorize('student', 'coach', 'admin'),
  validateQuery(geocodeSearchQuerySchema),
  geoController.searchLocations,
);

/** Coach profile "Based in" autocomplete: city-level place suggestions. */
router.get(
  '/places',
  authenticate,
  authorize('coach', 'admin'),
  validateQuery(placeSuggestQuerySchema),
  geoController.suggestPlaces,
);

export default router;
