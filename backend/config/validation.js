import Joi from 'joi';

// Environment variable validation
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(4000),
  // Make DB vars optional since config.json is used
  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().optional(),
  DB_USER: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional(),
  DB_NAME: Joi.string().optional(),
  // JWT_SECRET still required for auth
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  // Stripe vars optional (only needed when processing payments)
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
}).unknown();

// Request validation schemas
export const registerSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().max(150).required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('student', 'coach', 'admin').default('student'),
  phone: Joi.string().max(30).optional(),
  timezone: Joi.string().default('UTC'),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const createLessonSchema = Joi.object({
  title: Joi.string().min(3).max(255).required(),
  description: Joi.string().optional(),
  duration_minutes: Joi.number().integer().min(15).max(480).required(),
  price: Joi.number().positive().required(),
  max_students: Joi.number().integer().min(1).max(20).default(1),
});

export const createBookingSchema = Joi.object({
  lesson_id: Joi.number().integer().positive().required(),
  scheduled_at: Joi.date().iso().greater('now').required(),
  duration_minutes: Joi.number().integer().min(15).optional(),
  player_ids: Joi.array().items(Joi.number().integer()).optional(),
});

export const createPaymentSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  payment_method: Joi.string().valid('stripe', 'apple_pay', 'google_pay', 'card').default('stripe'),
  payment_intent_id: Joi.string().optional(),
  charge_id: Joi.string().optional(),
});

export const rescheduleSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  new_scheduled_at: Joi.date().iso().greater('now').required(),
  reason: Joi.string().max(500).optional(),
  paid_reschedule: Joi.boolean().default(false),
});

export const reviewSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  target_user_id: Joi.number().integer().positive().optional(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(1000).optional(),
  attendance_badges: Joi.array().items(Joi.string()).optional(),
  visibility: Joi.string().valid('public', 'private', 'semi_public').default('public'),
});
