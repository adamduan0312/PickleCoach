import express from 'express';
import * as disputeController from '../controllers/disputeController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, disputeController.getDisputes);
router.get('/:id', authenticate, disputeController.getDisputeById);
router.post('/', authenticate, disputeController.createDispute);
router.put('/:id/resolve', authenticate, authorize('admin'), disputeController.resolveDispute);

export default router;
