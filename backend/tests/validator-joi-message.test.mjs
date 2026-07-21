import assert from 'node:assert/strict';
import { test } from 'node:test';
import Joi from 'joi';
import { resolveDisputeSchema, mvpPasswordSchema, updateUserSchema } from '../config/validation.js';
import { joiDetailMessage } from '../middleware/validator.js';

test('joiDetailMessage surfaces context.message for any.custom', () => {
  const schema = Joi.object({ x: Joi.number() }).custom((v, h) =>
    h.error('any.custom', { message: 'explicit custom text' }),
  );
  const { error } = schema.validate({ x: 1 });
  assert.ok(error);
  assert.equal(joiDetailMessage(error.details[0]), 'explicit custom text');
});

test('mvpPasswordSchema rejects short and missing character classes', () => {
  const { error: tooShort } = mvpPasswordSchema.validate('Short1Aa');
  assert.ok(tooShort);
  assert.match(joiDetailMessage(tooShort.details[0]), /10|at least 10/i);

  const { error: noDigit } = mvpPasswordSchema.validate('NoDigitsHere!');
  assert.ok(noDigit);
  assert.match(joiDetailMessage(noDigit.details[0]), /number|digit/i);

  const { error: ok } = mvpPasswordSchema.validate('Validpass12');
  assert.equal(ok, undefined);
});

test('updateUserSchema: roles optional; unique 1–3; allows admin+student and triple', () => {
  const { error: empty } = updateUserSchema.validate({ roles: [] }, { stripUnknown: true });
  assert.ok(empty);

  const { error: dup } = updateUserSchema.validate(
    { roles: ['student', 'student'] },
    { stripUnknown: true },
  );
  assert.ok(dup);

  const { error: bad } = updateUserSchema.validate({ roles: ['student', 'teacher'] }, { stripUnknown: true });
  assert.ok(bad);

  const { error: legacy } = updateUserSchema.validate({ role: 'coach' }, { stripUnknown: true });
  assert.ok(legacy);

  const { error: okNone, value: v1 } = updateUserSchema.validate({}, { stripUnknown: true });
  assert.equal(okNone, undefined);
  assert.equal(v1.roles, undefined);

  const { error: okDual, value: v2 } = updateUserSchema.validate(
    { roles: ['student', 'coach'] },
    { stripUnknown: true },
  );
  assert.equal(okDual, undefined);
  assert.deepEqual(v2.roles, ['student', 'coach']);

  const { error: adminStudent, value: vAdminStudent } = updateUserSchema.validate(
    { roles: ['admin', 'student'] },
    { stripUnknown: true },
  );
  assert.equal(adminStudent, undefined);
  assert.deepEqual(vAdminStudent.roles, ['admin', 'student']);

  const { error: triple, value: vTriple } = updateUserSchema.validate(
    { roles: ['admin', 'coach', 'student'] },
    { stripUnknown: true },
  );
  assert.equal(triple, undefined);
  assert.deepEqual(vTriple.roles.sort(), ['admin', 'coach', 'student'].sort());

  const { error: adminCoach, value: v3 } = updateUserSchema.validate(
    { roles: ['admin', 'coach'] },
    { stripUnknown: true },
  );
  assert.equal(adminCoach, undefined);
  assert.deepEqual(v3.roles, ['admin', 'coach']);

  const { error: unlockWithRoles } = updateUserSchema.validate(
    { roles: ['student'], role_governance_locked: false },
    { stripUnknown: true },
  );
  assert.ok(unlockWithRoles);
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

test('createBookingIntentSchema requires court; forbids duration and player_ids', async () => {
  const { createBookingIntentSchema } = await import('../config/validation.js');
  const future = new Date(Date.now() + 864e5).toISOString();

  const ok = createBookingIntentSchema.validate(
    { lesson_id: 14, scheduled_at: future, court_location_id: 58 },
    { abortEarly: false, stripUnknown: true },
  );
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.payment_method, 'stripe');
  assert.equal(ok.value.duration_minutes, undefined);

  const noCourt = createBookingIntentSchema.validate(
    { lesson_id: 14, scheduled_at: future },
    { abortEarly: false },
  );
  assert.ok(noCourt.error);
  assert.match(joiDetailMessage(noCourt.error.details[0]), /court_location_id/i);

  const withDuration = createBookingIntentSchema.validate(
    { lesson_id: 14, scheduled_at: future, court_location_id: 58, duration_minutes: 90 },
    { abortEarly: false },
  );
  assert.ok(withDuration.error);
  assert.match(joiDetailMessage(withDuration.error.details[0]), /duration_minutes/i);

  const withPlayers = createBookingIntentSchema.validate(
    { lesson_id: 14, scheduled_at: future, court_location_id: 58, player_ids: [1] },
    { abortEarly: false },
  );
  assert.ok(withPlayers.error);
  assert.match(joiDetailMessage(withPlayers.error.details[0]), /player_ids/i);
});
