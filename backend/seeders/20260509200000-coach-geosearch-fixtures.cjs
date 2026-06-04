'use strict';

const bcrypt = require('bcryptjs');

/**
 * Additive GeoSearch fixtures for GET /coaches (with optional lat,lng,radius).
 * Uses @picklecoach.test emails so the main demo seeder wipe (%@example.com) leaves these alone.
 *
 * Credentials (development):
 * - Student-only: browse.geosearch@picklecoach.test / password123
 * - Coaches (NOT for GET /coaches — they'll get 403):
 *     geocoach.sf@picklecoach.test, geocoach.nyc@picklecoach.test / password123
 *
 * POST /login as browse.geosearch@picklecoach.test then:
 *   GET /coaches?lat=37.7749&lng=-122.4194&radius=25   → expects SF-linked coach(es)
 *   GET /coaches?lat=40.7580&lng=-73.9857&radius=25    → NYC-linked coach(es)
 *
 * If you re-run the main demo seeder (20240101000000-demo-data), it deletes all coach_profiles
 * and coach_court_locations; run this seed again afterward to restore these fixtures.
 */
module.exports = {
  async up() {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('❌ GeoSearch fixtures seeding is only allowed in development');
    }

    const { User, UserRole, CoachProfile, CourtLocation, CoachCourtLocation } = await import('../models/index.js');

    const passwordHash = await bcrypt.hash('password123', 10);

    const courtsSpec = [
      {
        key: 'sf-alpha',
        name: 'GeoSearch Fixture SF Dolores Courts',
        address: 'Dolores St & 19th St, San Francisco, CA',
        latitude: 37.761,
        longitude: -122.422,
      },
      {
        key: 'sf-beta',
        name: 'GeoSearch Fixture SF Ferry Courts',
        address: '1 Ferry Building Plaza, San Francisco, CA',
        latitude: 37.795,
        longitude: -122.393,
      },
      {
        key: 'nyc-alpha',
        name: 'GeoSearch Fixture NYC Bryant Park Courts',
        address: 'W 42nd St, New York, NY',
        latitude: 40.754,
        longitude: -73.984,
      },
      {
        key: 'nyc-beta',
        name: 'GeoSearch Fixture NYC Chelsea Piers Courts',
        address: '23rd St Waterfront, New York, NY',
        latitude: 40.748,
        longitude: -74.009,
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
          is_verified: true,
          is_private: false,
          source: 'manual',
        },
      });
      if (
        court.latitude == null ||
        court.longitude == null ||
        Number(court.latitude) !== spec.latitude ||
        Number(court.longitude) !== spec.longitude ||
        court.deleted_at
      ) {
        await court.update({
          address: spec.address,
          latitude: spec.latitude,
          longitude: spec.longitude,
          deleted_at: null,
          is_verified: true,
          is_private: false,
          source: 'manual',
        });
      }
      courtRows[spec.key] = court;
    }

    async function ensureCoach({ email, fullName, headline, locationText, courts }) {
      let user = await User.findOne({ where: { email } });
      if (!user) {
        user = await User.create({
          full_name: fullName,
          email,
          password_hash: passwordHash,
          phone: null,
          timezone: 'America/Los_Angeles',
          is_active: true,
        });
        await UserRole.create({ user_id: user.id, role: 'coach' });
      } else if (!(await UserRole.findOne({ where: { user_id: user.id, role: 'coach' } }))) {
        await UserRole.create({ user_id: user.id, role: 'coach' });
      }

      let profile = await CoachProfile.findOne({ where: { user_id: user.id } });
      const profilePayload = {
        headline,
        bio: 'Fixture coach for geo search tests.',
        experience_years: 8,
        skill_rating: 4.5,
        rating_system: 'self',
        rating_average: 4.82,
        rating_count: 12,
        location: locationText,
        coach_commission_percent: 92.0,
      };
      if (!profile) {
        profile = await CoachProfile.create({ user_id: user.id, ...profilePayload });
      } else {
        await profile.update(profilePayload);
      }

      for (let i = 0; i < courts.length; i++) {
        const court = courts[i];
        await CoachCourtLocation.findOrCreate({
          where: { coach_id: user.id, court_id: court.id },
          defaults: {
            preferred: i === 0,
            rate_modifier: null,
            notes: 'GeoSearch fixture link',
          },
        });
      }
      return user;
    }

    await ensureCoach({
      email: 'geocoach.sf@picklecoach.test',
      fullName: 'GeoSearch Coach SF',
      headline: 'SF fixture — GET /coaches near 37.77, -122.42',
      locationText: 'San Francisco Bay Area',
      courts: [courtRows['sf-alpha'], courtRows['sf-beta']],
    });

    await ensureCoach({
      email: 'geocoach.nyc@picklecoach.test',
      fullName: 'GeoSearch Coach NYC',
      headline: 'NYC fixture — GET /coaches near 40.76, -73.98',
      locationText: 'New York City',
      courts: [courtRows['nyc-alpha'], courtRows['nyc-beta']],
    });

    let student = await User.findOne({ where: { email: 'browse.geosearch@picklecoach.test' } });
    if (!student) {
      student = await User.create({
        full_name: 'Browse GeoSearch Student',
        email: 'browse.geosearch@picklecoach.test',
        password_hash: passwordHash,
        phone: null,
        timezone: 'America/New_York',
        is_active: true,
      });
      await UserRole.create({ user_id: student.id, role: 'student' });
    } else if (!(await UserRole.findOne({ where: { user_id: student.id, role: 'student' } }))) {
      await UserRole.create({ user_id: student.id, role: 'student' });
    }

    console.log('');
    console.log('✅ GeoSearch fixtures ready (Courts linked to coaches)');
    console.log('   POST /login: browse.geosearch@picklecoach.test / password123');
    console.log('   GET /coaches?lat=37.7749&lng=-122.4194&radius=25  (SF)');
    console.log('   GET /coaches?lat=40.7580&lng=-73.9857&radius=25  (NYC)');
    console.log('');
  },

  async down(queryInterface, Sequelize) {
    const { User, UserRole, CoachProfile, CoachCourtLocation, CourtLocation } = await import('../models/index.js');
    const { Op } = Sequelize;

    const coachEmails = ['geocoach.sf@picklecoach.test', 'geocoach.nyc@picklecoach.test'];
    const browseEmail = 'browse.geosearch@picklecoach.test';

    const users = await User.findAll({
      where: { email: { [Op.in]: [...coachEmails, browseEmail] } },
    });
    const userIds = users.map((u) => u.id);

    await CoachCourtLocation.destroy({ where: { coach_id: { [Op.in]: userIds } } });
    await CoachProfile.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await UserRole.destroy({ where: { user_id: { [Op.in]: userIds } } });
    await User.destroy({ where: { id: { [Op.in]: userIds } } });

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
