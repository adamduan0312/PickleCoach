import express from 'express';
import * as userController from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, authorize('admin'), userController.getAllUsers);
router.get('/:id', authenticate, userController.getUserById);
router.put('/:id', authenticate, authorize('admin'), userController.updateUser);
router.delete('/:id', authenticate, authorize('admin'), userController.deleteUser);

export default router;
