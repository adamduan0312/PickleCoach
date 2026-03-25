import express from 'express';
import * as coachController from '../controllers/coachController.js';
import * as courtController from '../controllers/courtController.js';
import * as reliabilityController from '../controllers/reliabilityController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createCoachProfileSchema, updateCoachProfileSchema, createAvailabilitySchema, getCoachesQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getCoachesQuerySchema), coachController.getCoaches);
router.get('/me/courts', authenticate, courtController.getMyCoachCourts);
// Student-facing: coach reliability (score only)
// Must be declared before `/:id` route to avoid matching `reliability` as an `:id` param.
router.get('/me/reliability', authenticate, authorize('coach'), reliabilityController.getCoachReliabilityForMe);
router.get('/:id/reliability', authenticate, authorize('student', 'admin'), reliabilityController.getCoachReliabilityForStudent);
router.get('/:id', authenticate, authorize('student', 'admin'), coachController.getCoachById);
router.get('/:id/courts', courtController.getCoachCourtsById);
router.post('/profile', authenticate, authorize('coach'), validateRequest(createCoachProfileSchema), coachController.createCoachProfile);
router.put('/profile/:id', authenticate, validateRequest(updateCoachProfileSchema), coachController.updateCoachProfile);
router.post('/availability', authenticate, validateRequest(createAvailabilitySchema), coachController.createAvailability);
router.delete('/availability/:id', authenticate, coachController.deleteAvailability);
router.get('/:id/availability', coachController.getCoachAvailability);

// Coach court management
router.post('/me/courts', authenticate, courtController.addCoachCourt);
router.delete('/me/courts/:id', authenticate, courtController.deleteCoachCourt);

// Stripe Connect onboarding
router.post('/me/stripe-connect/onboard', authenticate, coachController.initiateStripeConnectOnboarding);
router.get('/me/stripe-connect/status', authenticate, coachController.getStripeConnectStatus);

export default router;
