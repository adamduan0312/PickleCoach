import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  COACH_RATING_SYSTEMS,
  COACH_RATING_SYSTEM_VALUES,
  resolveCoachRating,
  validateSkillRatingForSystem,
} from '../utils/coachRating.js';
import {
  createCoachProfileSchema,
  getCoachesQuerySchema,
  updateCoachProfileSchema,
} from '../config/validation.js';
import {
  COACH_CERTIFICATIONS_MAX_COUNT,
  COACH_CERTIFICATION_MAX_LENGTH,
  certificationsForStorage,
  certificationsFromStored,
  normalizeCertificationList,
} from '../utils/coachCertifications.js';

const joi = (schema, value) => schema.validate(value, { abortEarly: false, stripUnknown: true, convert: true });

describe('coach rating rules', () => {
  it('only DUPR and UTR-P exist, with their own scales', () => {
    assert.deepEqual([...COACH_RATING_SYSTEM_VALUES], ['DUPR', 'UTR-P']);
    assert.deepEqual(
      { min: COACH_RATING_SYSTEMS.DUPR.min, max: COACH_RATING_SYSTEMS.DUPR.max, decimals: COACH_RATING_SYSTEMS.DUPR.decimals },
      { min: 2, max: 8, decimals: 3 },
    );
    assert.deepEqual(
      { min: COACH_RATING_SYSTEMS['UTR-P'].min, max: COACH_RATING_SYSTEMS['UTR-P'].max, decimals: COACH_RATING_SYSTEMS['UTR-P'].decimals },
      { min: 1, max: 10, decimals: 1 },
    );
  });

  for (const v of ['2.000', '3.500', '4.217', '7.218', '8.000', 2, 4.217, 8]) {
    it(`DUPR accepts ${JSON.stringify(v)}`, () => {
      assert.equal(validateSkillRatingForSystem('DUPR', v), null);
    });
  }
  for (const v of ['1.999', '8.001', '4.2175', 1.999, 8.001, 4.2175, 'abc', '1e1', '-3']) {
    it(`DUPR rejects ${JSON.stringify(v)}`, () => {
      assert.match(validateSkillRatingForSystem('DUPR', v), /DUPR ratings must be between 2\.000 and 8\.000, with up to 3 decimal places/);
    });
  }
  for (const v of ['1.0', '3.5', '4.5', '9.5', '10.0', 1, 10]) {
    it(`UTR-P accepts ${JSON.stringify(v)}`, () => {
      assert.equal(validateSkillRatingForSystem('UTR-P', v), null);
    });
  }
  for (const v of ['0.9', '10.1', '9.55', 0.9, 10.1, 9.55, 4.217]) {
    it(`UTR-P rejects ${JSON.stringify(v)}`, () => {
      assert.match(validateSkillRatingForSystem('UTR-P', v), /UTR-P ratings must be between 1\.0 and 10\.0, with up to 1 decimal place/);
    });
  }

  it('unknown systems are not rating systems', () => {
    for (const s of ['self', 'UTPR', 'dupr', '', null, undefined]) {
      assert.match(validateSkillRatingForSystem(s, 4), /Select a rating system/);
    }
  });
});

describe('resolveCoachRating (effective pair after merge)', () => {
  const dupr = { rating_system: 'DUPR', skill_rating: '7.218' };
  const utrp = { rating_system: 'UTR-P', skill_rating: '9.500' };

  it('create: both valid', () => {
    assert.deepEqual(resolveCoachRating({ rating_system: 'DUPR', skill_rating: 4.217 }), { ok: true, rating_system: 'DUPR', skill_rating: 4.217 });
  });
  it('create: rating without system is rejected on rating_system', () => {
    const r = resolveCoachRating({ skill_rating: 4.217 });
    assert.equal(r.ok, false);
    assert.equal(r.field, 'rating_system');
  });
  it('create: no rating at all is allowed', () => {
    assert.deepEqual(resolveCoachRating({}), { ok: true, rating_system: null, skill_rating: null });
  });
  it('rating only: DUPR 7.218 → 7.5 is valid', () => {
    assert.deepEqual(resolveCoachRating({ skill_rating: 7.5 }, dupr), { ok: true, rating_system: 'DUPR', skill_rating: 7.5 });
  });
  it('rating only: out of range for the stored system is rejected', () => {
    const r = resolveCoachRating({ skill_rating: 9.5 }, dupr);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'skill_rating');
  });
  it('system only: DUPR 7.218 → UTR-P is rejected (precision)', () => {
    const r = resolveCoachRating({ rating_system: 'UTR-P' }, dupr);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'skill_rating');
    assert.match(r.message, /current rating \(7\.218\) isn't a valid UTR-P rating/);
  });
  it('system only: UTR-P 9.5 → DUPR is rejected (range)', () => {
    const r = resolveCoachRating({ rating_system: 'DUPR' }, utrp);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'skill_rating');
    assert.match(r.message, /current rating \(9\.5\) isn't a valid DUPR rating/);
  });
  it('system only: compatible stored value is kept (UTR-P 4.5 → DUPR)', () => {
    assert.deepEqual(
      resolveCoachRating({ rating_system: 'DUPR' }, { rating_system: 'UTR-P', skill_rating: '4.500' }),
      { ok: true, rating_system: 'DUPR', skill_rating: 4.5 },
    );
  });
  it('both: DUPR 4.217 → UTR-P 4.2 is valid', () => {
    assert.deepEqual(
      resolveCoachRating({ rating_system: 'UTR-P', skill_rating: 4.2 }, { rating_system: 'DUPR', skill_rating: '4.217' }),
      { ok: true, rating_system: 'UTR-P', skill_rating: 4.2 },
    );
  });
  it('stored UTR-P DECIMAL padding ("9.500") is not treated as 3 decimals', () => {
    assert.deepEqual(resolveCoachRating({ headline: 'x' }, utrp), { ok: true, rating_system: 'UTR-P', skill_rating: 9.5 });
  });
  it('remove rating: skill_rating null is allowed and keeps the system', () => {
    assert.deepEqual(resolveCoachRating({ skill_rating: null }, dupr), { ok: true, rating_system: 'DUPR', skill_rating: null });
  });
  it('clearing the system while a rating remains is rejected', () => {
    const r = resolveCoachRating({ rating_system: null }, dupr);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'rating_system');
  });
  it('clearing both is allowed', () => {
    assert.deepEqual(resolveCoachRating({ rating_system: null, skill_rating: null }, dupr), { ok: true, rating_system: null, skill_rating: null });
  });
  it('legacy self row + rating only is rejected (no silent reinterpretation)', () => {
    const r = resolveCoachRating({ skill_rating: 4 }, { rating_system: 'self', skill_rating: null });
    assert.equal(r.ok, false);
    assert.equal(r.field, 'rating_system');
  });
});

describe('coach profile Joi schemas', () => {
  for (const schema of [createCoachProfileSchema, updateCoachProfileSchema]) {
    it('rejects self, UTPR, unknown and empty rating_system', () => {
      for (const s of ['self', 'UTPR', 'NTRP', '']) {
        const { error } = joi(schema, { rating_system: s, skill_rating: 4 });
        assert.ok(error, `expected ${s} to be rejected`);
        assert.ok(error.details.some((d) => d.path[0] === 'rating_system'));
      }
    });
    it('accepts DUPR / UTR-P / null and keeps precision', () => {
      assert.equal(joi(schema, { rating_system: 'DUPR', skill_rating: '4.217' }).value.skill_rating, 4.217);
      assert.equal(joi(schema, { rating_system: 'UTR-P', skill_rating: '9.5' }).value.skill_rating, 9.5);
      assert.equal(joi(schema, { rating_system: null, skill_rating: null }).error, undefined);
    });
    it('does not round 4.2175 (left for system-aware rejection)', () => {
      assert.equal(joi(schema, { rating_system: 'DUPR', skill_rating: '4.2175' }).value.skill_rating, 4.2175);
    });
    it('keeps other field limits: headline/location 255, experience 0–100 integer', () => {
      assert.ok(joi(schema, { headline: 'x'.repeat(256) }).error);
      assert.ok(joi(schema, { location: 'x'.repeat(256) }).error);
      assert.ok(joi(schema, { experience_years: 101 }).error);
      assert.ok(joi(schema, { experience_years: 2.5 }).error);
      assert.ok(joi(schema, { experience_years: -1 }).error);
      assert.equal(joi(schema, { experience_years: 100, headline: 'x'.repeat(255) }).error, undefined);
    });
    it('experience accepts null (not provided) and an explicit 0', () => {
      assert.equal(joi(schema, { experience_years: null }).error, undefined);
      assert.equal(joi(schema, { experience_years: null }).value.experience_years, null);
      assert.equal(joi(schema, { experience_years: 0 }).value.experience_years, 0);
    });
    it('limits bio to 1,000 characters after trimming, with a field message', () => {
      assert.equal(joi(schema, { bio: 'x'.repeat(1000) }).error, undefined);
      assert.equal(joi(schema, { bio: `  ${'x'.repeat(1000)}\n` }).value.bio, 'x'.repeat(1000));
      assert.equal(joi(schema, { bio: '' }).error, undefined);
      const err = joi(schema, { bio: 'x'.repeat(1001) }).error;
      assert.ok(err);
      assert.equal(err.details[0].message, 'Bio must be 1,000 characters or fewer.');
    });
    it('certifications: array of names, 500 characters each, up to 20, null or [] for none', () => {
      assert.deepEqual(
        joi(schema, { certifications: ['  IPTPA Certified ', 'x'.repeat(500)] }).value.certifications,
        ['IPTPA Certified', 'x'.repeat(500)],
      );
      assert.equal(joi(schema, { certifications: [] }).error, undefined);
      assert.equal(joi(schema, { certifications: null }).error, undefined);
      assert.equal(joi(schema, { certifications: ['', 'PPR'] }).error, undefined);
      const long = joi(schema, { certifications: ['PPR', 'x'.repeat(501)] }).error;
      assert.equal(long.details[0].path.join('.'), 'certifications.1');
      assert.equal(long.details[0].message, 'Each certification must be 500 characters or fewer.');
      const many = joi(schema, { certifications: Array.from({ length: 21 }, (_, i) => `C${i}`) }).error;
      assert.equal(many.details[0].message, 'You can list up to 20 certifications.');
      const text = joi(schema, { certifications: 'IPTPA, PPA' }).error;
      assert.equal(text.details[0].message, 'Certifications must be a list of names.');
      assert.equal(joi(schema, { certifications: [42] }).error.details[0].message, 'Each certification must be text.');
    });
  }

  it('certification storage normalizes lists and API output is always an array', () => {
    assert.deepEqual(normalizeCertificationList([' A ', '', 'a', 'B, C', null]), ['A', 'B, C']);
    assert.deepEqual(certificationsForStorage(['IPTPA', ' ']), ['IPTPA']);
    assert.equal(certificationsForStorage(['', '  ']), null);
    assert.equal(certificationsForStorage([]), null);
    assert.equal(certificationsForStorage(null), null);
    assert.deepEqual(certificationsFromStored(['IPTPA', 'PPA']), ['IPTPA', 'PPA']);
    assert.deepEqual(certificationsFromStored(null), []);
    assert.deepEqual(certificationsFromStored('legacy, text'), ['legacy, text']);
    assert.deepEqual(certificationsFromStored(''), []);
    assert.equal(COACH_CERTIFICATION_MAX_LENGTH, 500);
    assert.equal(COACH_CERTIFICATIONS_MAX_COUNT, 20);
    const src = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    assert.equal((src.match(/certificationsForStorage\(certifications\)/g) || []).length, 2);
  });

  it('controller validates the merged pair before any write (create + both update routes)', () => {
    const src = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    assert.match(src, /const rating = resolveCoachRating\(\{ skill_rating, rating_system \}\);\s*if \(!rating\.ok\) return coachProfileValidationError/);
    assert.match(src, /const rating = resolveCoachRating\(validated, profile\);\s*if \(!rating\.ok\) return rating;\s*const basedIn = await resolveCoachLocation\(validated, profile\);\s*if \(!basedIn\.ok\) return basedIn;\s*await profile\.update/);
    assert.equal((src.match(/if \(!result\.ok\) return coachProfileValidationError/g) || []).length, 2);
    assert.doesNotMatch(src, /'self'/);
  });

  it('create stores a blank experience as NULL (not provided), not 0', () => {
    const src = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    assert.match(src, /experience_years: experience_years \?\? null,/);
    assert.doesNotMatch(src, /experience_years \?\? 0/);
  });
});

describe('GET /coaches query schema', () => {
  it('Any system: no rating_system, no skill bounds is fine', () => {
    assert.equal(joi(getCoachesQuerySchema, {}).error, undefined);
  });
  it('skill bounds without rating_system are rejected', () => {
    const { error } = joi(getCoachesQuerySchema, { min_skill_rating: 4 });
    assert.match(error.message, /rating_system \(DUPR or UTR-P\) is required/);
  });
  it('DUPR bounds use the DUPR scale', () => {
    assert.equal(joi(getCoachesQuerySchema, { rating_system: 'DUPR', min_skill_rating: 2, max_skill_rating: 8 }).error, undefined);
    assert.match(joi(getCoachesQuerySchema, { rating_system: 'DUPR', max_skill_rating: 9.5 }).error.message, /max_skill_rating: DUPR ratings/);
  });
  it('UTR-P bounds use the UTR-P scale', () => {
    assert.equal(joi(getCoachesQuerySchema, { rating_system: 'UTR-P', min_skill_rating: 1, max_skill_rating: 10 }).error, undefined);
    assert.match(joi(getCoachesQuerySchema, { rating_system: 'UTR-P', min_skill_rating: 4.25 }).error.message, /min_skill_rating: UTR-P ratings/);
  });
  it('rejects self / unknown systems and min > max', () => {
    assert.ok(joi(getCoachesQuerySchema, { rating_system: 'self' }).error);
    assert.ok(joi(getCoachesQuerySchema, { rating_system: 'UTPR' }).error);
    assert.match(joi(getCoachesQuerySchema, { rating_system: 'DUPR', min_skill_rating: 5, max_skill_rating: 4 }).error.message, /cannot be greater/);
  });
});
