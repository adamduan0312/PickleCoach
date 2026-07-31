/**
 * POST /api/courts structured-address validation (Joi) + legacy field rejection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCourtBodySchema } from '../config/validation.js';
import { courtCreatePayloadRejectsCoachCourtFields } from '../utils/validateCourtCreatePayload.js';

function validate(body) {
  return createCourtBodySchema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });
}

describe('createCourtBodySchema', () => {
  it('creates court with structured address (valid payload)', () => {
    const { error, value } = validate({
      name: 'Central Park',
      address_line1: '123 Main St',
      city: 'New York',
      state: 'ny',
      postal_code: '10001',
      latitude: 40.7128,
      longitude: -74.006,
      is_private: false,
    });
    assert.equal(error, undefined);
    assert.equal(value.state, 'NY');
    assert.equal(value.country, 'US');
    assert.equal(value.address_line1, '123 Main St');
  });

  it('rejects missing city', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '1 Main',
      state: 'NY',
      postal_code: '10001',
    });
    assert.ok(error);
    assert.ok(error.details.some((d) => d.path.includes('city')));
  });

  it('rejects missing state', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '1 Main',
      city: 'New York',
      postal_code: '10001',
    });
    assert.ok(error);
    assert.ok(error.details.some((d) => d.path.includes('state')));
  });

  it('rejects missing postal code', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '1 Main',
      city: 'New York',
      state: 'NY',
    });
    assert.ok(error);
    assert.ok(error.details.some((d) => d.path.includes('postal_code')));
  });

  it('rejects invalid ZIP', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '1 Main',
      city: 'New York',
      state: 'NY',
      postal_code: 'ABCDE',
    });
    assert.ok(error);
    assert.ok(error.details.some((d) => d.path.includes('postal_code')));
  });

  it('rejects invalid state', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '1 Main',
      city: 'New York',
      state: 'New York',
      postal_code: '10001',
    });
    assert.ok(error);
    assert.ok(error.details.some((d) => d.path.includes('state')));
  });

  it('accepts ZIP+4', () => {
    const { error, value } = validate({
      name: 'A',
      address_line1: '1 Main',
      city: 'New York',
      state: 'NY',
      postal_code: '10001-1234',
    });
    assert.equal(error, undefined);
    assert.equal(value.postal_code, '10001-1234');
  });

  it('rejects empty strings', () => {
    const { error } = validate({
      name: 'A',
      address_line1: '   ',
      city: 'New York',
      state: 'NY',
      postal_code: '10001',
    });
    assert.ok(error);
  });
});

describe('legacy free-text address rejection', () => {
  it('rejects address key on court create', () => {
    const r = courtCreatePayloadRejectsCoachCourtFields({
      name: 'A',
      address: '123 Main St',
    });
    assert.equal(r.rejected, true);
    assert.match(r.message, /structured address/i);
  });
});
