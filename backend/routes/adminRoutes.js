import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { getAlertsQuerySchema, getAuditLogsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/dashboard', authenticate, authorize('admin'), adminController.getDashboardStats);
router.get('/alerts', authenticate, authorize('admin'), validateQuery(getAlertsQuerySchema), adminController.getAlerts);
router.put('/alerts/:id/resolve', authenticate, authorize('admin'), adminController.resolveAlert);
router.post('/users', authenticate, authorize('admin'), adminController.createAdmin);
router.put('/users/:id/reliability', authenticate, authorize('admin'), adminController.adjustUserReliability);

// Audit logs
router.get('/audit-logs', authenticate, authorize('admin'), validateQuery(getAuditLogsQuerySchema), adminController.getAuditLogs);

// Admin: manage a coach's courts and availability (support/moderation)
router.get('/coaches/:coachId/courts', authenticate, authorize('admin'), adminController.getCoachCourtsForAdmin);
router.delete('/coaches/:coachId/courts/:linkId', authenticate, authorize('admin'), adminController.deleteCoachCourtForAdmin);
router.delete('/coaches/:coachId/availability/:id', authenticate, authorize('admin'), adminController.deleteCoachAvailabilityForAdmin);

export default router;
