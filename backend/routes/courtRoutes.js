import express from 'express';
import * as courtController from '../controllers/courtController.js';
import { authenticate } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validator.js';
import { searchCourtsQuerySchema } from '../config/validation.js';

const router = express.Router();

// Public routes
router.get('/', validateQuery(searchCourtsQuerySchema), courtController.searchCourts);
router.get('/:id', courtController.getCourt);

// Protected routes
router.post('/', authenticate, courtController.createCourt);
router.delete('/:id', authenticate, courtController.deleteCourt);

export default router;

