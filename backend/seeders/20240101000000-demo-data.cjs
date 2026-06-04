'use strict';

const bcrypt = require('bcryptjs');

/**
 * Seed file for development environment
 * Creates: 10 coaches, 50 courts, 30 lessons, 100 bookings
 * Run with: npm run db:seed
 */

module.exports = {
  async up(queryInterface, Sequelize) {

    if (process.env.NODE_ENV !== 'development') {
      throw new Error('❌ Seeding is only allowed in development');
    }

    const { sequelize } = await import('../models/sequelize.js');
    const { User, UserRole, CoachProfile, CourtLocation, CoachCourtLocation, Lesson, Booking, Payment, Review, CoachAvailability, Payout, RescheduleHistory, CancellationHistory } = await import('../models/index.js');

    // Clean up existing seed data first (idempotent seeding)
    // Delete in order to respect foreign key constraints (child tables first)
    console.log('🧹 Cleaning up existing seed data...');
    await Review.destroy({ where: {} });
    await Payout.destroy({ where: {} }); // Delete before Payment (has FK to Payment)
    await RescheduleHistory.destroy({ where: {} });
    await CancellationHistory.destroy({ where: {} });
    await Payment.destroy({ where: {} });
    await Booking.destroy({ where: {} });
    await Lesson.destroy({ where: {} });
    await CoachAvailability.destroy({ where: {} });
    await CoachCourtLocation.destroy({ where: {} });
    await CourtLocation.destroy({ where: {} });
    await CoachProfile.destroy({ where: {} });
    // Delete seed users (coaches, students, admin) but preserve any other users
    const { Op } = Sequelize;
    await User.destroy({ 
      where: { 
        email: {
          [Op.like]: '%@example.com'
        }
      } 
    });
    await User.destroy({ 
      where: { 
        email: 'admin@picklecoach.com'
      } 
    });
    console.log('✅ Cleanup complete\n');

    // Major US cities with coordinates
    const cities = [
      { name: 'New York', lat: 40.7128, lng: -74.0060 },
      { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
      { name: 'Chicago', lat: 41.8781, lng: -87.6298 },
      { name: 'Houston', lat: 29.7604, lng: -95.3698 },
      { name: 'Phoenix', lat: 33.4484, lng: -112.0740 },
      { name: 'Philadelphia', lat: 39.9526, lng: -75.1652 },
      { name: 'San Antonio', lat: 29.4241, lng: -98.4936 },
      { name: 'San Diego', lat: 32.7157, lng: -117.1611 },
      { name: 'Dallas', lat: 32.7767, lng: -96.7970 },
      { name: 'San Jose', lat: 37.3382, lng: -121.8863 },
    ];

    // Create 10 coaches
    const coaches = [];
    const coachNames = [
      'John Smith', 'Sarah Johnson', 'Mike Davis', 'Emily Wilson', 'David Brown',
      'Lisa Anderson', 'Chris Martinez', 'Jessica Taylor', 'Ryan Garcia', 'Amanda Lee'
    ];

    for (let i = 0; i < 10; i++) {
      const city = cities[i % cities.length];
      const passwordHash = await bcrypt.hash('password123', 10);
      
      try {
        const user = await User.create({
          full_name: coachNames[i],
          email: `coach${i + 1}@example.com`,
          password_hash: passwordHash,
          phone: `555-${1000 + i}`,
          timezone: 'America/New_York',
          is_active: true,
        });
        await UserRole.create({ user_id: user.id, role: 'coach' });

        const profile = await CoachProfile.create({
          user_id: user.id,
          headline: `Professional Pickleball Coach ${i + 1}`,
          bio: `Experienced pickleball coach with ${5 + i} years of teaching. Specializing in ${i % 2 === 0 ? 'beginner' : 'advanced'} players.`,
          experience_years: 3 + i,
          skill_rating: [3.0, 3.5, 4.5, 5.5][i % 4],
          rating_system: 'self',
          rating_average: 4.0 + (Math.random() * 1.0),
          rating_count: Math.floor(Math.random() * 50),
          location: city.name,
          coach_commission_percent: 92.0,
        });

        coaches.push({ user, profile, city });
      } catch (error) {
        console.error(`❌ Error creating coach ${i + 1}:`, error.message);
        if (error.errors) {
          error.errors.forEach(err => {
            console.error(`   - ${err.path}: ${err.message}`);
          });
        }
        throw error;
      }
    }

    // Create 50 courts (5 per city)
    const courts = [];
    for (let i = 0; i < 50; i++) {
      const city = cities[i % cities.length];
      const courtNum = Math.floor(i / cities.length) + 1;
      
      const court = await CourtLocation.create({
        name: `${city.name} Pickleball Court ${courtNum}`,
        address: `${100 + i} Main St, ${city.name}`,
        latitude: city.lat + (Math.random() - 0.5) * 0.1,
        longitude: city.lng + (Math.random() - 0.5) * 0.1,
        is_verified: i % 3 === 0, // Every 3rd court is verified
        is_private: i % 5 === 0, // Every 5th court is private
        source: 'manual',
      });

      courts.push(court);
    }

    // Link coaches to courts (each coach linked to 1-4 courts)
    for (let i = 0; i < coaches.length; i++) {
      const numCourts = 1 + (i % 4);
      const startCourtIndex = (i * 5) % courts.length;
      
      for (let j = 0; j < numCourts; j++) {
        const courtIndex = (startCourtIndex + j) % courts.length;
        await CoachCourtLocation.create({
          coach_id: coaches[i].user.id,
          court_id: courts[courtIndex].id,
          preferred: j === 0, // First court is preferred
        });
      }
    }

    // Create availability for coaches: recurring Mon–Fri 9–5 (coach timezone at booking time).
    for (const coach of coaches) {
      for (let day = 1; day <= 5; day++) {
        await CoachAvailability.create({
          coach_id: coach.user.id,
          weekday: day,
          start_time: '09:00:00',
          end_time: '17:00:00',
        });
      }
    }

    // Create 30 lessons (2-3 per coach)
    const lessons = [];
    for (let i = 0; i < coaches.length; i++) {
      const numLessons = 2 + (i % 2); // 2 or 3 lessons per coach
      
      for (let j = 0; j < numLessons; j++) {
        const lesson = await Lesson.create({
          coach_id: coaches[i].user.id,
          title: `Pickleball Lesson ${j + 1}`,
          description: `Comprehensive pickleball lesson covering fundamentals and advanced techniques.`,
          price: 60 + (i * 5) + (j * 10),
          duration_minutes: 60,
          max_students: 4,
          is_active: true,
        });
        lessons.push(lesson);
      }
    }

    // Create 10 students
    const students = [];
    const studentNames = [
      'Alice Cooper', 'Bob Miller', 'Carol White', 'Dan Green', 'Eve Black',
      'Frank Blue', 'Grace Red', 'Henry Yellow', 'Ivy Purple', 'Jack Orange'
    ];

    for (let i = 0; i < 10; i++) {
      const passwordHash = await bcrypt.hash('password123', 10);
      const user = await User.create({
        full_name: studentNames[i],
        email: `student${i + 1}@example.com`,
        password_hash: passwordHash,
        phone: `555-${2000 + i}`,
        timezone: 'America/New_York',
        is_active: true,
      });
      await UserRole.create({ user_id: user.id, role: 'student' });
      students.push(user);
    }

    // Create 100 bookings (mix of past, present, future)
    const now = new Date();
    for (let i = 0; i < 100; i++) {
      const lesson = lessons[i % lessons.length];
      const student = students[i % students.length];
      const coach = coaches.find(c => c.user.id === lesson.coach_id);
      const coachCourts = await CoachCourtLocation.findAll({
        where: { coach_id: coach.user.id },
        limit: 1,
      });
      const courtId = coachCourts.length > 0 ? coachCourts[0].court_id : null;

      // Mix of dates: 30% past, 20% today/upcoming week, 50% future
      let scheduledAt;
      if (i < 30) {
        // Past bookings
        scheduledAt = new Date(now.getTime() - (30 - i) * 24 * 60 * 60 * 1000);
      } else if (i < 50) {
        // Upcoming week
        scheduledAt = new Date(now.getTime() + (i - 30) * 24 * 60 * 60 * 1000);
      } else {
        // Future bookings
        scheduledAt = new Date(now.getTime() + (i - 20) * 24 * 60 * 60 * 1000);
      }

      const statuses = ['pending', 'confirmed', 'awaiting_verification', 'completed', 'cancelled'];
      let status = statuses[i % statuses.length];
      
      // Adjust status based on date
      if (scheduledAt < now && status === 'pending') {
        status = 'completed';
      } else if (scheduledAt > now && status === 'completed') {
        status = 'confirmed';
      }

      const booking = await Booking.create({
        lesson_id: lesson.id,
        coach_id: lesson.coach_id,
        primary_student_id: student.id,
        scheduled_at: scheduledAt,
        duration_minutes: lesson.duration_minutes,
        price: lesson.price,
        court_location_id: courtId,
        status: status,
        payout_status: status === 'completed' ? 'paid' : 'none',
        messaging_locked: status === 'pending',
        reschedule_count: i % 5 === 0 ? 1 : 0,
        reschedule_limit: 1,
        reschedule_deadline: new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000),
      });

      // Create payment for completed/confirmed bookings
      if (['confirmed', 'completed'].includes(status)) {
        await Payment.create({
          booking_id: booking.id,
          coach_id: lesson.coach_id,
          student_id: student.id,
          lesson_price: lesson.price,
          platform_fee_percent: 8.0,
          platform_fee_amount: lesson.price * 0.08,
          total_charge_to_student: lesson.price * 1.08,
          coach_payout_expected: lesson.price * 0.92,
          escrow_status: status === 'completed' ? 'released' : 'held',
          payment_status: 'captured',
          payment_method: 'stripe',
          currency: 'USD',
          payment_intent_id: `pi_test_${booking.id}`,
          charge_id: `ch_test_${booking.id}`,
        });
      }

      // Create reviews for completed bookings
      if (status === 'completed' && i % 3 === 0) {
        await Review.create({
          booking_id: booking.id,
          reviewer_id: student.id,
          target_user_id: lesson.coach_id,
          rating: 4 + Math.random(),
          comment: `Great lesson! Learned a lot.`,
          visibility: 'public',
        });
      }
    }

    // Create 1 admin user
    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    const adminUser = await User.create({
      full_name: 'Admin User',
      email: 'admin@picklecoach.com',
      password_hash: adminPasswordHash,
      phone: '555-0000',
      timezone: 'America/New_York',
      is_active: true,
    });
    await UserRole.create({ user_id: adminUser.id, role: 'admin' });

    console.log('✅ Seed data created successfully!');
    console.log(`   - ${coaches.length} coaches`);
    console.log(`   - ${courts.length} courts`);
    console.log(`   - ${lessons.length} lessons`);
    console.log(`   - ${students.length} students`);
    console.log(`   - 100 bookings`);
    console.log(`   - 1 admin user`);
    console.log('\n📧 Test credentials:');
    console.log('   Coach: coach1@example.com / password123');
    console.log('   Student: student1@example.com / password123');
    console.log('   Admin: admin@picklecoach.com / admin123');
  },

  async down(queryInterface, Sequelize) {
    const { User, Booking, Payment, Review, Lesson, CoachProfile, CourtLocation, CoachCourtLocation, CoachAvailability } = await import('../models/index.js');
    const { Op } = Sequelize;

    await Review.destroy({ where: {}, truncate: true });
    await Payment.destroy({ where: {}, truncate: true });
    await Booking.destroy({ where: {}, truncate: true });
    await Lesson.destroy({ where: {}, truncate: true });
    await CoachAvailability.destroy({ where: {}, truncate: true });
    await CoachCourtLocation.destroy({ where: {}, truncate: true });
    await CourtLocation.destroy({ where: {}, truncate: true });
    await CoachProfile.destroy({ where: {}, truncate: true });
    await User.destroy({
      where: {
        [Op.or]: [
          { email: { [Op.like]: '%@example.com' } },
          { email: 'admin@picklecoach.com' },
        ],
      },
    });

    console.log('✅ Seed data removed');
  }
};

