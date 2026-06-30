import express from 'express';
import * as messageController from '../controllers/messageController.js';
import { authenticate, requireVerifiedEmail } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import {
  createConversationSchema,
  sendMessageSchema,
  getConversationsQuerySchema,
  getConversationByIdQuerySchema,
} from '../config/validation.js';

const router = express.Router();

router.get(
  '/conversations',
  authenticate,
  validateQuery(getConversationsQuerySchema),
  messageController.getConversations,
);
router.get(
  '/conversations/:id',
  authenticate,
  validateQuery(getConversationByIdQuerySchema),
  messageController.getConversationById,
);
router.post(
  '/conversations',
  authenticate,
  requireVerifiedEmail,
  validateRequest(createConversationSchema),
  messageController.createConversation,
);
router.post(
  '/send',
  authenticate,
  requireVerifiedEmail,
  validateRequest(sendMessageSchema),
  messageController.sendMessage,
);

export default router;
