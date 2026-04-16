import express from 'express';
import * as disputeController from '../controllers/disputeController.js';
import { authenticate, authorize, requireVerifiedEmailUnlessAdmin } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createDisputeSchema, resolveDisputeSchema, getDisputesQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, validateQuery(getDisputesQuerySchema), disputeController.getDisputes);
router.get('/:id', authenticate, disputeController.getDisputeById);
router.post('/', authenticate, requireVerifiedEmailUnlessAdmin, validateRequest(createDisputeSchema), disputeController.createDispute);
router.put('/:id/resolve', authenticate, authorize('admin'), validateRequest(resolveDisputeSchema), disputeController.resolveDispute);

export default router;
