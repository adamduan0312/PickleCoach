import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPrimaryNavLinks } from '../src/domain/navAttention.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('Favorites is in the student menu only when the account has the student role', () => {
  const student = buildPrimaryNavLinks({ mode: 'student', student: true, coach: false, admin: false });
  const dualStudent = buildPrimaryNavLinks({ mode: 'student', student: true, coach: true, admin: false });
  const coachMode = buildPrimaryNavLinks({ mode: 'coach', student: true, coach: true, admin: false });
  const coachOnly = buildPrimaryNavLinks({ mode: 'coach', student: false, coach: true, admin: false });
  const admin = buildPrimaryNavLinks({ mode: 'admin', student: false, coach: false, admin: true });
  const noRole = buildPrimaryNavLinks({ mode: 'student', student: false, coach: false, admin: false });
  for (const links of [student, dualStudent]) {
    assert.ok(links.some((l) => l.to === '/favorites' && l.label === 'Favorites'));
  }
  for (const links of [coachMode, coachOnly, admin, noRole]) {
    assert.equal(links.some((l) => l.to === '/favorites'), false);
  }
});

test('the favorites route requires the student role and student mode', () => {
  const app = src('App.jsx');
  assert.match(app, /path="\/favorites"[\s\S]*<RequireRole roles=\{\['student'\]\}>[\s\S]*<RequireStudentMode>[\s\S]*<FavoritesPage \/>/);
});

test('the heart does not follow the profile link, and a failed save puts the heart back', () => {
  const button = src('components/student/FavoriteHeartButton.jsx');
  assert.match(button, /type="button"/);
  assert.match(button, /e\.preventDefault\(\)/);
  assert.match(button, /e\.stopPropagation\(\)/);
  assert.match(button, /const label = saved \? FAVORITE_REMOVE_LABEL : FAVORITE_ADD_LABEL;/);
  assert.match(button, /aria-label=\{label\}/);
  assert.doesNotMatch(button, /aria-pressed/, 'the label already carries the state');
  const hook = src('hooks/useFavoriteCoaches.js');
  assert.match(hook, /studentsApi\.addFavoriteCoach/);
  assert.match(hook, /studentsApi\.removeFavoriteCoach/);
  assert.match(hook, /if \(wasSaved\) next\.add\(id\);\s*else next\.delete\(id\);/);
});

test('Discover and the public profile share the heart and hide it on your own listing', () => {
  const discover = src('pages/student/DiscoverPage.jsx');
  assert.match(discover, /canFavorite && favorites\.ready && String\(coach\.id\) !== String\(user\?\.id\)/);
  assert.match(discover, /<CoachMarketplaceCard/);
  const profile = src('pages/student/CoachPublicProfilePage.jsx');
  assert.match(profile, /hasStudentRole\(user\?\.roles\) && !isOwnProfile/);
  assert.match(profile, /<FavoriteHeartButton/);
  const card = src('components/student/CoachMarketplaceCard.jsx');
  assert.match(card, /<FavoriteHeartButton saved=\{favorite\.saved\}/);
  assert.match(card, /to=\{`\/coaches\/\$\{coach\.id\}`\}/);
});

test('the Favorites page lists saved coaches, removes one in place, and has an empty state back to Discover', () => {
  const page = src('pages/student/FavoritesPage.jsx');
  assert.match(page, /studentsApi\.favoriteCoaches\(\)/);
  assert.match(page, /studentsApi\.removeFavoriteCoach/);
  assert.match(page, /No favorite coaches yet/);
  assert.match(page, /to="\/discover">Find a coach/);
  assert.match(page, /unavailable=\{coach\.available === false\}/);
  assert.match(page, /toState=\{\{ backTo: '\/favorites' \}\}/);
  assert.match(page, /<ErrorState error=\{error\} onRetry=\{load\} \/>/);
});

test('heart tooltip: wording, hover-only with a delay, never blocks clicks; Favorites always offers removal', () => {
  const button = src('components/student/FavoriteHeartButton.jsx');
  assert.match(button, /FAVORITE_ADD_LABEL = 'Add to favorites'/);
  assert.match(button, /FAVORITE_REMOVE_LABEL = 'Remove from favorites'/);
  assert.match(button, /<span className="favorite-heart-tip" aria-hidden="true">\{label\}<\/span>/);
  const css = src('index.css');
  assert.match(css, /\.favorite-heart-tip \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.favorite-heart:hover \.favorite-heart-tip/);
  assert.match(css, /transition: opacity 0\.12s ease 0\.4s/);
  assert.match(src('pages/student/FavoritesPage.jsx'), /saved: true,/);
});
