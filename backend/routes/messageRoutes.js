import express from 'express';
import * as messageController from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/conversations', authenticate, messageController.getConversations);
router.get('/conversations/:id', authenticate, messageController.getConversationById);
router.post('/conversations', authenticate, messageController.createConversation);
router.post('/send', authenticate, messageController.sendMessage);
router.put('/:id/read', authenticate, messageController.markMessageAsRead);

export default router;
