import express from 'express';
import * as lessonController from '../controllers/lessonController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest, validateQuery } from '../middleware/validator.js';
import { createLessonSchema, updateLessonSchema, getLessonsQuerySchema } from '../config/validation.js';

const router = express.Router();

router.get('/', validateQuery(getLessonsQuerySchema), lessonController.getLessons);
router.get('/:id', lessonController.getLessonById);
router.post('/', authenticate, validateRequest(createLessonSchema), lessonController.createLesson);
router.put('/:id', authenticate, validateRequest(updateLessonSchema), lessonController.updateLesson);
router.delete('/:id', authenticate, lessonController.deleteLesson);

export default router;
