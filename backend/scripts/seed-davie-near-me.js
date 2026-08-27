/**
 * Seed marketplace-ready coaches + courts near 3001 W Abiaca Cir, Davie, FL
 * (geocoded ≈ 26.0857, -80.2807) for local Discover / booking QA.
 *
 * Idempotent — safe to re-run. Passwords: Test1234!Ab
 *
 * From backend/:
 *   npm run seed:davie-near-me
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import {
  sequelize,
  User,
  UserRole,
  CoachProfile,
  CourtLocation,
  CoachCourtLocation,
  Lesson,
  CoachAvailability,
} from '../models/index.js';
import { getCoachMarketplaceEligibility } from '../services/coachMarketplaceEligibility.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const PASSWORD = 'Test1234!Ab';
const DOMAIN = 'picklecoach.example.org';

/** Search origin for QA: 3001 West Abiaca Circle, Davie, FL 33328 */
export const ABIACA_ORIGIN = {
  label: '3001 West Abiaca Circle, Davie, Florida, 33328',
  lat: 26.0856529,
  lng: -80.2807362,
};

/**
 * Courts / coaches at increasing distance from Abiaca Cir for radius tests.
 * Distances are approximate straight-line miles.
 */
const COACHES = [
  {
    emailLocal: 'coach.davie.abiaca',
    fullName: 'Ava Abiaca',
    headline: '~0.3 mi — walks from Abiaca Cir',
    bio: 'Neighborhood coach for Discover “near me” booking tests (Davie / Abiaca).',
    skill_rating: 3.5,
    rating_system: 'self',
    rating_average: 4.7,
    rating_count: 9,
    experience_years: 4,
    location: 'Davie, FL',
    approxMiles: 0.3,
    court: {
      name: 'Near-Me Fixture — Tree Tops Park Courts',
      address_line1: '3900 SW 100th Ave',
      city: 'Davie',
      state: 'FL',
      postal_code: '33328',
      latitude: 26.0825,
      longitude: -80.2755,
    },
    lessonPrice: 50,
  },
  {
    emailLocal: 'coach.davie.pineisland',
    fullName: 'Pete Pine',
    headline: '~1 mi — Pine Island Rd corridor',
    bio: 'Davie coach along Pine Island for short-radius booking QA.',
    skill_rating: 4.0,
    rating_system: 'DUPR',
    rating_average: 4.5,
    rating_count: 14,
    experience_years: 6,
    location: 'Davie, FL',
    approxMiles: 1.0,
    court: {
      name: 'Near-Me Fixture — Pine Island Park Courts',
      address_line1: '3801 S Pine Island Rd',
      city: 'Davie',
      state: 'FL',
      postal_code: '33328',
      latitude: 26.0760,
      longitude: -80.2700,
    },
    lessonPrice: 55,
  },
  {
    emailLocal: 'coach.davie.cooper',
    fullName: 'Casey Cooper',
    headline: '~3 mi — Cooper City edge',
    bio: 'Just outside Davie for 5–10 mile radius testing.',
    skill_rating: 4.5,
    rating_system: 'UTR-P',
    rating_average: 4.8,
    rating_count: 21,
    experience_years: 9,
    location: 'Cooper City, FL',
    approxMiles: 3.0,
    court: {
      name: 'Near-Me Fixture — Flamingo Gardens Area Courts',
      address_line1: '3750 Flamingo Rd',
      city: 'Davie',
      state: 'FL',
      postal_code: '33330',
      latitude: 26.0600,
      longitude: -80.3100,
    },
    lessonPrice: 65,
  },
  {
    emailLocal: 'coach.davie.sunrise',
    fullName: 'Sam Sunrise',
    headline: '~6 mi — toward Sunrise / Sawgrass',
    bio: 'Appears at radius ≥10 from Abiaca; useful for radius filter QA.',
    skill_rating: 3.0,
    rating_system: 'self',
    rating_average: 4.2,
    rating_count: 7,
    experience_years: 3,
    location: 'Sunrise, FL',
    approxMiles: 6.0,
    court: {
      name: 'Near-Me Fixture — Sunrise Civic Courts',
      address_line1: '10610 W Oakland Park Blvd',
      city: 'Sunrise',
      state: 'FL',
      postal_code: '33351',
      latitude: 26.1650,
      longitude: -80.2800,
    },
    lessonPrice: 45,
  },
  {
    emailLocal: 'coach.davie.ftlaud',
    fullName: 'Frankie Lauderdale',
    headline: '~12 mi — Fort Lauderdale (outside 10 mi)',
    bio: 'Outside a 10-mile Abiaca radius; should appear at 25 mi.',
    skill_rating: 5.0,
    rating_system: 'DUPR',
    rating_average: 4.9,
    rating_count: 40,
    experience_years: 12,
    location: 'Fort Lauderdale, FL',
    approxMiles: 12.0,
    court: {
      name: 'Near-Me Fixture — Holiday Park Courts',
      // Real Google/park address; OSM may label the road "G Martin Harold Drive".
      address_line1: '1150 G. Harold Martin Dr',
      city: 'Fort Lauderdale',
      state: 'FL',
      postal_code: '33304',
      latitude: 26.1330304,
      longitude: -80.1323067,
    },
    lessonPrice: 80,
  },
];

async function ensureCourt(spec, createdByUserId) {
  const existing = await CourtLocation.findOne({
    where: {
      name: spec.name,
      city: spec.city,
      state: spec.state,
      postal_code: spec.postal_code,
      deleted_at: null,
    },
  });
  if (existing) {
    await existing.update({
      address_line1: spec.address_line1,
      latitude: spec.latitude,
      longitude: spec.longitude,
      is_private: false,
    });
    return existing;
  }
  return CourtLocation.create({
    ...spec,
    country: 'US',
    is_private: false,
    source: 'manual',
    created_by_user_id: createdByUserId,
  });
}

async function ensureCoach(spec, passwordHash) {
  const email = `${spec.emailLocal}@${DOMAIN}`;
  let user = await User.findOne({ where: { email } });
  if (!user) {
    user = await User.create({
      full_name: spec.fullName,
      email,
      password_hash: passwordHash,
      phone: null,
      timezone: 'America/New_York',
      is_active: true,
      email_verified_at: new Date(),
    });
    await UserRole.create({ user_id: user.id, role: 'coach' });
  } else {
    await user.update({
      full_name: spec.fullName,
      is_active: true,
      deleted_at: null,
      email_verified_at: user.email_verified_at || new Date(),
    });
    if (!(await UserRole.findOne({ where: { user_id: user.id, role: 'coach' } }))) {
      await UserRole.create({ user_id: user.id, role: 'coach' });
    }
  }

  const seedAcct = `acct_davie_${spec.emailLocal.replace(/\./g, '_')}`;
  const profilePayload = {
    headline: spec.headline,
    bio: spec.bio,
    experience_years: spec.experience_years,
    skill_rating: spec.skill_rating,
    rating_system: spec.rating_system,
    rating_average: spec.rating_average,
    rating_count: spec.rating_count,
    location: spec.location,
    coach_commission_percent: 92.0,
    deleted_at: null,
    stripe_account_id: seedAcct,
    stripe_ready: true,
    stripe_onboarding_completed_at: new Date(),
  };

  let profile = await CoachProfile.findOne({ where: { user_id: user.id } });
  if (!profile) {
    await CoachProfile.create({ user_id: user.id, ...profilePayload });
  } else {
    await profile.update(profilePayload);
  }

  const court = await ensureCourt(spec.court, user.id);
  await CoachCourtLocation.findOrCreate({
    where: { coach_id: user.id, court_id: court.id },
    defaults: { coach_notes: `Near Abiaca Cir (~${spec.approxMiles} mi)` },
  });

  let lesson = await Lesson.findOne({
    where: { coach_id: user.id, title: 'Davie Near-Me Lesson', deleted_at: null },
  });
  if (!lesson) {
    lesson = await Lesson.create({
      coach_id: user.id,
      title: 'Davie Near-Me Lesson',
      description: 'Marketplace lesson for Abiaca Cir / Davie near-me booking tests.',
      price: spec.lessonPrice,
      duration_minutes: 60,
      max_students: 1,
      is_active: true,
    });
  } else {
    await lesson.update({
      is_active: true,
      deleted_at: null,
      price: spec.lessonPrice,
      duration_minutes: 60,
    });
  }

  const availCount = await CoachAvailability.count({ where: { coach_id: user.id } });
  if (availCount === 0) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      await CoachAvailability.create({
        coach_id: user.id,
        weekday,
        start_time: '09:00:00',
        end_time: '17:00:00',
      });
    }
  }

  const eligibility = await getCoachMarketplaceEligibility(user.id);
  return {
    email,
    approxMiles: spec.approxMiles,
    court: spec.court.name,
    eligibility,
  };
}

async function main() {
  await sequelize.authenticate();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const results = [];
  for (const spec of COACHES) {
    results.push(await ensureCoach(spec, passwordHash));
  }

  console.log('\nSearch origin (your address):');
  console.log(`  ${ABIACA_ORIGIN.label}`);
  console.log(`  lat=${ABIACA_ORIGIN.lat} lng=${ABIACA_ORIGIN.lng}`);
  console.log('\nSeeded Davie near-me coaches (password Test1234!Ab):\n');
  for (const r of results) {
    const ok = r.eligibility?.listed
      ? 'marketplace-ready'
      : `NOT ready: ${(r.eligibility?.missing || []).join(', ') || 'unknown'}`;
    console.log(`  ${r.email}`);
    console.log(`    ~${r.approxMiles} mi · ${r.court} · ${ok}`);
  }
  console.log('\nDiscover QA:');
  console.log('  Search location: 3001 W Abiaca Cir  (or Davie, FL / 33328)');
  console.log('  radius 5  → Ava, Pete, Casey');
  console.log('  radius 10 → + Sam Sunrise');
  console.log('  radius 25 → + Frankie Lauderdale\n');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌', err.message);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
