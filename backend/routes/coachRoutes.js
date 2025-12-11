import express from 'express';
import * as coachController from '../controllers/coachController.js';
import * as courtController from '../controllers/courtController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', coachController.getCoaches);
router.get('/:id', coachController.getCoachById);
router.post('/profile', authenticate, coachController.createCoachProfile);
router.put('/profile/:id', authenticate, coachController.updateCoachProfile);
router.post('/availability', authenticate, coachController.createAvailability);
router.get('/:id/availability', coachController.getCoachAvailability);

// Coach court management
router.post('/me/courts', authenticate, courtController.addCoachCourt);

export default router;
