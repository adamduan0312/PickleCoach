import express from 'express';
import * as userController from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { updateUserSchema, getUsersQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', authenticate, authorize('admin'), validateQuery(getUsersQuerySchema), userController.getAllUsers);
router.get('/:id', authenticate, authorize('admin'), userController.getUserById);
router.put('/:id', authenticate, authorize('admin'), validateRequest(updateUserSchema), userController.updateUser);
router.delete('/:id', authenticate, authorize('admin'), userController.deleteUser);

export default router;
