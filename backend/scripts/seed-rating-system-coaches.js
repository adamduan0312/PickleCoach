/**
 * Seed marketplace-ready coaches with non-self rating systems (DUPR / UTR-P).
 *
 * Idempotent — safe to re-run. Passwords: Test1234!Ab
 *
 * From backend/:
 *   npm run seed:rating-system-coaches
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

/** Near downtown SF so Discover geo search (ZIP 94114 / city SF) finds them. */
const COACHES = [
  {
    emailLocal: 'coach.dupr.marina',
    fullName: 'Dana Dupré',
    headline: 'DUPR-rated competitive coach — Marina',
    bio: 'Tournament-oriented coaching with a verified DUPR rating. Soft game + third-shot focus.',
    skill_rating: 4.5,
    rating_system: 'DUPR',
    rating_average: 4.8,
    rating_count: 22,
    experience_years: 8,
    location: 'San Francisco Marina',
    court: {
      name: 'Rating Fixture — Marina Green Courts',
      address_line1: 'Marina Blvd & Scott St',
      city: 'San Francisco',
      state: 'CA',
      postal_code: '94123',
      latitude: 37.8060,
      longitude: -122.4380,
    },
    lessonPrice: 75,
  },
  {
    emailLocal: 'coach.dupr.oak',
    fullName: 'Omar Dupré',
    headline: 'DUPR 3.5–4.0 development specialist',
    bio: 'Helps intermediate players climb DUPR with structured drills and match play.',
    skill_rating: 4.0,
    rating_system: 'DUPR',
    rating_average: 4.4,
    rating_count: 15,
    experience_years: 5,
    location: 'Oakland',
    court: {
      name: 'Rating Fixture — Lake Merritt Courts',
      address_line1: 'Lake Merritt',
      city: 'Oakland',
      state: 'CA',
      postal_code: '94612',
      latitude: 37.8044,
      longitude: -122.2581,
    },
    lessonPrice: 60,
  },
  {
    emailLocal: 'coach.utrp.soma',
    fullName: 'Uma Torres',
    headline: 'UTR-P rated — SOMA doubles strategy',
    bio: 'UTR-P focused coaching for doubles positioning, resets, and transition speed.',
    skill_rating: 5.0,
    rating_system: 'UTR-P',
    rating_average: 4.9,
    rating_count: 31,
    experience_years: 11,
    location: 'San Francisco SOMA',
    court: {
      name: 'Rating Fixture — SOMA Rec Courts',
      address_line1: '301 11th St',
      city: 'San Francisco',
      state: 'CA',
      postal_code: '94103',
      latitude: 37.7715,
      longitude: -122.4140,
    },
    lessonPrice: 85,
  },
  {
    emailLocal: 'coach.utrp.berkeley',
    fullName: 'Blake Upton',
    headline: 'UTR-P beginner-friendly pathway',
    bio: 'Patient UTR-P coach for newer players building consistency and court IQ.',
    skill_rating: 3.5,
    rating_system: 'UTR-P',
    rating_average: 4.6,
    rating_count: 18,
    experience_years: 4,
    location: 'Berkeley',
    court: {
      name: 'Rating Fixture — Berkeley Codornices Courts',
      address_line1: 'Codornices Park',
      city: 'Berkeley',
      state: 'CA',
      postal_code: '94709',
      latitude: 37.8915,
      longitude: -122.273,
    },
    lessonPrice: 55,
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
      timezone: 'America/Los_Angeles',
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

  const seedAcct = `acct_rating_${spec.emailLocal.replace(/\./g, '_')}`;
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
    defaults: { coach_notes: `${spec.rating_system} rating-system fixture` },
  });

  let lesson = await Lesson.findOne({
    where: { coach_id: user.id, title: `${spec.rating_system} Fixture Lesson`, deleted_at: null },
  });
  if (!lesson) {
    lesson = await Lesson.create({
      coach_id: user.id,
      title: `${spec.rating_system} Fixture Lesson`,
      description: `Marketplace lesson for ${spec.rating_system}-rated coach fixture.`,
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
  return { email, rating_system: spec.rating_system, skill_rating: spec.skill_rating, eligibility };
}

async function main() {
  await sequelize.authenticate();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const results = [];
  for (const spec of COACHES) {
    results.push(await ensureCoach(spec, passwordHash));
  }

  console.log('\nSeeded rating-system coaches (password Test1234!Ab):\n');
  for (const r of results) {
    const ok = r.eligibility?.listed
      ? 'marketplace-ready'
      : `NOT ready: ${(r.eligibility?.missing || []).join(', ') || 'unknown'}`;
    console.log(`  ${r.email}`);
    console.log(`    ${r.rating_system} · skill ${r.skill_rating} · ${ok}`);
  }
  console.log('\nTip: on Discover, search location "San Francisco" or ZIP 94114 to see them nearby.\n');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌', err.message);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
