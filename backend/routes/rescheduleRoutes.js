import express from 'express';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { getRescheduleHistoryQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getRescheduleHistoryQuerySchema), rescheduleController.getRescheduleHistory);

export default router;
