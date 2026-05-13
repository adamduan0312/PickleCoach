import Joi from 'joi';
import { getValidReasons } from '../services/reliabilityPenaltyService.js';
import { MIN_LESSON_PRICE_USD } from '../services/paymentService.js';
import { validateDisputeResolutionPayload } from '../utils/disputeResolutionAlignment.js';

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
  price: Joi.number().positive().min(MIN_LESSON_PRICE_USD).required()
    .messages({ 'number.min': `Price must be at least $${MIN_LESSON_PRICE_USD.toFixed(2)} USD (all bookings require payment).` }),
  max_students: Joi.number().integer().min(1).max(20).default(1),
});

export const createBookingSchema = Joi.object({
  lesson_id: Joi.number().integer().positive().required(),
  scheduled_at: Joi.date().iso().greater('now').required(),
  duration_minutes: Joi.number().integer().min(15).optional(),
  player_ids: Joi.array().items(Joi.number().integer()).optional(),
  court_location_id: Joi.number().integer().positive().optional(),
  payment_method: Joi.string().valid('stripe', 'apple_pay', 'google_pay', 'card').default('stripe'),
  payment_method_id: Joi.string().max(255).optional(),
  idempotency_key: Joi.string().trim().min(8).max(255).optional(),
});

export const rescheduleSchema = Joi.object({
  // Booking ID is taken from the URL parameter (/:id/reschedule)
  new_scheduled_at: Joi.date().iso().greater('now').required(),
  reason: Joi.string().valid(...getValidReasons()).required(),
  reason_notes: Joi.string().max(255).optional(),
  paid_reschedule: Joi.boolean().default(false),
});

export const cancellationSchema = Joi.object({
  reason: Joi.string().valid(...getValidReasons()).required(),
  reason_notes: Joi.string().max(255).optional(),
});

/** Coach decline (pending booking): required message to student; optional reason code for analytics */
export const declineBookingSchema = Joi.object({
  message_to_student: Joi.string().trim().min(10).max(500).required(),
  decline_reason_code: Joi.string().max(50).allow('').optional(),
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

export const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(8).required(),
});

export const changeEmailRequestSchema = Joi.object({
  new_email: Joi.string().email().max(150).required(),
  password: Joi.string().required(),
});

export const confirmEmailChangeSchema = Joi.object({
  token: Joi.string().required(),
});

export const verifyEmailRequestSchema = Joi.object({}).unknown(false);

export const confirmEmailVerificationSchema = Joi.object({
  token: Joi.string().required(),
});

// Update schemas
export const updateProfileSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).allow('').optional(),
  phone: Joi.string().max(30).allow('').optional(),
  timezone: Joi.string().max(50).optional(),
  avatar_url: Joi.string().uri().max(255).allow('').optional(),
});

export const switchRoleSchema = Joi.object({
  role: Joi.string().valid('student', 'coach').required(),
});

export const updateUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().max(150).optional(),
  phone: Joi.string().max(30).allow('').optional(),
  timezone: Joi.string().max(50).optional(),
  avatar_url: Joi.string().uri().max(255).allow('').optional(),
  is_active: Joi.boolean().valid(true).optional(), // Only allow true (reactivation); use DELETE /api/users/:id to soft-delete
  role: Joi.string().valid('student', 'coach', 'admin').optional(),
  deleted_at: Joi.valid(null).optional(), // Allow setting to null to undelete; cannot set to a date (use DELETE endpoint)
});

export const updateLessonSchema = Joi.object({
  title: Joi.string().min(3).max(255).optional(),
  description: Joi.string().allow('').optional(),
  duration_minutes: Joi.number().integer().min(15).max(480).optional(),
  price: Joi.number().positive().min(MIN_LESSON_PRICE_USD).optional()
    .messages({ 'number.min': `Price must be at least $${MIN_LESSON_PRICE_USD.toFixed(2)} USD (all bookings require payment).` }),
  max_students: Joi.number().integer().min(1).max(20).optional(),
  is_active: Joi.boolean().optional(),
});

export const completeBookingSchema = Joi.object({
  notes: Joi.string().max(255).allow('').optional(),
});

/** Body for POST .../student-no-show: coach/admin records primary student did not attend. */
export const noShowBookingSchema = Joi.object({
  notes: Joi.string().max(255).allow('').optional(),
});

/** Admin: mark booking outcome as coach did not attend (attendance fact only). */
export const adminCoachNoShowBookingSchema = Joi.object({
  notes: Joi.string().max(255).allow('').optional(),
});

/** PUT /api/admin/users/:id/reliability — which role row to adjust (defaults to coach). */
export const adminAdjustReliabilitySchema = Joi.object({
  new_score: Joi.number().min(0).max(100).required(),
  role: Joi.string().valid('coach', 'student').default('coach'),
  reason: Joi.string().max(500).allow('').optional(),
  explanation: Joi.string().max(2000).allow('').optional(),
});

/** GET /api/admin/users/:id/reliability — which role row to read (omit: coach if user coaches, else student). */
export const adminGetUserReliabilityQuerySchema = Joi.object({
  role: Joi.string().valid('coach', 'student').optional(),
});

export const adminBookingRefundSchema = Joi.object({
  refund_amount: Joi.number().positive().min(0.01).optional(),
  reason: Joi.string().valid('requested_by_customer', 'duplicate', 'fraudulent').default('requested_by_customer'),
  reason_notes: Joi.string().max(255).allow('').optional(),
});

export const updateReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional(),
  comment: Joi.string().max(1000).allow('').optional(),
  attendance_badges: Joi.array().items(Joi.string()).optional(),
  visibility: Joi.string().valid('public', 'private', 'semi_public').optional(),
});

/** Pickleball-style self-reported level: 2.0–6.0 inclusive, half-point steps only. */
const coachSkillRatingValueSchema = Joi.number()
  .min(2)
  .max(6)
  .custom((value, helpers) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return helpers.error('any.invalid');
    const doubled = n * 2;
    if (Math.abs(doubled - Math.round(doubled)) > 1e-9) {
      return helpers.error('any.custom', {
        message: 'skill_rating must use 0.5 increments between 2.0 and 6.0 (e.g. 3.0, 3.5, 4.0)',
      });
    }
    return Math.round(n * 10) / 10;
  });

export const createCoachProfileSchema = Joi.object({
  headline: Joi.string().max(255).allow('').optional(),
  bio: Joi.string().allow('').optional(),
  hourly_rate: Joi.number().positive().optional(),
  experience_years: Joi.number().integer().min(0).max(100).optional(),
  skill_rating: coachSkillRatingValueSchema.optional().allow(null),
  /** Defaults to `self` when omitted (MVP self-report only). */
  rating_system: Joi.string().max(32).optional(),
  certifications: Joi.string().allow('').optional(),
  location: Joi.string().max(255).allow('').optional(),
});

export const updateCoachProfileSchema = Joi.object({
  headline: Joi.string().max(255).allow('').optional(),
  bio: Joi.string().allow('').optional(),
  hourly_rate: Joi.number().positive().optional(),
  experience_years: Joi.number().integer().min(0).max(100).optional(),
  skill_rating: coachSkillRatingValueSchema.optional().allow(null),
  rating_system: Joi.string().max(32).optional(),
  certifications: Joi.string().allow('').optional(),
  location: Joi.string().max(255).allow('').optional(),
});

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const createAvailabilitySchema = Joi.object({
  weekday: Joi.alternatives()
    .try(
      Joi.number().integer().min(0).max(6),
      Joi.string().valid(...WEEKDAY_NAMES).insensitive()
    )
    .required()
    .custom((value) => {
      if (value === undefined) return value;
      if (typeof value === 'number') return value;
      return WEEKDAY_NAMES.indexOf(String(value).toLowerCase());
    }, 'weekday number or name'),
  start_datetime: Joi.date().iso().optional(),
  end_datetime: Joi.date().iso().optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  /** Time-of-day only, e.g. "09:00" or "17:00:00". Interpreted in coach timezone for recurring slots. */
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional().allow(''),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).optional().allow(''),
})
  .or('start_time', 'start_datetime')
  .and('start_time', 'end_time')
  .messages({
    'object.missing': 'Must provide either start_time and end_time, or start_datetime (and optionally end_datetime).',
    'object.and': 'When using time-of-day, both start_time and end_time are required.',
  })
  .custom((value, helpers) => {
    const { start_time: st, end_time: et, start_datetime: sdt, end_datetime: edt } = value;
    if (st && et) {
      const normalize = (t) => {
        const s = String(t).trim();
        const parts = s.split(':');
        if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${(parts[2] || '00').padStart(2, '0')}`;
      };
      const a = normalize(st);
      const b = normalize(et);
      if (a >= b) return helpers.error('any.invalid');
    }
    if (sdt && edt && new Date(sdt) >= new Date(edt)) return helpers.error('any.invalid');
    return value;
  }, 'start before end')
  .messages({
    'any.invalid': 'start_time must be before end_time; start_datetime must be before end_datetime when both provided.',
  });

export const createDisputeSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  dispute_type_id: Joi.number().integer().positive().required(),
  notes: Joi.string().max(1000).allow('').optional(),
});

export const resolveDisputeSchema = Joi.object({
  /** Derived server-side from dispute id and stripped from validated payload. */
  dispute_type_code: Joi.string().required().strip(),
  /** Canonical admin ruling for all dispute types. */
  decision: Joi.string().valid('upheld', 'rejected', 'partial').required(),
  /**
   * Factual attendance determination for attendance dispute types only (required whenever
   * `dispute_type_code` is an attendance claim). Booking status follows `outcome`. For
   * `rejected`, alignment requires the contradicting outcome per claim type. For all attendance
   * decisions, `financial_action` must match `outcome` (`coach_no_show` → refund path;
   * `student_no_show` → `no_change`) — see `disputeResolutionAlignment.js`.
   */
  outcome: Joi.string()
    .valid('student_no_show', 'coach_no_show')
    .when('dispute_type_code', {
      is: Joi.valid('coach_no_show_claim', 'student_no_show_claim'),
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
  /**
   * Behavior disputes only: which party should receive reliability penalty.
   * `decision` determines whether a behavior claim is sustained; `penalize_role`
   * determines whose reliability is affected.
   */
  penalize_role: Joi.string()
    .valid('coach', 'student', 'none')
    .when('dispute_type_code', {
      is: Joi.valid('late_arrival', 'misconduct', 'lesson_not_completed'),
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
  /**
   * Money on resolve: for attendance disputes, valid combinations are constrained by `outcome`
   * (see alignment). For behavior disputes, `rejected` requires `no_change`.
   * `refund_student` = full remaining on charge; `refund_student_partial` needs `refund_amount`.
   */
  financial_action: Joi.string()
    .valid('no_change', 'refund_student', 'refund_student_partial')
    .required(),
  resolution_notes: Joi.string().max(1000).allow('').optional(),
  /** US dollars (decimal), not cents. Required for `refund_student_partial`. */
  refund_amount: Joi.number().positive().min(0.01).optional(),
})
  .custom((value, helpers) => {
    if (value.resolution_action_id != null) {
      return helpers.error('any.custom', {
        message: 'resolution_action_id is no longer accepted. Use decision + financial_action (and outcome for attendance claims).',
      });
    }
    if (value.financial_action === 'refund_student_partial' && value.refund_amount == null) {
      return helpers.error('any.custom', {
        message: 'refund_amount is required when financial_action is refund_student_partial',
      });
    }

    // `dispute_type_code` uses `.strip()` so it is omitted from `value` here; alignment still needs it.
    const disputeTypeCode = value.dispute_type_code ?? helpers.original?.dispute_type_code;

    const logical = validateDisputeResolutionPayload({
      disputeTypeCode,
      decision: value.decision,
      outcome: value.outcome,
      financialAction: value.financial_action,
      penalizeRole: value.penalize_role,
      openedBy: undefined,
    });
    if (!logical.ok) {
      return helpers.error('any.custom', { message: logical.message });
    }

    return value;
  });

export const createNotificationSchema = Joi.object({
  user_id: Joi.number().integer().positive().required(),
  type: Joi.string().required(),
  channel: Joi.string().valid('email', 'sms', 'in_app').required(),
  payload: Joi.object().optional(),
});

// Query parameter validation for GET endpoints (pagination, filters, DoS prevention)
const paginationQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
};

export const getUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  /** Omit `limit` to return all users (admin list). Pass `limit` to paginate. */
  limit: Joi.number().integer().min(1).max(10000).optional(),
  role: Joi.string().valid('student', 'coach', 'admin').optional(),
  include_deleted: Joi.string().valid('true', 'false').optional(),
  search: Joi.string().max(200).allow('').optional(),
});

export const getBookingsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string()
    .valid(
      'pending',
      'confirmed',
      'awaiting_verification',
      'completed',
      'cancelled',
      'disputed',
      'student_no_show',
      'coach_no_show'
    )
    .optional(),
  coach_id: Joi.number().integer().positive().optional(),
  student_id: Joi.number().integer().positive().optional(),
});

export const getCoachesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().positive().max(500).default(10), // miles, cap 500
  /** Filter coaches whose `skill_rating` is >= this (excludes coaches with null skill_rating). */
  min_skill_rating: coachSkillRatingValueSchema.optional(),
  /** Filter coaches whose `skill_rating` is <= this (excludes coaches with null skill_rating). */
  max_skill_rating: coachSkillRatingValueSchema.optional(),
  min_rating: Joi.number().min(0).max(5).optional(),
}).custom((value, helpers) => {
  if (
    value.min_skill_rating != null
    && value.max_skill_rating != null
    && value.min_skill_rating > value.max_skill_rating
  ) {
    return helpers.error('any.custom', {
      message: 'min_skill_rating cannot be greater than max_skill_rating',
    });
  }
  return value;
});

export const getLessonsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  coach_id: Joi.number().integer().positive().optional(),
  min_price: Joi.number().min(0).optional(),
  max_price: Joi.number().min(0).optional(),
});

export const getMyLessonsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

export const getReviewsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  target_user_id: Joi.number().integer().positive().optional(),
  reviewer_id: Joi.number().integer().positive().optional(),
});

export const getDisputesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string().valid('open', 'under_review', 'resolved').optional(),
  booking_id: Joi.number().integer().positive().optional(),
});

export const getNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string().valid('pending', 'sent', 'failed', 'read').optional(),
});

export const getPaymentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string()
    .valid(
      'pending',
      'captured',
      'failed',
      'refunded',
      'partially_refunded',
      'pending_capture',
      'pending_void'
    )
    .optional(),
  escrow_status: Joi.string()
    .valid('held', 'released', 'refunded', 'disputed', 'manual_payout_required', 'pending_release')
    .optional(),
  student_id: Joi.number().integer().positive().optional(),
  coach_id: Joi.number().integer().positive().optional(),
});

export const getConversationsQuerySchema = Joi.object({
  booking_id: Joi.number().integer().positive().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

export const getConversationByIdQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

export const getCoachCourtsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

export const getCoachAvailabilityQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

export const getRescheduleHistoryQuerySchema = Joi.object({
  booking_id: Joi.number().integer().positive().optional(),
});

export const getAuditLogsQuerySchema = Joi.object({
  ...paginationQuery,
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(10000).default(10000), // plain request = all logs
  user_id: Joi.number().integer().positive().optional(),
  action: Joi.string().max(255).trim().allow('').optional(),
  table_name: Joi.string().max(255).trim().allow('').optional(),
  record_id: Joi.number().integer().min(0).optional(),
});

/** GET /api/courts — list-all: omit lat/lng; omit page & limit to return all (server-capped). Pass page and/or limit to paginate. Geo: lat+lng together; optional radius. */
export const searchCourtsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().positive().max(100).default(10), // miles (geo search only)
}).and('lat', 'lng');
