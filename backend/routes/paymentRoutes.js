import express from 'express';
import * as paymentController from '../controllers/paymentController.js';
import { authenticate } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { getPaymentsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getPaymentsQuerySchema), paymentController.getPayments);
router.get('/:id', authenticate, paymentController.getPaymentById);

export default router;
