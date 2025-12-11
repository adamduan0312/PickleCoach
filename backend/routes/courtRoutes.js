import express from 'express';
import * as courtController from '../controllers/courtController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.get('/', courtController.searchCourts);
router.get('/:id', courtController.getCourt);

// Protected routes
router.post('/', authenticate, courtController.createCourt);

export default router;

