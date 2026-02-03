import express from 'express';
import * as authController from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema } from '../config/validation.js';

const router = express.Router();

router.post('/register', validateRequest(registerSchema), authController.register);
router.post('/login', validateRequest(loginSchema), authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/forgot-password', validateRequest(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validateRequest(resetPasswordSchema), authController.resetPassword);
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, validateRequest(updateProfileSchema), authController.updateProfile);

export default router;
