import express from 'express';
import * as rescheduleController from '../controllers/rescheduleController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, rescheduleController.getRescheduleHistory);
router.post('/request', authenticate, rescheduleController.requestReschedule);
router.put('/:id/approve', authenticate, rescheduleController.approveReschedule);

export default router;
