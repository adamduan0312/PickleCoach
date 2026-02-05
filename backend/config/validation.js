import Joi from 'joi';
import { getValidReasons } from '../services/reliabilityPenaltyService.js';

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
  role: Joi.string().valid('student', 'coach').required(), // Remove 'admin' and make required
  phone: Joi.string().max(30).optional(),
  timezone: Joi.string().default('UTC'),
  avatar_url: Joi.string().uri().max(255).allow('').optional(),
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
  court_location_id: Joi.number().integer().positive().optional(),
  payment_method: Joi.string().valid('stripe', 'apple_pay', 'google_pay', 'card').default('stripe'),
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
  reason: Joi.string().valid(...getValidReasons()).required(),
  reason_notes: Joi.string().max(255).optional(),
  paid_reschedule: Joi.boolean().default(false),
});

export const cancellationSchema = Joi.object({
  reason: Joi.string().valid(...getValidReasons()).required(),
  reason_notes: Joi.string().max(255).optional(),
});

export const reviewSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  target_user_id: Joi.number().integer().positive().optional(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(1000).optional(),
  attendance_badges: Joi.array().items(Joi.string()).optional(),
  visibility: Joi.string().valid('public', 'private', 'semi_public').default('public'),
});

export const createConversationSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
});

export const sendMessageSchema = Joi.object({
  conversation_id: Joi.number().integer().positive().required(),
  content: Joi.string().min(1).max(5000).required(),
  attachments: Joi.array().items(Joi.object()).optional(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).required(),
});

// Update schemas
export const updateProfileSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).allow('').optional(),
  phone: Joi.string().max(30).allow('').optional(),
  timezone: Joi.string().max(50).optional(),
  avatar_url: Joi.string().uri().max(255).allow('').optional(),
});

export const updateUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).optional(),
  phone: Joi.string().max(30).allow('').optional(),
  timezone: Joi.string().max(50).optional(),
  is_active: Joi.boolean().optional(),
  role: Joi.string().valid('student', 'coach', 'admin').optional(),
});

export const updateLessonSchema = Joi.object({
  title: Joi.string().min(3).max(255).optional(),
  description: Joi.string().allow('').optional(),
  duration_minutes: Joi.number().integer().min(15).max(480).optional(),
  price: Joi.number().positive().optional(),
  max_students: Joi.number().integer().min(1).max(20).optional(),
  is_active: Joi.boolean().optional(),
});

export const updateBookingStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'no_show').required(),
});

export const updateReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional(),
  comment: Joi.string().max(1000).allow('').optional(),
  attendance_badges: Joi.array().items(Joi.string()).optional(),
  visibility: Joi.string().valid('public', 'private', 'semi_public').optional(),
});

export const updatePaymentStatusSchema = Joi.object({
  payment_status: Joi.string().valid('pending', 'captured', 'failed', 'refunded', 'partially_refunded').optional(),
  escrow_status: Joi.string().valid('held', 'released', 'refunded').optional(),
  charge_id: Joi.string().optional(),
  transfer_id: Joi.string().optional(),
  payout_id: Joi.string().optional(),
});

export const createCoachProfileSchema = Joi.object({
  user_id: Joi.number().integer().positive().optional(),
  headline: Joi.string().max(255).allow('').optional(),
  bio: Joi.string().allow('').optional(),
  hourly_rate: Joi.number().positive().optional(),
  experience_years: Joi.number().integer().min(0).max(100).optional(),
  skill_level: Joi.string().valid('beginner', 'intermediate', 'advanced', 'professional').optional(),
  certifications: Joi.string().allow('').optional(),
  location: Joi.string().max(255).allow('').optional(),
});

export const updateCoachProfileSchema = Joi.object({
  headline: Joi.string().max(255).allow('').optional(),
  bio: Joi.string().allow('').optional(),
  hourly_rate: Joi.number().positive().optional(),
  experience_years: Joi.number().integer().min(0).max(100).optional(),
  skill_level: Joi.string().valid('beginner', 'intermediate', 'advanced', 'professional').optional(),
  certifications: Joi.string().allow('').optional(),
  location: Joi.string().max(255).allow('').optional(),
});

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const createAvailabilitySchema = Joi.object({
  coach_id: Joi.number().integer().positive().required(),
  weekday: Joi.alternatives()
    .try(
      Joi.number().integer().min(0).max(6),
      Joi.string().valid(...WEEKDAY_NAMES).insensitive()
    )
    .optional()
    .custom((value) => {
      if (value === undefined) return value;
      if (typeof value === 'number') return value;
      return WEEKDAY_NAMES.indexOf(String(value).toLowerCase());
    }, 'weekday number or name'),
  start_datetime: Joi.date().iso().optional(),
  end_datetime: Joi.date().iso().optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  recurrence_rule: Joi.string().optional().allow(null),
  is_available: Joi.boolean().optional(),
});

export const createDisputeSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  dispute_type_id: Joi.number().integer().positive().required(),
  notes: Joi.string().max(1000).allow('').optional(),
});

export const resolveDisputeSchema = Joi.object({
  resolution_notes: Joi.string().max(1000).allow('').optional(),
  resolution_action_id: Joi.number().integer().positive().optional(),
});

export const createNotificationSchema = Joi.object({
  user_id: Joi.number().integer().positive().required(),
  type: Joi.string().required(),
  channel: Joi.string().valid('email', 'sms', 'push').required(),
  payload: Joi.object().optional(),
});

export const processRefundSchema = Joi.object({
  amount: Joi.number().positive().optional(), // If not provided, full refund
  reason: Joi.string().max(255).optional(),
});

// Query parameter validation for GET endpoints (pagination, filters, DoS prevention)
const paginationQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
};

export const getUsersQuerySchema = Joi.object({
  ...paginationQuery,
  role: Joi.string().valid('student', 'coach', 'admin').optional(),
  is_active: Joi.string().valid('true', 'false').optional(),
});

export const getBookingsQuerySchema = Joi.object({
  ...paginationQuery,
  status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled', 'no_show').optional(),
  coach_id: Joi.number().integer().positive().optional(),
  student_id: Joi.number().integer().positive().optional(),
});

export const getCoachesQuerySchema = Joi.object({
  ...paginationQuery,
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().positive().max(500).default(10), // miles, cap 500
  skill_level: Joi.string().valid('beginner', 'intermediate', 'advanced', 'professional').optional(),
  min_rating: Joi.number().min(0).max(5).optional(),
});

export const getLessonsQuerySchema = Joi.object({
  ...paginationQuery,
  coach_id: Joi.number().integer().positive().optional(),
  min_price: Joi.number().min(0).optional(),
  max_price: Joi.number().min(0).optional(),
});

export const getReviewsQuerySchema = Joi.object({
  ...paginationQuery,
  target_user_id: Joi.number().integer().positive().optional(),
  reviewer_id: Joi.number().integer().positive().optional(),
});

export const getDisputesQuerySchema = Joi.object({
  ...paginationQuery,
  status: Joi.string().valid('open', 'under_review', 'resolved').optional(),
  booking_id: Joi.number().integer().positive().optional(),
});

export const getNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('pending', 'sent', 'failed', 'read').optional(),
});

export const getPaymentsQuerySchema = Joi.object({
  ...paginationQuery,
  status: Joi.string().valid('pending', 'captured', 'failed', 'refunded', 'partially_refunded').optional(),
  escrow_status: Joi.string().valid('held', 'released', 'refunded').optional(),
  student_id: Joi.number().integer().positive().optional(),
  coach_id: Joi.number().integer().positive().optional(),
});

export const getConversationsQuerySchema = Joi.object({
  booking_id: Joi.number().integer().positive().optional(),
});

export const getConversationByIdQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

export const getRescheduleHistoryQuerySchema = Joi.object({
  booking_id: Joi.number().integer().positive().optional(),
});

export const getAlertsQuerySchema = Joi.object({
  resolved: Joi.string().valid('true', 'false').default('false'),
});

export const searchCourtsQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(100).default(10), // miles
});
