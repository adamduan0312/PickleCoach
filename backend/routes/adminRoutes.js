import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/dashboard', authenticate, authorize('admin'), adminController.getDashboardStats);
router.get('/alerts', authenticate, authorize('admin'), adminController.getAlerts);
router.put('/alerts/:id/resolve', authenticate, authorize('admin'), adminController.resolveAlert);

export default router;
