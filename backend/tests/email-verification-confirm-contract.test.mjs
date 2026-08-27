/**
 * Email verification confirm: first click verifies; re-click on same valid token is friendly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../controllers/authController.js'), 'utf8');
const confirmStart = src.indexOf('export const confirmEmailVerification');
const confirmSrc = src.slice(confirmStart, confirmStart + 1200);

describe('confirmEmailVerification contract (source)', () => {
  it('returns Email already verified when email_verified_at is set', () => {
    assert.match(confirmSrc, /if \(user\.email_verified_at\)/);
    assert.match(confirmSrc, /Email already verified/);
  });

  it('does not clear email_verification_token on successful verify', () => {
    assert.doesNotMatch(confirmSrc, /email_verification_token:\s*null/);
    assert.doesNotMatch(confirmSrc, /email_verification_expires:\s*null/);
  });
});
