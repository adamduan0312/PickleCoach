import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizePhoneInput, validatePhone } from '../src/domain/phone.js';

describe('validatePhone', () => {
  it('accepts common formats and empty', () => {
    assert.equal(validatePhone(''), null);
    assert.equal(validatePhone('(555) 123-4567'), null);
    assert.equal(validatePhone('+1 555.123.4567'), null);
    assert.equal(validatePhone('+44 20 7946 0958'), null);
  });

  it('rejects letters and wrong digit counts', () => {
    assert.match(validatePhone('fwfwefwewf'), /only contain digits/);
    assert.match(validatePhone('555-12ab'), /only contain digits/);
    assert.match(validatePhone('123'), /7–15 digits/);
    assert.match(validatePhone('1234567890123456'), /7–15 digits/);
  });

  it('allows + only at the start', () => {
    assert.match(validatePhone('555+1234567'), /only contain digits/);
    assert.match(validatePhone('++15551234567'), /only contain digits/);
  });
});

describe('sanitizePhoneInput', () => {
  it('strips letters as the user types', () => {
    assert.equal(sanitizePhoneInput('fw(555) 12a3-4567'), '(555) 123-4567');
  });

  it('keeps a leading + and drops any later +', () => {
    assert.equal(sanitizePhoneInput('+44 20+7946'), '+44 207946');
    assert.equal(sanitizePhoneInput('555+1234567'), '5551234567');
  });
});
