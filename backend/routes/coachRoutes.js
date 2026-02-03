import express from 'express';
import * as coachController from '../controllers/coachController.js';
import * as courtController from '../controllers/courtController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createCoachProfileSchema, updateCoachProfileSchema, createAvailabilitySchema, getCoachesQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', validateQuery(getCoachesQuerySchema), coachController.getCoaches);
router.get('/:id', coachController.getCoachById);
router.post('/profile', authenticate, validateRequest(createCoachProfileSchema), coachController.createCoachProfile);
router.put('/profile/:id', authenticate, validateRequest(updateCoachProfileSchema), coachController.updateCoachProfile);
router.post('/availability', authenticate, validateRequest(createAvailabilitySchema), coachController.createAvailability);
router.get('/:id/availability', coachController.getCoachAvailability);

// Coach court management
router.post('/me/courts', authenticate, courtController.addCoachCourt);

// Stripe Connect onboarding
router.post('/me/stripe-connect/onboard', authenticate, coachController.initiateStripeConnectOnboarding);
router.get('/me/stripe-connect/status', authenticate, coachController.getStripeConnectStatus);

export default router;
