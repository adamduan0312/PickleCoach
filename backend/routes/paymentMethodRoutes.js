import express from 'express';
import * as paymentMethodController from '../controllers/paymentMethodController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, paymentMethodController.listMyPaymentMethods);
router.post('/', authenticate, paymentMethodController.addMyPaymentMethod);
router.put('/:id/default', authenticate, paymentMethodController.setMyDefaultPaymentMethod);
router.delete('/:id', authenticate, paymentMethodController.deleteMyPaymentMethod);

export default router;

