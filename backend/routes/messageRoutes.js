import express from 'express';
import * as messageController from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createConversationSchema, sendMessageSchema, getConversationsQuerySchema, getConversationByIdQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/conversations', authenticate, validateQuery(getConversationsQuerySchema), messageController.getConversations);
router.get('/conversations/:id', authenticate, validateQuery(getConversationByIdQuerySchema), messageController.getConversationById);
router.post('/conversations', authenticate, validateRequest(createConversationSchema), messageController.createConversation);
router.post('/send', authenticate, validateRequest(sendMessageSchema), messageController.sendMessage);
router.put('/:id/read', authenticate, messageController.markMessageAsRead);

export default router;
