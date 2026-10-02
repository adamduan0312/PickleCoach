import Joi from 'joi';
import { getValidReasons } from '../services/reliabilityPenaltyService.js';
import { getValidDeclineReasonCodes } from '../utils/declineReasonCodes.js';
import { MIN_LESSON_PRICE_USD } from '../services/paymentEngine.js';
import { validateDisputeResolutionPayload } from '../utils/disputeResolutionAlignment.js';
import { COACH_RATING_SYSTEM_VALUES, validateSkillRatingForSystem } from '../utils/coachRating.js';
import { COACH_CERTIFICATION_MAX_LENGTH, COACH_CERTIFICATIONS_MAX_COUNT } from '../utils/coachCertifications.js';
import { isRealCalendarDate } from '../utils/availabilityRules.js';
import {
  LESSON_TYPES,
  GROUP_MAX_PLAYERS_MIN,
  GROUP_MAX_PLAYERS_MAX,
  LESSON_TITLE_MIN,
  LESSON_TITLE_MAX,
  LESSON_DESCRIPTION_MAX,
  LESSON_DURATION_MIN,
  LESSON_DURATION_MAX,
  LESSON_PRICE_MAX_USD,
  hasCentsPrecision,
} from '../utils/lessonOffering.js';

// Environment variable validation
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(4000),
  // Make DB vars optional since config.json / database.cjs defaults exist in non-prod
  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().optional(),
  DB_USER: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional().allow(''),
  DB_NAME: Joi.string().optional(),
  // JWT_SECRET still required for auth
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  /**
   * Comma-separated browser origins allowed by CORS.
   * Required in production — never fall back to a permissive allow-all there.
   */
  FRONTEND_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(1).required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  APP_URL: Joi.string().optional().allow(''),
  // Stripe: optional in development/test; required live keys in production
  STRIPE_SECRET_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .pattern(/^sk_live_/)
      .required()
      .messages({
        'string.pattern.base': 'STRIPE_SECRET_KEY must be a live secret key (sk_live_…) in production',
        'any.required': 'STRIPE_SECRET_KEY is required in production',
      }),
    otherwise: Joi.string().optional().allow(''),
  }),
  STRIPE_WEBHOOK_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(10).required(),
    otherwise: Joi.string().optional().allow(''),
  }),
  /** When false/0, cron workers do not start (API-only process). Default: enabled outside test. */
  WORKERS_ENABLED: Joi.string().valid('true', 'false', '1', '0').optional(),
}).unknown();

/** MVP password policy: min 10 chars, one lowercase, one uppercase, one digit (no symbol requirement). */
export const mvpPasswordSchema = Joi.string()
  .min(10)
  .max(128)
  .custom((value, helpers) => {
    if (!/[a-z]/.test(value)) {
      return helpers.error('password.missingLowercase');
    }
    if (!/[A-Z]/.test(value)) {
      return helpers.error('password.missingUppercase');
    }
    if (!/\d/.test(value)) {
      return helpers.error('password.missingDigit');
    }
    return value;
  })
  .messages({
    'string.min': 'Password must be at least 10 characters.',
    'string.max': 'Password must be at most 128 characters.',
    'password.missingLowercase': 'Password must contain at least one lowercase letter.',
    'password.missingUppercase': 'Password must contain at least one uppercase letter.',
    'password.missingDigit': 'Password must contain at least one number.',
  });

/**
 * Phone numbers: digits with optional leading +, spaces, dashes, dots, parentheses.
 * 7–15 digits (E.164 max). Empty string clears the phone where `.allow('')` is used.
 */
export const phoneSchema = Joi.string()
  .trim()
  .max(30)
  .pattern(/^\+?[\d\s().-]+$/)
  .custom((value, helpers) => {
    const digits = value.replace(/\D/g, '').length;
    if (digits < 7 || digits > 15) return helpers.error('phone.digits');
    return value;
  })
  .messages({
    'string.pattern.base': 'Phone number can only contain digits, spaces, and + ( ) - .',
    'phone.digits': 'Enter a valid phone number (7–15 digits).',
  });

/** True when the runtime recognizes `value` as an IANA time zone (e.g. America/Chicago, UTC). */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = Joi.string()
  .trim()
  .max(50)
  .custom((value, helpers) => (isValidTimeZone(value) ? value : helpers.error('timezone.invalid')))
  .messages({ 'timezone.invalid': 'Please choose a valid time zone.' });

// Request validation schemas
export const registerSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().max(150).required(),
  password: mvpPasswordSchema.required(),
  role: Joi.string().valid('student', 'coach').required(), // Remove 'admin' and make required
  phone: phoneSchema.allow('').optional(),
  timezone: timezoneSchema.default('UTC'),
  avatar_url: Joi.string().uri().max(255).allow('').optional(),
});

/** POST /api/admin/users — provision an administrator (same password policy as register). */
export const createAdminSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().max(150).required(),
  password: mvpPasswordSchema.required(),
  phone: phoneSchema.allow('').optional(),
  timezone: timezoneSchema.default('UTC'),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

/** Lesson `price` is total for the slot; `effective_hourly_rate` = price / (duration_minutes / 60). Duration must stay > 0 (enforced: min 15). */
const lessonTitleSchema = Joi.string().trim().min(LESSON_TITLE_MIN).max(LESSON_TITLE_MAX).messages({
  'string.empty': 'Enter a lesson title.',
  'string.min': `Title must be at least ${LESSON_TITLE_MIN} characters.`,
  'string.max': `Title must be ${LESSON_TITLE_MAX} characters or fewer.`,
  'any.required': 'Enter a lesson title.',
});

const lessonDescriptionSchema = Joi.string().trim().allow('').max(LESSON_DESCRIPTION_MAX).messages({
  'string.max': `Description must be ${LESSON_DESCRIPTION_MAX} characters or fewer.`,
});

const lessonDurationSchema = Joi.number().integer().min(LESSON_DURATION_MIN).max(LESSON_DURATION_MAX).messages({
  'number.base': 'Choose a lesson duration.',
  'number.integer': 'Duration must be a whole number of minutes.',
  'number.min': `Duration must be at least ${LESSON_DURATION_MIN} minutes.`,
  'number.max': `Duration must be ${LESSON_DURATION_MAX} minutes or fewer.`,
  'any.required': 'Choose a lesson duration.',
});

const lessonPriceSchema = Joi.number()
  .min(MIN_LESSON_PRICE_USD)
  .max(LESSON_PRICE_MAX_USD)
  .custom((value, helpers) => (hasCentsPrecision(value) ? value : helpers.error('price.cents')))
  .messages({
    'number.base': 'Enter a price.',
    'number.min': `Price must be at least $${MIN_LESSON_PRICE_USD.toFixed(2)} USD (all bookings require payment).`,
    'number.max': `Price must be $${LESSON_PRICE_MAX_USD.toLocaleString('en-US')} or less.`,
    'price.cents': 'Price can have at most two decimal places.',
    'any.required': 'Enter a price.',
  });

const lessonTypeSchema = Joi.string().valid(...LESSON_TYPES).messages({
  'any.only': 'Lesson type must be Private or Group.',
});

/** Group lessons require a value (checked with lesson_type in resolveLessonOffering). */
const lessonMaxPlayersSchema = Joi.number()
  .integer()
  .min(GROUP_MAX_PLAYERS_MIN)
  .max(GROUP_MAX_PLAYERS_MAX)
  .allow(null)
  .messages({
    'number.base': `Maximum players must be a number from ${GROUP_MAX_PLAYERS_MIN} to ${GROUP_MAX_PLAYERS_MAX}.`,
    'number.integer': 'Maximum players must be a whole number.',
    'number.min': `Maximum players must be at least ${GROUP_MAX_PLAYERS_MIN}.`,
    'number.max': `Maximum players must be ${GROUP_MAX_PLAYERS_MAX} or fewer.`,
  });

export const createLessonSchema = Joi.object({
  title: lessonTitleSchema.required(),
  description: lessonDescriptionSchema.optional(),
  duration_minutes: lessonDurationSchema.required(),
  price: lessonPriceSchema.required(),
  max_students: Joi.number().integer().min(1).max(20).default(1),
  lesson_type: lessonTypeSchema.default('private'),
  max_players: lessonMaxPlayersSchema.optional(),
});

export const createBookingSchema = Joi.object({
  lesson_id: Joi.number().integer().positive().required(),
  scheduled_at: Joi.date().iso().greater('now').required(),
  duration_minutes: Joi.number().integer().min(15).optional(),
  /** MVP: one student (JWT) per booking. Multi-player / group lessons are V2 — do not send. */
  player_ids: Joi.any().forbidden().messages({
    'any.unknown': 'player_ids is not supported in MVP (one student per booking). Omit this field.',
    'any.forbidden': 'player_ids is not supported in MVP (one student per booking). Omit this field.',
  }),
  court_location_id: Joi.number().integer().positive().optional(),
  payment_method: Joi.string().valid('stripe', 'apple_pay', 'google_pay', 'card').default('stripe'),
  payment_method_id: Joi.string().max(255).optional(),
  idempotency_key: Joi.string().trim().min(8).max(255).optional(),
});

/**
 * Authorize-first intent (MVP marketplace package):
 * - Student buys a fixed lesson (price + duration from the lesson row).
 * - Must pick one of the coach's courts (`court_location_id` required).
 * - Do not send `duration_minutes` (lesson owns duration) or `player_ids`.
 */
export const createBookingIntentSchema = Joi.object({
  lesson_id: Joi.number().integer().positive().required(),
  scheduled_at: Joi.date().iso().greater('now').required(),
  duration_minutes: Joi.any().forbidden().messages({
    'any.unknown': 'duration_minutes is set by the lesson. Omit this field.',
    'any.forbidden': 'duration_minutes is set by the lesson. Omit this field.',
  }),
  player_ids: Joi.any().forbidden().messages({
    'any.unknown': 'player_ids is not supported in MVP (one student per booking). Omit this field.',
    'any.forbidden': 'player_ids is not supported in MVP (one student per booking). Omit this field.',
  }),
  court_location_id: Joi.number().integer().positive().required()
    .messages({ 'any.required': 'court_location_id is required — choose one of the coach\'s courts.' }),
  payment_method: Joi.string().valid('stripe', 'apple_pay', 'google_pay', 'card').default('stripe'),
  payment_method_id: Joi.string().max(255).optional(),
  /** Stable id for one checkout attempt (refresh/double-submit safe; new on each intentional rebook). */
  booking_attempt_id: Joi.string().trim().min(8).max(64).optional(),
  idempotency_key: Joi.string().trim().min(8).max(255).optional(),
});

export const confirmBookingSchema = Joi.object({
  payment_intent_id: Joi.string().trim().min(3).max(255).required(),
});

export const cancellationSchema = Joi.object({
  reason: Joi.string().valid(...getValidReasons()).required(),
  reason_notes: Joi.string().max(255).optional(),
});

/** POST /api/bookings/:id/weather-cancellation — optional note to the other participant. */
export const weatherCancellationRequestSchema = Joi.object({
  note: Joi.string().trim().max(255).allow('').optional(),
});

/** Coach decline (pending booking): required message to student; optional analytics reason code */
export const declineBookingSchema = Joi.object({
  message_to_student: Joi.string().trim().min(3).max(500).required(),
  decline_reason_code: Joi.string().valid(...getValidDeclineReasonCodes()).allow('').optional(),
});

export const reviewSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  // Empty string is common from optional textareas; treat as omitted.
  comment: Joi.string().max(1000).allow('').empty('').optional(),
});

export const createConversationSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
});

export const sendMessageSchema = Joi.object({
  conversation_id: Joi.number().integer().positive().required(),
  message_text: Joi.string().min(1).max(5000).required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: mvpPasswordSchema.required(),
});

export const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: mvpPasswordSchema.required(),
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
  phone: phoneSchema.allow('').optional(),
  timezone: timezoneSchema.optional(),
});

export const addUserRoleSchema = Joi.object({
  role: Joi.string().valid('student', 'coach').required(),
  /** Default `add` keeps older clients working. `remove` drops the role without deleting historical data. */
  action: Joi.string().valid('add', 'remove').default('add'),
});

export const updateUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().max(150).optional(),
  phone: phoneSchema.allow('').optional(),
  timezone: timezoneSchema.optional(),
  avatar_url: Joi.alternatives()
    .try(
      Joi.string().uri({ scheme: ['http', 'https'] }).max(255),
      Joi.string().pattern(/^\/uploads\/avatars\/[A-Za-z0-9._-]+$/).max(255),
    )
    .allow('', null)
    .optional(),
  /**
   * Account access flag (admin only).
   * - `true` = reactivate (Active) — rejected if user is still soft-deleted unless `deleted_at: null` is also sent
   * - `false` = suspend (Suspended) — does not set `deleted_at` or touch coach profile
   * Soft-delete via DELETE /api/users/:id (sets deleted_at + is_active false).
   */
  is_active: Joi.boolean().optional(),
  /** Full role set to assign (replaces all `user_roles` rows). Omit to leave roles unchanged. Any non-empty subset of {student, coach, admin} with unique entries (1–3 roles). */
  roles: Joi.array()
    .items(Joi.string().valid('student', 'coach', 'admin'))
    .min(1)
    .max(3)
    .unique()
    .optional(),
  /** Set `false` to re-open self-service `PUT /api/auth/me/role` (clears allow-list). Cannot be combined with `roles` in the same request. */
  role_governance_locked: Joi.boolean().optional(),
  /** Set to `null` to restore a soft-deleted user (+ coach profile). Cannot set to a date (use DELETE endpoint). */
  deleted_at: Joi.valid(null).optional(),
  /** @deprecated Use `roles` (full set). Sending this field returns 400. */
  role: Joi.any().forbidden().messages({
    'any.unknown': 'Use "roles" (array) to set user roles, not "role".',
  }),
}).custom((v, helpers) => {
  if (v.roles !== undefined && v.role_governance_locked === false) {
    return helpers.error('any.custom', {
      message:
        'Cannot set role_governance_locked to false in the same request as roles. Unlock self-service role adds in a separate request without the roles field.',
    });
  }
  return v;
});

export const updateLessonSchema = Joi.object({
  title: lessonTitleSchema.optional(),
  description: lessonDescriptionSchema.optional(),
  /** Omit to leave unchanged; when sent, must be ≥ 15 so hourly derivation never divides by zero. */
  duration_minutes: lessonDurationSchema.optional(),
  price: lessonPriceSchema.optional(),
  max_students: Joi.number().integer().min(1).max(20).optional(),
  lesson_type: lessonTypeSchema.optional(),
  max_players: lessonMaxPlayersSchema.optional(),
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
});

/**
 * Shape only — range/precision depend on the rating system and are checked on the
 * effective (merged) pair by `resolveCoachRating` in the coach controller.
 */
const coachSkillRatingValueSchema = Joi.number().messages({
  'number.base': 'skill_rating must be a number',
});

const coachRatingSystemSchema = Joi.string()
  .valid(...COACH_RATING_SYSTEM_VALUES)
  .allow(null)
  .optional()
  .messages({
    'any.only': `rating_system must be one of: ${COACH_RATING_SYSTEM_VALUES.join(', ')}`,
    'string.empty': `rating_system must be one of: ${COACH_RATING_SYSTEM_VALUES.join(', ')}`,
  });

export const COACH_BIO_MAX = 1000;

const coachCertificationsSchema = Joi.array()
  .items(
    Joi.string()
      .trim()
      .allow('')
      .max(COACH_CERTIFICATION_MAX_LENGTH)
      .messages({
        'string.base': 'Each certification must be text.',
        'string.max': `Each certification must be ${COACH_CERTIFICATION_MAX_LENGTH} characters or fewer.`,
      }),
  )
  .max(COACH_CERTIFICATIONS_MAX_COUNT)
  .allow(null)
  .optional()
  .messages({
    'array.base': 'Certifications must be a list of names.',
    'array.max': `You can list up to ${COACH_CERTIFICATIONS_MAX_COUNT} certifications.`,
  });

const coachProfileFields = {
  headline: Joi.string().trim().max(255).allow('').optional(),
  bio: Joi.string()
    .trim()
    .max(COACH_BIO_MAX)
    .allow('')
    .optional()
    .messages({ 'string.max': `Bio must be ${COACH_BIO_MAX.toLocaleString('en-US')} characters or fewer.` }),
  experience_years: Joi.number().integer().min(0).max(100).allow(null).optional(),
  skill_rating: coachSkillRatingValueSchema.optional().allow(null),
  rating_system: coachRatingSystemSchema,
  certifications: coachCertificationsSchema,
  location: Joi.string().max(255).allow('').optional(),
};

export const createCoachProfileSchema = Joi.object(coachProfileFields);

export const updateCoachProfileSchema = Joi.object(coachProfileFields);

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const AVAILABILITY_DATE_LABELS = { start_date: 'Start date', end_date: 'End date' };

/** Plain calendar YYYY-MM-DD (no Date coercion — avoids timezone off-by-one); must be a real day. */
const dateOnlyYmdSchema = Joi.string()
  .trim()
  .allow('', null)
  .optional()
  .custom((value, helpers) => {
    if (!value) return value;
    if (isRealCalendarDate(value)) return value;
    const label = AVAILABILITY_DATE_LABELS[helpers.state.path.at(-1)] || 'Date';
    return helpers.error('availability.rule', { message: `${label} must be a real calendar date (YYYY-MM-DD).` });
  })
  .messages({ 'availability.rule': '{{#message}}' });

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
  start_date: dateOnlyYmdSchema,
  end_date: dateOnlyYmdSchema,
  /** Time-of-day only, e.g. "09:00" or "17:00:00". Interpreted in coach timezone for recurring slots. */
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).required(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/).required(),
})
  .messages({
    'object.and': 'Both start_time and end_time are required.',
  })
  .custom((value, helpers) => {
    const { start_time: st, end_time: et, start_date: sd, end_date: ed } = value;
    const normalize = (t) => {
      const s = String(t).trim();
      const parts = s.split(':');
      if (parts.length === 2) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${(parts[2] || '00').padStart(2, '0')}`;
    };
    const fieldError = (field, message) => helpers.error('availability.rule', { message }, { ...helpers.state, path: [field] });
    const a = normalize(st);
    const b = normalize(et);
    if (a >= b) {
      return fieldError('end_time', 'End time must be after start time. Windows can’t cross midnight — add the late part to the next day instead.');
    }
    const sdx = sd && String(sd).trim() ? String(sd).trim() : null;
    const edx = ed && String(ed).trim() ? String(ed).trim() : null;
    if (sdx && edx && sdx > edx) return fieldError('end_date', 'End date must be on or after the start date.');
    return { ...value, start_date: sdx, end_date: edx };
  }, 'start before end and date range')
  .messages({ 'availability.rule': '{{#message}}' });

/** PUT /api/coaches/me/availability/:id — same shape as create (replace slot fields). */
export const updateAvailabilitySchema = createAvailabilitySchema;

export const createDisputeSchema = Joi.object({
  booking_id: Joi.number().integer().positive().required(),
  dispute_type_id: Joi.number().integer().positive().required(),
  notes: Joi.string().max(1000).allow('').optional(),
});

export const resolveDisputeSchema = Joi.object({
  /** Derived server-side from dispute id and stripped from validated payload. */
  dispute_type_code: Joi.string().required().strip(),
  /** Canonical admin ruling for all dispute types. */
  decision: Joi.string().valid('upheld', 'rejected').required(),
  /**
   * Payload validation only. Successful resolve also sets `bookings.attendance_finalized`
   * for **all** dispute types (attendance + behavior) — see `disputeController.resolveDispute`
   * and `backend/docs/dispute-finalization.md`. That DB flag is not inferred from this schema.
   *
   * Factual attendance determination for attendance dispute types only (required whenever
   * `dispute_type_code` is an attendance claim). Booking status follows `outcome`:
   * `coach_no_show` / `student_no_show` → that booking status; `lesson_occurred` (reject only)
   * → `completed` with `no_change`. Rejected claims may still use the contradicting no-show
   * when the other party was actually a no-show. Financial action must match outcome
   * (`coach_no_show` → refund path; `student_no_show` / `lesson_occurred` → `no_change`) —
   * see `disputeResolutionAlignment.js`.
   */
  outcome: Joi.string()
    .valid('student_no_show', 'coach_no_show', 'lesson_occurred')
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
      is: Joi.valid('misconduct', 'lesson_not_completed'),
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
  entity_type: Joi.string().max(50).optional(),
  entity_id: Joi.number().integer().positive().optional(),
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
  /**
   * Explicit soft-delete filter:
   * - `true` → only soft-deleted users (`deleted_at` set)
   * - `false` → only non-deleted (`deleted_at` null)
   * When omitted, default excludes deleted unless `include_deleted=true` (legacy).
   */
  deleted: Joi.string().valid('true', 'false').optional(),
  /** Filter Active (`true`) or Suspended (`false`). Ignored when `deleted=true`. */
  is_active: Joi.string().valid('true', 'false').optional(),
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
  radius: Joi.number().positive().max(500).default(25), // miles; launch default favors sparse markets
  /** Only coaches rated on this system; required for min/max_skill_rating (systems are never compared). */
  rating_system: Joi.string().valid(...COACH_RATING_SYSTEM_VALUES).optional().messages({
    'any.only': `rating_system must be one of: ${COACH_RATING_SYSTEM_VALUES.join(', ')}`,
  }),
  /** Playing skill lower bound on `rating_system`'s scale. Not review stars. */
  min_skill_rating: coachSkillRatingValueSchema.optional(),
  /** Playing skill upper bound on `rating_system`'s scale. Not review stars. */
  max_skill_rating: coachSkillRatingValueSchema.optional(),
  /** Review star average (`rating_average` 0–5); distinct from min/max_skill_rating. */
  min_rating: Joi.number().min(0).max(5).optional(),
  /**
   * Restrict to coaches linked to this court_locations.id (browse-courts → who teaches here).
   * Combines with geo/skill/rating filters. Soft-deleted courts are not matched.
   */
  court_location_id: Joi.number().integer().positive().optional(),
}).custom((value, helpers) => {
  const hasSkillBound = value.min_skill_rating != null || value.max_skill_rating != null;
  if (hasSkillBound && !value.rating_system) {
    return helpers.error('skill.filter', {
      message: 'rating_system (DUPR or UTR-P) is required when filtering by skill rating',
    });
  }
  for (const key of ['min_skill_rating', 'max_skill_rating']) {
    if (value[key] == null) continue;
    const bad = validateSkillRatingForSystem(value.rating_system, value[key]);
    if (bad) return helpers.error('skill.filter', { message: `${key}: ${bad}` });
  }
  if (
    value.min_skill_rating != null
    && value.max_skill_rating != null
    && value.min_skill_rating > value.max_skill_rating
  ) {
    return helpers.error('skill.filter', {
      message: 'min_skill_rating cannot be greater than max_skill_rating',
    });
  }
  return value;
}).messages({ 'skill.filter': '{{#message}}' });

/** GET /api/geo/search — ZIP / city / address → lat/lng for Discover. */
export const geocodeSearchQuerySchema = Joi.object({
  q: Joi.string().trim().min(2).max(200).required(),
  limit: Joi.number().integer().min(1).max(10).default(5),
});

/** GET /api/geo/places — coach "Based in" autocomplete. */
export const placeSuggestQuerySchema = Joi.object({
  q: Joi.string().trim().min(2).max(200).required(),
  limit: Joi.number().integer().min(1).max(10).default(6),
});

export const getLessonsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  coach_id: Joi.number().integer().positive().optional(),
  min_price: Joi.number().min(0).optional(),
  max_price: Joi.number().min(0).optional(),
});

/** GET /api/coaches/:id/lessons — marketplace offerings for one coach. */
export const getCoachLessonsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
});

/** GET /api/admin/lessons — admin inventory (no marketplace gate). Soft-deleted excluded by default. */
export const getAdminLessonsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  coach_id: Joi.number().integer().positive().optional(),
  /** Filter by publish flag. Query string: `true` | `false`. */
  is_active: Joi.string().valid('true', 'false').optional(),
  /**
   * Default omits soft-deleted. Pass `true` to include rows with `deleted_at` set.
   */
  include_deleted: Joi.string().valid('true', 'false').optional(),
  /** `true` = soft-deleted only; `false` = non-deleted only. */
  deleted: Joi.string().valid('true', 'false').optional(),
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
});

/** GET /api/admin/reviews — full inventory. */
export const getAdminReviewsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  coach_id: Joi.number().integer().positive().optional(),
  student_id: Joi.number().integer().positive().optional(),
});

export const getDisputesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string().valid('open', 'under_review', 'resolved').optional(),
  booking_id: Joi.number().integer().positive().optional(),
  /** Admin only: disputes for bookings where this user is coach or primary student. */
  user_id: Joi.number().integer().positive().optional(),
});

export const getNotificationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  status: Joi.string().valid('pending', 'sent', 'failed').optional(),
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
    .valid('pending', 'held', 'released', 'refunded', 'disputed', 'manual_payout_required', 'pending_release')
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

export const getAuditLogsQuerySchema = Joi.object({
  ...paginationQuery,
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(10000).default(10000), // plain request = all logs
  user_id: Joi.number().integer().positive().optional(),
  action: Joi.string().max(255).trim().allow('').optional(),
  table_name: Joi.string().max(255).trim().allow('').optional(),
  record_id: Joi.number().integer().min(0).optional(),
});

/** GET /api/courts — public directory only (`is_private: false`). List-all: omit lat/lng; omit page & limit to return all (server-capped). Pass page and/or limit to paginate. Geo: lat+lng together; optional radius. Text: optional `q` filters name/address/city/ZIP. */
export const searchCourtsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(10000).optional(),
  lat: Joi.number().min(-90).max(90).optional(),
  lng: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().positive().max(100).default(10), // miles (geo search only)
  /** Free-text filter over public courts (name, street, city, ZIP). */
  q: Joi.string().trim().min(1).max(200).optional(),
}).and('lat', 'lng');

/** US MVP: exactly two letters (uppercase after convert). */
const usStateSchema = Joi.string()
  .trim()
  .uppercase()
  .length(2)
  .pattern(/^[A-Z]{2}$/)
  .required()
  .messages({
    'string.length': 'state must be a 2-letter US state code',
    'string.pattern.base': 'state must be a 2-letter US state code',
    'any.required': 'state is required',
    'string.empty': 'state is required',
  });

/** US ZIP: 12345 or 12345-6789 */
const usPostalCodeSchema = Joi.string()
  .trim()
  .pattern(/^\d{5}(-\d{4})?$/)
  .required()
  .messages({
    'string.pattern.base': 'postal_code must be 12345 or 12345-6789',
    'any.required': 'postal_code is required',
    'string.empty': 'postal_code is required',
  });

/**
 * POST /api/courts — structured address (no free-text `address`).
 * country optional (defaults US); state/postal_code US-MVP rules.
 * Coaches should send geocoded lat/lng. `acknowledge_possible_duplicates` continues create after a "possible" warning.
 */
export const createCourtBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required()
    .messages({ 'string.empty': 'Court name is required', 'any.required': 'Court name is required' }),
  address_line1: Joi.string().trim().min(1).max(255).required()
    .messages({ 'string.empty': 'address_line1 is required', 'any.required': 'address_line1 is required' }),
  city: Joi.string().trim().min(1).max(100).required()
    .messages({ 'string.empty': 'city is required', 'any.required': 'city is required' }),
  state: usStateSchema,
  postal_code: usPostalCodeSchema,
  country: Joi.string().trim().uppercase().length(2).pattern(/^[A-Z]{2}$/).default('US')
    .messages({
      'string.length': 'country must be a 2-letter ISO country code',
      'string.pattern.base': 'country must be a 2-letter ISO country code',
    }),
  latitude: Joi.number().min(-90).max(90).optional().allow(null),
  longitude: Joi.number().min(-180).max(180).optional().allow(null),
  is_private: Joi.boolean().default(false),
  /** When true, skip "possible" duplicate soft-block (high-confidence still blocked). */
  acknowledge_possible_duplicates: Joi.boolean().default(false),
});

/**
 * POST /api/courts/duplicate-check — proximity + fuzzy candidates before create.
 * Requires geocoded lat/lng. Does not create a court.
 */
export const courtDuplicateCheckBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  address_line1: Joi.string().trim().min(1).max(255).required(),
  city: Joi.string().trim().min(1).max(100).required(),
  state: usStateSchema,
  postal_code: usPostalCodeSchema,
  country: Joi.string().trim().uppercase().length(2).pattern(/^[A-Z]{2}$/).default('US'),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});
