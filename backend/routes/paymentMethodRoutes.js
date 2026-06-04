import express from 'express';
import * as paymentMethodController from '../controllers/paymentMethodController.js';
import { authenticate, requireVerifiedEmailUnlessAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, requireVerifiedEmailUnlessAdmin, paymentMethodController.listMyPaymentMethods);
router.post('/', authenticate, requireVerifiedEmailUnlessAdmin, paymentMethodController.addMyPaymentMethod);
router.put('/:id/default', authenticate, requireVerifiedEmailUnlessAdmin, paymentMethodController.setMyDefaultPaymentMethod);
router.delete('/:id', authenticate, requireVerifiedEmailUnlessAdmin, paymentMethodController.deleteMyPaymentMethod);

export default router;

