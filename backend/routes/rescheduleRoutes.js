import express from 'express';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { rescheduleSchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, rescheduleController.getRescheduleHistory);
router.post('/request', authenticate, validateRequest(rescheduleSchema), rescheduleController.requestReschedule);

export default router;
