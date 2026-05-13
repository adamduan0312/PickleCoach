import assert from 'node:assert/strict';
import { test } from 'node:test';
import Joi from 'joi';
import { resolveDisputeSchema } from '../config/validation.js';
import { joiDetailMessage } from '../middleware/validator.js';

test('joiDetailMessage surfaces context.message for any.custom', () => {
  const schema = Joi.object({ x: Joi.number() }).custom((v, h) =>
    h.error('any.custom', { message: 'explicit custom text' }),
  );
  const { error } = schema.validate({ x: 1 });
  assert.ok(error);
  assert.equal(joiDetailMessage(error.details[0]), 'explicit custom text');
});

test('resolveDisputeSchema rejected+outcome aligned with claim fails alignment', () => {
  const { error } = resolveDisputeSchema.validate(
    {
      dispute_type_code: 'coach_no_show_claim',
      decision: 'rejected',
      outcome: 'coach_no_show',
      financial_action: 'no_change',
    },
    { stripUnknown: true },
  );
  assert.ok(error);
  assert.match(
    joiDetailMessage(error.details[0]),
    /outcome must be student_no_show/,
  );
});
