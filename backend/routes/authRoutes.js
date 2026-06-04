import express from 'express';
import * as authController from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  addUserRoleSchema,
  changePasswordSchema,
  changeEmailRequestSchema,
  confirmEmailChangeSchema,
  verifyEmailRequestSchema,
  confirmEmailVerificationSchema,
} from '../config/validation.js';

const router = express.Router();

router.post('/register', validateRequest(registerSchema), authController.register);
router.post('/login', validateRequest(loginSchema), authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/forgot-password', validateRequest(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validateRequest(resetPasswordSchema), authController.resetPassword);
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, validateRequest(updateProfileSchema), authController.updateProfile);
router.post('/logout', authenticate, authController.logout);
/** Self-service: add `student` or `coach` to `user_roles` (does not remove roles). */
router.put('/me/role', authenticate, validateRequest(addUserRoleSchema), authController.addUserRole);
router.delete('/me', authenticate, authController.deleteMyAccount);

// Sensitive account management
router.put('/change-password', authenticate, validateRequest(changePasswordSchema), authController.changePassword);
router.post('/change-email/request', authenticate, validateRequest(changeEmailRequestSchema), authController.requestEmailChange);
router.post('/change-email/confirm', validateRequest(confirmEmailChangeSchema), authController.confirmEmailChange);

// Email verification
router.post('/verify-email/request', authenticate, validateRequest(verifyEmailRequestSchema), authController.requestEmailVerification);
router.post('/verify-email/confirm', validateRequest(confirmEmailVerificationSchema), authController.confirmEmailVerification);

export default router;
