import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GROUP_MAX_PLAYERS_MAX,
  GROUP_MAX_PLAYERS_MIN,
  LESSON_PRICE_MAX_USD,
  bookingLessonOffering,
  bookingLessonTypeLabel,
  durationOptionsFor,
  emptyLessonForm,
  lessonApiFieldErrors,
  lessonFormToPayload,
  lessonToForm,
  lessonTypeLabel,
  sanitizePriceInput,
  validateLessonForm,
} from '../src/domain/lessonOffering.js';
import { CHAR_LIMITS } from '../src/utils/charLimits.js';
import * as backend from '../../backend/utils/lessonOffering.js';

const validForm = (overrides = {}) => ({ ...emptyLessonForm(), title: 'Dinking fundamentals', ...overrides });

test('frontend limits match backend lesson rules', () => {
  assert.equal(GROUP_MAX_PLAYERS_MIN, backend.GROUP_MAX_PLAYERS_MIN);
  assert.equal(GROUP_MAX_PLAYERS_MAX, backend.GROUP_MAX_PLAYERS_MAX);
  assert.equal(CHAR_LIMITS.lessonTitle, backend.LESSON_TITLE_MAX);
  assert.equal(CHAR_LIMITS.lessonDescription, backend.LESSON_DESCRIPTION_MAX);
  assert.equal(LESSON_PRICE_MAX_USD, backend.LESSON_PRICE_MAX_USD);
});

test('booking label uses the snapshot, not the edited lesson', () => {
  const booking = {
    lesson_type_at_booking: 'group',
    max_players_at_booking: 6,
    lesson: { lesson_type: 'private', max_players: null },
  };
  assert.equal(bookingLessonTypeLabel(booking), 'Group lesson · Up to 6 players');
  assert.equal(
    bookingLessonTypeLabel({ lesson_type_at_booking: 'private', max_players_at_booking: null, lesson: { lesson_type: 'group', max_players: 4 } }),
    'Private lesson',
  );
});

test('legacy booking without snapshot falls back to the lesson current values', () => {
  const legacy = { lesson_type_at_booking: null, max_players_at_booking: null, lesson: { lesson_type: 'group', max_players: 4 } };
  assert.deepEqual(bookingLessonOffering(legacy), { lesson_type: 'group', max_players: 4 });
  assert.equal(bookingLessonTypeLabel(legacy), 'Group lesson · Up to 4 players');
  assert.equal(bookingLessonTypeLabel({ lesson: { lesson_type: 'private', max_players: null } }), 'Private lesson');
  assert.equal(bookingLessonTypeLabel({}), 'Private lesson');
});

test('booking detail renders the snapshot-aware label', () => {
  const src = readFileSync(new URL('../src/pages/bookings/BookingDetailPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /bookingLessonTypeLabel\(booking\)/);
  assert.doesNotMatch(src, /lessonTypeLabel\(booking\.lesson\)/);
});

test('lessonTypeLabel', () => {
  assert.equal(lessonTypeLabel({ lesson_type: 'private', max_players: null }), 'Private lesson');
  assert.equal(lessonTypeLabel({}), 'Private lesson');
  assert.equal(lessonTypeLabel({ lesson_type: 'group', max_players: 6 }), 'Group lesson · Up to 6 players');
  assert.equal(lessonTypeLabel({ lesson_type: 'group', max_players: null }), 'Group lesson');
});

test('private payload always sends max_players null; group sends a number', () => {
  const priv = lessonFormToPayload(validForm({ lesson_type: 'private', max_players: '6' }));
  assert.equal(priv.lesson_type, 'private');
  assert.equal(priv.max_players, null);
  const group = lessonFormToPayload(validForm({ lesson_type: 'group', max_players: '4' }));
  assert.equal(group.lesson_type, 'group');
  assert.equal(group.max_players, 4);
  assert.equal('player_ids' in group, false);
  assert.equal('max_students' in group, false);
});

test('group requires max players within range', () => {
  assert.ok(validateLessonForm(validForm({ lesson_type: 'group', max_players: '' })).max_players);
  assert.ok(validateLessonForm(validForm({ lesson_type: 'group', max_players: '1' })).max_players);
  assert.ok(validateLessonForm(validForm({ lesson_type: 'group', max_players: '13' })).max_players);
  assert.deepEqual(validateLessonForm(validForm({ lesson_type: 'group', max_players: '12' })), {});
  assert.deepEqual(validateLessonForm(validForm({ lesson_type: 'private', max_players: '' })), {});
});

test('description is optional, trimmed, and capped', () => {
  assert.deepEqual(validateLessonForm(validForm({ description: '' })), {});
  assert.equal(lessonFormToPayload(validForm({ description: '   ' })).description, '');
  assert.ok(validateLessonForm(validForm({ description: 'x'.repeat(1001) })).description);
});

test('title is trimmed and must be 3+ characters', () => {
  assert.ok(validateLessonForm(validForm({ title: '    ' })).title);
  assert.ok(validateLessonForm(validForm({ title: ' ab ' })).title);
  assert.equal(lessonFormToPayload(validForm({ title: '  Drills  ' })).title, 'Drills');
});

test('price: min, max, two decimals', () => {
  assert.ok(validateLessonForm(validForm({ price: '0.49' })).price);
  assert.ok(validateLessonForm(validForm({ price: '1000.01' })).price);
  assert.ok(validateLessonForm(validForm({ price: '' })).price);
  assert.deepEqual(validateLessonForm(validForm({ price: '0.50' })), {});
  assert.equal(sanitizePriceInput('45.678'), '45.67');
  assert.equal(sanitizePriceInput('$4a5.1.2'), '45.12');
  assert.equal(sanitizePriceInput('60'), '60');
});

test('duration options include standard values and keep a non-standard current value', () => {
  assert.deepEqual(durationOptionsFor('60'), [30, 45, 60, 90, 120]);
  assert.deepEqual(durationOptionsFor(75), [30, 45, 60, 75, 90, 120]);
  assert.ok(validateLessonForm(validForm({ duration_minutes: '10' })).duration_minutes);
});

test('lessonToForm maps existing lessons', () => {
  const f = lessonToForm({ title: 'Clinic', lesson_type: 'group', max_players: 8, description: null, duration_minutes: 90, price: '40.00' });
  assert.equal(f.lesson_type, 'group');
  assert.equal(f.max_players, '8');
  assert.equal(f.description, '');
  assert.equal(f.price, '40');
  const p = lessonToForm({ title: 'Private', duration_minutes: 60, price: 50 });
  assert.equal(p.lesson_type, 'private');
  assert.equal(p.max_players, '');
});

test('API validation details map to fields with general fallback', () => {
  const { fields, general } = lessonApiFieldErrors({
    details: [
      { field: 'max_players', message: 'Too many' },
      { field: 'title', message: 'Enter a lesson title.' },
      { field: 'coach_id', message: 'Weird' },
    ],
  });
  assert.equal(fields.max_players, 'Too many');
  assert.equal(fields.title, 'Enter a lesson title.');
  assert.equal(general, 'Weird');
  assert.deepEqual(lessonApiFieldErrors(new Error('boom')), { fields: {}, general: null });
});

test('coach lessons: edit replaces the row in place; new lesson form stays on top', () => {
  const src = readFileSync(new URL('../src/pages/coach/CoachLessonsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /\{isNew \? lessonForm : null\}/);
  assert.match(src, /editing === l\.id \? \(\s*<div key=\{l\.id\}>\{lessonForm\}<\/div>/);
  assert.equal((src.match(/<form/g) || []).length, 1, 'single form definition');
});

test('coach lessons: blocked New/Edit stay clickable and explain why', () => {
  const src = readFileSync(new URL('../src/pages/coach/CoachLessonsPage.jsx', import.meta.url), 'utf8');
  assert.equal((src.match(/aria-disabled=\{editing \? 'true' : undefined\}/g) || []).length, 2);
  assert.doesNotMatch(src, /disabled=\{Boolean\(editing\)\}/, 'native disabled swallows clicks');
  assert.match(src, /onClick=\{\(\) => \(editing \? showBlockedNotice\(\) : startEdit\(null\)\)\}/);
  assert.match(src, /onClick=\{\(\) => \(editing \? showBlockedNotice\(\) : startEdit\(l\)\)\}/);
  assert.match(src, /'Please save or cancel the current lesson form before continuing\.'/);
  assert.match(src, /title=\{editing \? NEW_BLOCKED_HINT : undefined\}/);
  assert.match(src, /title=\{editing \? EDIT_BLOCKED_HINT : undefined\}/);
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.btn\[aria-disabled='true'\] \{ opacity: 0\.55; cursor: not-allowed; \}/);
});

test('coach lessons: unsaved changes are protected across navigation', () => {
  const src = readFileSync(new URL('../src/pages/coach/CoachLessonsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /useUnsavedChangesGuard\(isDirty\);/);
  assert.match(src, /\}, \[location\.key\]\);/);
  const guard = readFileSync(new URL('../src/hooks/useUnsavedChangesGuard.js', import.meta.url), 'utf8');
  assert.match(guard, /export const UNSAVED_CHANGES_PROMPT = 'You have unsaved changes\. Leave this page\?';/);
  assert.match(guard, /useBlocker\(\(\) => dirtyRef\.current && !bypassRef\.current\)/);
  assert.match(guard, /if \(window\.confirm\(UNSAVED_CHANGES_PROMPT\)\) blocker\.proceed\(\);\s*else blocker\.reset\(\);/);
  assert.match(guard, /addEventListener\('beforeunload'/);
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /createBrowserRouter\(/);
  assert.match(app, /<RouterProvider router=\{router\} \/>/);
  assert.doesNotMatch(app, /import \{[^}]*\bBrowserRouter\b/);
});

test('coach lesson form: title/description guidance and placeholders (shared by create and edit)', () => {
  const src = readFileSync(new URL('../src/pages/coach/CoachLessonsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /<strong>Tip:<\/strong> Use a clear, specific name that tells students what the lesson focuses on\./);
  assert.match(src, /<strong>Tip:<\/strong> Explain what students will learn, who the lesson is for, and what they can expect\./);
  assert.match(src, /label="Title" name="title" required error=\{fieldErrors\.title\} hint=\{TITLE_TIP\}/);
  assert.match(src, /label="Description" name="description" error=\{fieldErrors\.description\} hint=\{DESCRIPTION_TIP\}/);
  assert.match(src, /placeholder="e\.g\. Beginner Pickleball Lesson"/);
  assert.match(src, /placeholder="e\.g\. Learn the basics of serving, returning, positioning, and scoring\."/);
  // One form element renders for both "Create lesson" and "Edit lesson".
  assert.equal((src.match(/<form/g) || []).length, 1);
  assert.match(src, /\{isNew \? 'Create lesson' : 'Edit lesson'\}/);
  // Group explanation appears once (on the Group option), not repeated elsewhere.
  assert.equal((src.match(/\{GROUP_LESSON_NOTE\}/g) || []).length, 1);
  const priceBlock = src.slice(src.indexOf('label="Price (USD)"'), src.indexOf('</FormField>', src.indexOf('label="Price (USD)"')));
  assert.doesNotMatch(priceBlock, /Tip:|placeholder/);
  const durationBlock = src.slice(src.indexOf('label="Duration"'), src.indexOf('</FormField>', src.indexOf('label="Duration"')));
  assert.doesNotMatch(durationBlock, /Tip:|hint=/);
});

test('coach lesson form: field order and no multi-student booking fields', () => {
  const src = readFileSync(new URL('../src/pages/coach/CoachLessonsPage.jsx', import.meta.url), 'utf8');
  const order = ['name="title"', 'name="lesson_type"', 'name="max_players"', 'name="description"', 'name="duration_minutes"', 'name="price"']
    .map((needle) => src.indexOf(needle));
  order.forEach((idx) => assert.ok(idx > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(/player_ids|max_students/.test(src), false);
  assert.match(src, /\{isGroup \? \(/);
});
