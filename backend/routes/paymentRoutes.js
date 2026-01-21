import express from 'express';
import * as paymentController from '../controllers/paymentController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { createPaymentSchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, paymentController.getPayments);
router.get('/:id', authenticate, paymentController.getPaymentById);
router.post('/', authenticate, validateRequest(createPaymentSchema), paymentController.createPayment);
router.put('/:id/status', authenticate, authorize('admin'), paymentController.updatePaymentStatus);
router.post('/:id/refund', authenticate, authorize('admin'), paymentController.processRefund);

export default router;
