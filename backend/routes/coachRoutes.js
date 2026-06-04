import express from 'express';
import * as coachController from '../controllers/coachController.js';
import * as courtController from '../controllers/courtController.js';
import * as lessonController from '../controllers/lessonController.js';
import * as bookingController from '../controllers/bookingController.js';
import * as reliabilityController from '../controllers/reliabilityController.js';
import { authenticate, authorize, requireVerifiedEmailUnlessAdmin } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import {
  createCoachProfileSchema,
  updateCoachProfileSchema,
  createAvailabilitySchema,
  updateAvailabilitySchema,
  getCoachesQuerySchema,
  getCoachCourtsQuerySchema,
  getCoachAvailabilityQuerySchema,
  getMyLessonsQuerySchema,
  getBookingsQuerySchema,
} from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getCoachesQuerySchema), coachController.getCoaches);
router.get('/me/courts', authenticate, validateQuery(getCoachCourtsQuerySchema), courtController.getMyCoachCourts);
router.get('/me/lessons', authenticate, validateQuery(getMyLessonsQuerySchema), lessonController.getMyLessons);
/** Owner-scoped availability: only the authenticated coach’s rows; coach_id from session only. */
router.get(
  '/me/availability',
  authenticate,
  authorize('coach'),
  validateQuery(getCoachAvailabilityQuerySchema),
  coachController.getMyCoachAvailability,
);
router.post(
  '/me/availability',
  authenticate,
  authorize('coach'),
  validateRequest(createAvailabilitySchema),
  coachController.createAvailability,
);
router.put(
  '/me/availability/:id',
  authenticate,
  authorize('coach'),
  validateRequest(updateAvailabilitySchema),
  coachController.updateMyAvailability,
);
router.delete('/me/availability/:id', authenticate, authorize('coach'), coachController.deleteAvailability);
router.get('/bookings', authenticate, authorize('coach'), validateQuery(getBookingsQuerySchema), bookingController.getCoachBookings);
// Student-facing: coach reliability (score only)
// Must be declared before `/:id` route to avoid matching `reliability` as an `:id` param.
router.get('/me/reliability', authenticate, authorize('coach'), reliabilityController.getCoachReliabilityForMe);
router.get('/:id/reliability', authenticate, authorize('student', 'admin'), reliabilityController.getCoachReliabilityForStudent);
router.get('/:id', authenticate, authorize('student', 'admin'), coachController.getCoachById);
router.get('/:id/courts', validateQuery(getCoachCourtsQuerySchema), courtController.getCoachCourtsById);
router.post('/profile', authenticate, authorize('coach'), validateRequest(createCoachProfileSchema), coachController.createCoachProfile);
router.put('/me/profile', authenticate, authorize('coach'), validateRequest(updateCoachProfileSchema), coachController.updateMyCoachProfile);
router.put('/profile/:id', authenticate, authorize('admin'), validateRequest(updateCoachProfileSchema), coachController.updateCoachProfile);
/** Student booking flow or admin support: coaches without the student role cannot browse other coaches’ schedules here. */
router.get(
  '/:id/availability',
  authenticate,
  authorize('student', 'admin'),
  validateQuery(getCoachAvailabilityQuerySchema),
  coachController.getCoachAvailability,
);

// Coach court management
router.post('/me/courts', authenticate, courtController.addCoachCourt);
router.delete('/me/courts/:id', authenticate, courtController.deleteCoachCourt);

// Stripe Connect onboarding (financial infrastructure — verified email required; admins exempt)
router.post('/me/stripe-connect/onboard', authenticate, requireVerifiedEmailUnlessAdmin, coachController.initiateStripeConnectOnboarding);
router.get('/me/stripe-connect/status', authenticate, requireVerifiedEmailUnlessAdmin, coachController.getStripeConnectStatus);

export default router;
