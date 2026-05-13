/**
 * Joi renders `any.custom` with a template that leaves the sentence incomplete unless
 * `context.message` is wired into `.messages()`. We pass custom copy via `helpers.error('any.custom', { message })`.
 * @param {import('joi').ValidationErrorItem} detail
 */
export function joiDetailMessage(detail) {
  if (
    detail.type === 'any.custom'
    && typeof detail.context?.message === 'string'
    && detail.context.message.trim() !== ''
  ) {
    return detail.context.message;
  }
  return detail.message;
}

/**
 * Validate request body and set req.validated
 */
export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: joiDetailMessage(detail),
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
        requestId: req.id,
      });
    }

    req.validated = value;
    next();
  };
};

/**
 * Validate query parameters and set req.validated
 * Use for GET endpoints to prevent invalid pagination, filters, and DoS
 */
export const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      convert: true, // Coerce types (e.g. "10" -> 10)
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: joiDetailMessage(detail),
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
        requestId: req.id,
      });
    }

    req.validated = value;
    next();
  };
};
