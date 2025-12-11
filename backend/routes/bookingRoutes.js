import express from 'express';
import * as bookingController from '../controllers/bookingController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, bookingController.getBookings);
router.get('/:id', authenticate, bookingController.getBookingById);
router.post('/', authenticate, bookingController.createBooking);
router.put('/:id/status', authenticate, bookingController.updateBookingStatus);
router.post('/:id/cancel', authenticate, bookingController.cancelBooking);

export default router;
