import express from 'express';
import * as reliabilityController from '../controllers/reliabilityController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/me/reliability', authenticate, authorize('student'), reliabilityController.getStudentReliabilityForMe);

export default router;
