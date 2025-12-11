import express from 'express';
import * as lessonController from '../controllers/lessonController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', lessonController.getLessons);
router.get('/:id', lessonController.getLessonById);
router.post('/', authenticate, lessonController.createLesson);
router.put('/:id', authenticate, lessonController.updateLesson);
router.delete('/:id', authenticate, lessonController.deleteLesson);

export default router;
