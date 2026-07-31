import express from 'express';
import * as lessonController from '../controllers/lessonController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { createLessonSchema, updateLessonSchema } from '../config/validation.js';

const router = express.Router();

/** Deprecated lesson-first catalog — use GET /api/coaches/:id/lessons */
router.get('/', lessonController.getLessons);
router.get('/:id', authenticate, lessonController.getLessonById);
/** Coach only — admins moderate via PUT/DELETE, they do not create offerings. */
router.post(
  '/',
  authenticate,
  authorize('coach'),
  validateRequest(createLessonSchema),
  lessonController.createLesson,
);
router.put('/:id', authenticate, validateRequest(updateLessonSchema), lessonController.updateLesson);
router.delete('/:id', authenticate, lessonController.deleteLesson);

export default router;
