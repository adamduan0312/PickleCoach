'use strict';

const bcrypt = require('bcryptjs');

/**
 * Additive GeoSearch fixtures for GET /coaches?lat=&lng=&radius=
 *
 * Uses @picklecoach.example.org emails (Joi-valid) so the main demo seeder wipe
 * (%@example.com) leaves these alone.
 *
 * Search center (matches Postman student List Coaches):
 *   lat=37.78  lng=-122.41  (downtown San Francisco)
 *
 * Credentials (development):
 * - Student: browse.geosearch@picklecoach.example.org / password123
 * - Coaches (cannot call GET /coaches — 403): see emails below
 *
 * Expected results from that center (approx miles → coach email):
 *   radius=5   → geocoach.sf.mission, geocoach.sf.ferry  (~1–3 mi)
 *   radius=10  → + geocoach.oak.merritt                   (~9 mi)
 *   radius=15  → + geocoach.berkeley                      (~11 mi)
 *   radius=25  → + geocoach.sanmateo                      (~17 mi)
 *   radius=50  → + geocoach.sanjose                       (~42 mi)
 *   never (any SF radius) → geocoach.nyc, geocoach.la, geocoach.nocourt, geocoach.deletedcourt
 *
 * Re-run after demo seed wipe:
 *   npm run seed:geosearch
 */
module.exports = {
  async up() {
    if ((process.env.NODE_ENV || 'development') !== 'development') {
      throw new Error('❌ GeoSearch fixtures seeding is only allowed in development');
    }

    const { User, UserRole, CoachProfile, CourtLocation, CoachCourtLocation, Lesson, CoachAvailability } = await import('../models/index.js');

    const passwordHash = await bcrypt.hash('password123', 10);
    const verifiedAt = new Date();

    /** Courts keyed for coach linking. Miles are vs Postman center (37.78, -122.41). */
    const courtsSpec = [
      {
        key: 'sf-mission',
        name: 'GeoSearch Fixture SF Mission Courts',
        address: 'Dolores St & 19th St, San Francisco, CA',
        latitude: 37.7599,
        longitude: -122.425,
        approxMilesFromSfCenter: 1.5,
      },
      {
        key: 'sf-ferry',
        name: 'GeoSearch Fixture SF Ferry Courts',
        address: '1 Ferry Building Plaza, San Francisco, CA',
        latitude: 37.7955,
        longitude: -122.3937,
        approxMilesFromSfCenter: 2.5,
      },
      {
        key: 'oak-merritt',
        name: 'GeoSearch Fixture Oakland Lake Merritt Courts',
        address: 'Lake Merritt, Oakland, CA',
        latitude: 37.8044,
        longitude: -122.2581,
        approxMilesFromSfCenter: 9,
      },
      {
        key: 'berkeley',
        name: 'GeoSearch Fixture Berkeley Codornices Courts',
        address: 'Codornices Park, Berkeley, CA',
        latitude: 37.8915,
        longitude: -122.273,
        approxMilesFromSfCenter: 11,
      },
      {
        key: 'sanmateo',
        name: 'GeoSearch Fixture San Mateo Central Park Courts',
        address: 'Central Park, San Mateo, CA',
        latitude: 37.5629,
        longitude: -122.3255,
        approxMilesFromSfCenter: 17,
      },
      {
        key: 'sanjose',
        name: 'GeoSearch Fixture San Jose Guadalupe Courts',
        address: 'Guadalupe River Park, San Jose, CA',
        latitude: 37.3382,
        longitude: -121.8863,
        approxMilesFromSfCenter: 42,
      },
      {
        key: 'la-santa-monica',
        name: 'GeoSearch Fixture LA Santa Monica Courts',
        address: 'Ocean Ave, Santa Monica, CA',
        latitude: 34.0195,
        longitude: -118.4912,
        approxMilesFromSfCenter: 350,
      },
      {
        key: 'nyc-bryant',
        name: 'GeoSearch Fixture NYC Bryant Park Courts',
        address: 'W 42nd St, New York, NY',
        latitude: 40.754,
        longitude: -73.984,
        approxMilesFromSfCenter: 2560,
      },
      {
        key: 'nyc-chelsea',
        name: 'GeoSearch Fixture NYC Chelsea Piers Courts',
        address: '23rd St Waterfront, New York, NY',
        latitude: 40.748,
        longitude: -74.009,
        approxMilesFromSfCenter: 2560,
      },
      {
        key: 'sf-deleted',
        name: 'GeoSearch Fixture SF Soft-Deleted Court',
        address: 'Hidden Alley, San Francisco, CA',
        latitude: 37.78,
        longitude: -122.41,
        approxMilesFromSfCenter: 0,
        softDeleted: true,
      },
    ];

    const courtRows = {};
    for (const spec of courtsSpec) {
      const [court] = await CourtLocation.findOrCreate({
        where: { name: spec.name },
        defaults: {
          address: spec.address,
          latitude: spec.latitude,
          longitude: spec.longitude,
          is_private: false,
          source: 'manual',
          deleted_at: spec.softDeleted ? new Date() : null,
        },
      });
      await court.update({
        address: spec.address,
        latitude: spec.latitude,
        longitude: spec.longitude,
        is_private: false,
        source: 'manual',
        deleted_at: spec.softDeleted ? (court.deleted_at || new Date()) : null,
      });
      courtRows[spec.key] = court;
    }

    async function ensureCoach({
      email,
      fullName,
      headline,
      locationText,
      courts,
      skillRating = 4.5,
      ratingAverage = 4.5,
      ratingCount = 10,
      experienceYears = 5,
      /** When true: stripe_ready + active lesson + availability (full marketplace eligibility aside from courts). */
      marketplaceEligible = true,
    }) {
      let user = await User.findOne({ where: { email } });
      if (!user) {
        user = await User.create({
          full_name: fullName,
          email,
          password_hash: passwordHash,
          phone: null,
          timezone: 'America/Los_Angeles',
          is_active: true,
          email_verified_at: verifiedAt,
        });
        await UserRole.create({ user_id: user.id, role: 'coach' });
      } else {
        if (!(await UserRole.findOne({ where: { user_id: user.id, role: 'coach' } }))) {
          await UserRole.create({ user_id: user.id, role: 'coach' });
        }
        await user.update({
          full_name: fullName,
          is_active: true,
          deleted_at: null,
          email_verified_at: user.email_verified_at || verifiedAt,
        });
      }

      const seedAcct = `acct_geoseed_${email.split('@')[0].replace(/\./g, '_')}`;
      const profilePayload = {
        headline,
        bio: 'Fixture coach for GET /coaches radius / geo search tests.',
        experience_years: experienceYears,
        skill_rating: skillRating,
        rating_system: 'self',
        rating_average: ratingAverage,
        rating_count: ratingCount,
        location: locationText,
        coach_commission_percent: 92.0,
        deleted_at: null,
        stripe_account_id: marketplaceEligible ? seedAcct : null,
        stripe_ready: Boolean(marketplaceEligible),
        stripe_onboarding_completed_at: marketplaceEligible ? verifiedAt : null,
      };

      let profile = await CoachProfile.findOne({ where: { user_id: user.id } });
      if (!profile) {
        profile = await CoachProfile.create({ user_id: user.id, ...profilePayload });
      } else {
        await profile.update(profilePayload);
      }

      for (const court of courts) {
        await CoachCourtLocation.findOrCreate({
          where: { coach_id: user.id, court_id: court.id },
          defaults: {
            rate_modifier: null,
            coach_notes: 'GeoSearch fixture link',
          },
        });
      }

      if (marketplaceEligible) {
        let lesson = await Lesson.findOne({
          where: { coach_id: user.id, title: 'GeoSearch Fixture Lesson', deleted_at: null },
        });
        if (!lesson) {
          lesson = await Lesson.create({
            coach_id: user.id,
            title: 'GeoSearch Fixture Lesson',
            description: 'Active lesson for marketplace discovery fixtures.',
            price: 60,
            duration_minutes: 60,
            max_students: 1,
            is_active: true,
          });
        } else {
          await lesson.update({ is_active: true, deleted_at: null, price: 60, duration_minutes: 60 });
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
      }

      return user;
    }

    // --- SF Bay Area ladder (use these with lat=37.78&lng=-122.41) ---
    await ensureCoach({
      email: 'geocoach.sf.mission@picklecoach.example.org',
      fullName: 'GeoSearch Coach SF Mission',
      headline: '~1.5mi — inside radius 5 from downtown SF',
      locationText: 'San Francisco Mission',
      courts: [courtRows['sf-mission']],
      skillRating: 4.0,
      ratingAverage: 4.9,
      experienceYears: 7,
    });

    await ensureCoach({
      email: 'geocoach.sf.ferry@picklecoach.example.org',
      fullName: 'GeoSearch Coach SF Ferry',
      headline: '~2.5mi — inside radius 5 from downtown SF',
      locationText: 'San Francisco Embarcadero',
      courts: [courtRows['sf-ferry']],
      skillRating: 5.0,
      ratingAverage: 4.6,
      experienceYears: 10,
    });

    await ensureCoach({
      email: 'geocoach.oak.merritt@picklecoach.example.org',
      fullName: 'GeoSearch Coach Oakland',
      headline: '~9mi — appears at radius≥10, not at radius=5',
      locationText: 'Oakland',
      courts: [courtRows['oak-merritt']],
      skillRating: 3.5,
      ratingAverage: 4.2,
      experienceYears: 4,
    });

    await ensureCoach({
      email: 'geocoach.berkeley@picklecoach.example.org',
      fullName: 'GeoSearch Coach Berkeley',
      headline: '~11mi — appears at radius≥15',
      locationText: 'Berkeley',
      courts: [courtRows['berkeley']],
      skillRating: 4.5,
      ratingAverage: 4.8,
      experienceYears: 6,
    });

    await ensureCoach({
      email: 'geocoach.sanmateo@picklecoach.example.org',
      fullName: 'GeoSearch Coach San Mateo',
      headline: '~17mi — appears at radius≥25',
      locationText: 'San Mateo',
      courts: [courtRows['sanmateo']],
      skillRating: 3.0,
      ratingAverage: 3.9,
      experienceYears: 3,
    });

    await ensureCoach({
      email: 'geocoach.sanjose@picklecoach.example.org',
      fullName: 'GeoSearch Coach San Jose',
      headline: '~42mi — appears at radius≥50',
      locationText: 'San Jose',
      courts: [courtRows['sanjose']],
      skillRating: 5.5,
      ratingAverage: 4.4,
      experienceYears: 12,
    });

    // Legacy aliases kept so older docs/Postman expectations still work
    await ensureCoach({
      email: 'geocoach.sf@picklecoach.example.org',
      fullName: 'GeoSearch Coach SF (legacy)',
      headline: 'SF fixture (both Mission + Ferry) — inside radius 5',
      locationText: 'San Francisco Bay Area',
      courts: [courtRows['sf-mission'], courtRows['sf-ferry']],
      skillRating: 4.5,
      ratingAverage: 4.82,
      experienceYears: 8,
    });

    // --- Outside Bay Area (must NOT appear in SF radius searches) ---
    await ensureCoach({
      email: 'geocoach.nyc@picklecoach.example.org',
      fullName: 'GeoSearch Coach NYC',
      headline: 'NYC fixture — only for lat/lng near 40.76,-73.98',
      locationText: 'New York City',
      courts: [courtRows['nyc-bryant'], courtRows['nyc-chelsea']],
      skillRating: 4.5,
      ratingAverage: 4.7,
      experienceYears: 9,
    });

    await ensureCoach({
      email: 'geocoach.la@picklecoach.example.org',
      fullName: 'GeoSearch Coach LA',
      headline: '~350mi — never in SF radius≤100',
      locationText: 'Los Angeles',
      courts: [courtRows['la-santa-monica']],
      skillRating: 4.0,
      ratingAverage: 4.1,
      experienceYears: 5,
    });

    // --- Negative controls ---
    await ensureCoach({
      email: 'geocoach.nocourt@picklecoach.example.org',
      fullName: 'GeoSearch Coach No Courts',
      headline: 'Has profile but NO court links — excluded from marketplace',
      locationText: 'San Francisco (profile only)',
      courts: [],
      skillRating: 4.0,
      ratingAverage: 5.0,
      experienceYears: 2,
      marketplaceEligible: false,
    });

    await ensureCoach({
      email: 'geocoach.deletedcourt@picklecoach.example.org',
      fullName: 'GeoSearch Coach Soft-Deleted Court',
      headline: 'Linked only to soft-deleted court — excluded from marketplace',
      locationText: 'San Francisco',
      courts: [courtRows['sf-deleted']],
      skillRating: 4.0,
      ratingAverage: 4.0,
      experienceYears: 2,
      marketplaceEligible: false,
    });

    let student = await User.findOne({ where: { email: 'browse.geosearch@picklecoach.example.org' } });
    if (!student) {
      student = await User.create({
        full_name: 'Browse GeoSearch Student',
        email: 'browse.geosearch@picklecoach.example.org',
        password_hash: passwordHash,
        phone: null,
        timezone: 'America/Los_Angeles',
        is_active: true,
        email_verified_at: verifiedAt,
      });
      await UserRole.create({ user_id: student.id, role: 'student' });
    } else {
      if (!(await UserRole.findOne({ where: { user_id: student.id, role: 'student' } }))) {
        await UserRole.create({ user_id: student.id, role: 'student' });
      }
      await student.update({
        is_active: true,
        deleted_at: null,
        email_verified_at: student.email_verified_at || verifiedAt,
      });
    }

    console.log('');
    console.log('✅ GeoSearch fixtures ready');
    console.log('   Student login: browse.geosearch@picklecoach.example.org / password123');
    console.log('   (Or use student.testflow@… — any verified student JWT works)');
    console.log('');
    console.log('   GET /coaches?lat=37.78&lng=-122.41&radius=5');
    console.log('     → Mission + Ferry + legacy SF (~1–3 mi)');
    console.log('   GET /coaches?lat=37.78&lng=-122.41&radius=10');
    console.log('     → + Oakland (~9 mi)');
    console.log('   GET /coaches?lat=37.78&lng=-122.41&radius=15');
    console.log('     → + Berkeley (~11 mi)');
    console.log('   GET /coaches?lat=37.78&lng=-122.41&radius=25');
    console.log('     → + San Mateo (~17 mi)');
    console.log('   GET /coaches?lat=37.78&lng=-122.41&radius=50');
    console.log('     → + San Jose (~42 mi)');
    console.log('   Never in SF search: NYC, LA, NoCourts, SoftDeletedCourt');
    console.log('   NYC check: GET /coaches?lat=40.758&lng=-73.9857&radius=25');
    console.log('');
  },

  async down(queryInterface, Sequelize) {
    const { User, UserRole, CoachProfile, CoachCourtLocation, CourtLocation } = await import('../models/index.js');
    const { Op } = Sequelize;

    const coachEmails = [
      'geocoach.sf@picklecoach.example.org',
      'geocoach.sf.mission@picklecoach.example.org',
      'geocoach.sf.ferry@picklecoach.example.org',
      'geocoach.oak.merritt@picklecoach.example.org',
      'geocoach.berkeley@picklecoach.example.org',
      'geocoach.sanmateo@picklecoach.example.org',
      'geocoach.sanjose@picklecoach.example.org',
      'geocoach.nyc@picklecoach.example.org',
      'geocoach.la@picklecoach.example.org',
      'geocoach.nocourt@picklecoach.example.org',
      'geocoach.deletedcourt@picklecoach.example.org',
    ];
    const browseEmail = 'browse.geosearch@picklecoach.example.org';
    const legacyCoachEmails = ['geocoach.sf@picklecoach.test', 'geocoach.nyc@picklecoach.test'];
    const legacyBrowseEmail = 'browse.geosearch@picklecoach.test';

    const users = await User.findAll({
      where: {
        email: {
          [Op.in]: [...coachEmails, browseEmail, ...legacyCoachEmails, legacyBrowseEmail],
        },
      },
    });
    const userIds = users.map((u) => u.id);

    if (userIds.length) {
      await CoachCourtLocation.destroy({ where: { coach_id: { [Op.in]: userIds } } });
      await CoachProfile.destroy({ where: { user_id: { [Op.in]: userIds } } });
      await UserRole.destroy({ where: { user_id: { [Op.in]: userIds } } });
      await User.destroy({ where: { id: { [Op.in]: userIds } } });
    }

    await CourtLocation.destroy({
      where: {
        name: {
          [Op.like]: 'GeoSearch Fixture %',
        },
      },
    });

    console.log('🧹 GeoSearch fixtures removed');
  },
};
