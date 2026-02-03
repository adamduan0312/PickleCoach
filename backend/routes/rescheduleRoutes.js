import express from 'express';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { rescheduleSchema, getRescheduleHistoryQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getRescheduleHistoryQuerySchema), rescheduleController.getRescheduleHistory);
router.post('/request', authenticate, validateRequest(rescheduleSchema), rescheduleController.requestReschedule);

export default router;
