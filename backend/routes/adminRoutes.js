import express from 'express';
import * as adminController from '../controllers/adminController.js';
import * as reliabilityController from '../controllers/reliabilityController.js';
import * as bookingController from '../controllers/bookingController.js';
import * as lessonController from '../controllers/lessonController.js';
import * as disputeController from '../controllers/disputeController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateQuery, validateRequest } from '../middleware/validator.js';
import {
  getAuditLogsQuerySchema,
  cancellationSchema,
  adminBookingRefundSchema,
  noShowBookingSchema,
  adminCoachNoShowBookingSchema,
  adminAdjustReliabilitySchema,
  adminGetUserReliabilityQuerySchema,
  getBookingsQuerySchema,
  getAdminLessonsQuerySchema,
  createDisputeSchema,
} from '../config/validation.js';

const router = express.Router();

router.get('/dashboard', authenticate, authorize('admin'), adminController.getDashboardStats);
router.post('/users', authenticate, authorize('admin'), adminController.createAdmin);
router.put(
  '/users/:id/reliability',
  authenticate,
  authorize('admin'),
  validateRequest(adminAdjustReliabilitySchema),
  adminController.adjustUserReliability,
);
router.get(
  '/users/:id/reliability',
  authenticate,
  authorize('admin'),
  validateQuery(adminGetUserReliabilityQuerySchema),
  reliabilityController.getUserReliabilityForAdmin,
);

// Audit logs
router.get('/audit-logs', authenticate, authorize('admin'), validateQuery(getAuditLogsQuerySchema), adminController.getAuditLogs);

// Admin: manage a coach's courts and availability (support/moderation)
router.get('/coaches/:coachId/courts', authenticate, authorize('admin'), adminController.getCoachCourtsForAdmin);
router.delete('/coaches/:coachId/courts/:courtId', authenticate, authorize('admin'), adminController.deleteCoachCourtForAdmin);
router.delete('/coaches/:coachId/availability/:id', authenticate, authorize('admin'), adminController.deleteCoachAvailabilityForAdmin);

// Admin lesson inventory (not marketplace-gated; pair with GET /api/lessons/:id for detail)
router.get(
  '/lessons',
  authenticate,
  authorize('admin'),
  validateQuery(getAdminLessonsQuerySchema),
  lessonController.getAdminLessons,
);

// Admin booking overrides
router.get('/bookings', authenticate, authorize('admin'), validateQuery(getBookingsQuerySchema), bookingController.getAdminBookings);
router.get('/bookings/:id', authenticate, authorize('admin'), bookingController.getAdminBookingById);
router.post('/bookings/:id/cancel', authenticate, authorize('admin'), validateRequest(cancellationSchema), bookingController.adminPreLessonCancelBooking);
/** Same as coach route: marks student no-show. Coach no-show: `POST .../coach-no-show`. */
router.post('/bookings/:id/student-no-show', authenticate, authorize('admin'), validateRequest(noShowBookingSchema), bookingController.adminMarkBookingNoShow);
router.post(
  '/bookings/:id/coach-no-show',
  authenticate,
  authorize('admin'),
  validateRequest(adminCoachNoShowBookingSchema),
  bookingController.adminMarkCoachNoShow,
);
router.post('/bookings/:id/refund', authenticate, authorize('admin'), validateRequest(adminBookingRefundSchema), bookingController.adminRefundBooking);

/** Same handler as `POST /api/disputes`; sets `opened_by` → `admin`. Use when support records an issue without a self-serve dispute from the student/coach. */
router.post('/disputes', authenticate, authorize('admin'), validateRequest(createDisputeSchema), disputeController.createDispute);

export default router;
