import express from 'express';
import * as paymentController from '../controllers/paymentController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createPaymentSchema, updatePaymentStatusSchema, processRefundSchema, getPaymentsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getPaymentsQuerySchema), paymentController.getPayments);
router.get('/:id', authenticate, paymentController.getPaymentById);
router.post('/', authenticate, validateRequest(createPaymentSchema), paymentController.createPayment);
router.put('/:id/status', authenticate, authorize('admin'), validateRequest(updatePaymentStatusSchema), paymentController.updatePaymentStatus);
router.post('/:id/refund', authenticate, authorize('admin'), validateRequest(processRefundSchema), paymentController.processRefund);

export default router;
