'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Helper: add index only if it doesn't exist (idempotent for re-runs / partially-applied migrations)
    const addIndexIfNotExists = async (qi, tableName, columns, options) => {
      const indexName = options && options.name;
      if (!indexName) {
        await qi.addIndex(tableName, columns, options);
        return;
      }
      try {
        const indexes = await qi.showIndex(tableName);
        const names = [...new Set(indexes.map((i) => (i.Key_name != null ? i.Key_name : i.name)))];
        if (names.includes(indexName)) return;
      } catch (_) {}
      await qi.addIndex(tableName, columns, options);
    };

    // Note: MySQL uses ENUM directly in column definitions, no separate type creation needed

    // 1. Users table (no dependencies)
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      full_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      role: {
        type: Sequelize.ENUM('student', 'coach', 'admin'),
        allowNull: false,
        defaultValue: 'student',
      },
      avatar_url: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      phone_verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      timezone: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'UTC',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_login: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Indexes for users
    await addIndexIfNotExists(queryInterface,'users', ['role'], { name: 'users_role' });
    await addIndexIfNotExists(queryInterface,'users', ['is_active'], { name: 'users_is_active' });
    await addIndexIfNotExists(queryInterface,'users', ['deleted_at'], { name: 'users_deleted_at' });
    await addIndexIfNotExists(queryInterface,'users', ['email'], { unique: true, name: 'users_email' });

    // 2. DisputeType table (no dependencies)
    await queryInterface.createTable('dispute_types', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      default_escalation_hours: {
        type: Sequelize.INTEGER,
        defaultValue: 48,
      },
      severity: {
        type: Sequelize.ENUM('low', 'medium', 'high'),
        defaultValue: 'medium',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // 3. DisputeResolutionAction table (no dependencies)
    await queryInterface.createTable('dispute_resolution_actions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      affects_reliability_score: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      requires_payout_adjustment: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // 4. CoachProfile table (depends on users)
    await queryInterface.createTable('coach_profiles', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      headline: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      hourly_rate: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      experience_years: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      skill_level: {
        type: Sequelize.ENUM('beginner', 'intermediate', 'advanced', 'pro'),
        defaultValue: 'intermediate',
      },
      certifications: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      location: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      rating_average: {
        type: Sequelize.DECIMAL(3, 2),
        defaultValue: 0,
      },
      rating_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      coach_commission_percent: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 92.00,
      },
      stripe_account_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'coach_profiles', ['skill_level', 'location', 'rating_average'], { name: 'coach_profiles_skill_location_rating' });
    await addIndexIfNotExists(queryInterface,'coach_profiles', ['stripe_account_id'], { name: 'coach_profiles_stripe_account_id' });

    // 5. CoachAvailability table (depends on users)
    await queryInterface.createTable('coach_availabilities', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      weekday: {
        type: Sequelize.TINYINT,
        allowNull: true,
      },
      start_datetime: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      end_datetime: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      recurrence_rule: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      is_available: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'coach_availabilities', ['coach_id'], { name: 'coach_availabilities_coach_id' });
    await addIndexIfNotExists(queryInterface,'coach_availabilities', ['weekday'], { name: 'coach_availabilities_weekday' });
    await addIndexIfNotExists(queryInterface,'coach_availabilities', ['start_date'], { name: 'coach_availabilities_start_date' });
    await addIndexIfNotExists(queryInterface,'coach_availabilities', ['end_date'], { name: 'coach_availabilities_end_date' });

    // 6. CourtLocation table (depends on users)
    await queryInterface.createTable('court_locations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      address: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      latitude: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      longitude: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      is_private: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      created_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      source: {
        type: Sequelize.ENUM('manual', 'import', 'api'),
        defaultValue: 'manual',
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'court_locations', ['latitude'], { name: 'court_locations_latitude' });
    await addIndexIfNotExists(queryInterface, 'court_locations', ['longitude'], { name: 'court_locations_longitude' });
    await addIndexIfNotExists(queryInterface, 'court_locations', ['name', 'address'], { unique: true, name: 'unique_court' });

    // 7. CoachCourtLocation table (depends on users, court_locations)
    await queryInterface.createTable('coach_court_locations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      court_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'court_locations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      rate_modifier: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      preferred: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'coach_court_locations', ['coach_id', 'court_id'], { unique: true, name: 'coach_court_locations_coach_id_court_id' });

    // 8. Lesson table (depends on users)
    await queryInterface.createTable('lessons', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      duration_minutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      max_students: {
        type: Sequelize.INTEGER,
        defaultValue: 1,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'lessons', ['coach_id', 'is_active'], { name: 'lessons_coach_id_is_active' });
    await addIndexIfNotExists(queryInterface,'lessons', ['price'], { name: 'lessons_price' });

    // 9. Booking table (depends on lessons, users, court_locations)
    await queryInterface.createTable('bookings', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      lesson_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'lessons',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      primary_student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      duration_minutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'awaiting_verification', 'completed', 'cancelled', 'disputed'),
        defaultValue: 'pending',
      },
      payout_status: {
        type: Sequelize.ENUM('none', 'pending', 'awaiting_verification', 'processing', 'paid', 'forfeited'),
        defaultValue: 'none',
      },
      cancelled_by: {
        type: Sequelize.ENUM('student', 'coach', 'admin'),
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      messaging_locked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      reschedule_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      reschedule_limit: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      extra_paid_reschedules: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      reschedule_deadline: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      court_location_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'court_locations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'bookings', ['coach_id'], { name: 'bookings_coach_id' });
    await addIndexIfNotExists(queryInterface,'bookings', ['primary_student_id'], { name: 'bookings_primary_student_id' });
    await addIndexIfNotExists(queryInterface,'bookings', ['scheduled_at'], { name: 'bookings_scheduled_at' });
    await addIndexIfNotExists(queryInterface,'bookings', ['status'], { name: 'bookings_status' });
    await addIndexIfNotExists(queryInterface,'bookings', ['payout_status'], { name: 'bookings_payout_status' });
    await addIndexIfNotExists(queryInterface,'bookings', ['court_location_id'], { name: 'bookings_court_location_id' });
    await addIndexIfNotExists(queryInterface,'bookings', ['coach_id', 'status', 'scheduled_at'], { name: 'bookings_coach_status_scheduled' });
    await addIndexIfNotExists(queryInterface,'bookings', ['primary_student_id', 'status', 'scheduled_at'], { name: 'bookings_student_status_scheduled' });

    // 10. BookingPlayer table (depends on bookings, users)
    await queryInterface.createTable('booking_players', {
      booking_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      player_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'booking_players', ['player_id'], { name: 'booking_players_player_id' });

    // 11. Dispute table (depends on bookings, dispute_types, dispute_resolution_actions, users)
    await queryInterface.createTable('disputes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      dispute_type_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'dispute_types',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      opened_by: {
        type: Sequelize.ENUM('student', 'coach', 'system', 'admin'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('open', 'under_review', 'resolved', 'rejected'),
        defaultValue: 'open',
      },
      resolution_action_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'dispute_resolution_actions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      resolution_notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      admin_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      escalated: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      escalated_to: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      escalation_triggered_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      opened_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'disputes', ['status'], { name: 'disputes_status' });
    await addIndexIfNotExists(queryInterface,'disputes', ['dispute_type_id'], { name: 'disputes_dispute_type_id' });
    await addIndexIfNotExists(queryInterface,'disputes', ['admin_id'], { name: 'disputes_admin_id' });
    await addIndexIfNotExists(queryInterface,'disputes', ['escalated'], { name: 'disputes_escalated' });

    // 12. Payment table (depends on bookings, users, disputes)
    await queryInterface.createTable('payments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      lesson_price: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      platform_fee_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 8.00,
      },
      platform_fee_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_charge_to_student: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      coach_payout_expected: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      escrow_status: {
        type: Sequelize.ENUM('held', 'released', 'refunded', 'disputed'),
        allowNull: false,
        defaultValue: 'held',
      },
      payment_status: {
        type: Sequelize.ENUM('pending', 'captured', 'failed', 'refunded'),
        defaultValue: 'pending',
      },
      payment_method: {
        type: Sequelize.ENUM('stripe', 'apple_pay', 'google_pay', 'card'),
        allowNull: false,
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'USD',
      },
      payment_intent_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      charge_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      transfer_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      payout_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      refunded_amount: {
        type: Sequelize.DECIMAL(12, 2),
        defaultValue: 0,
      },
      dispute_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'disputes',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'payments', ['booking_id'], { name: 'payments_booking_id' });
    await addIndexIfNotExists(queryInterface,'payments', ['student_id'], { name: 'payments_student_id' });
    await addIndexIfNotExists(queryInterface,'payments', ['coach_id'], { name: 'payments_coach_id' });
    await addIndexIfNotExists(queryInterface,'payments', ['payment_intent_id'], { name: 'payments_payment_intent_id' });
    await addIndexIfNotExists(queryInterface,'payments', ['charge_id'], { name: 'payments_charge_id' });
    await addIndexIfNotExists(queryInterface,'payments', ['escrow_status'], { name: 'payments_escrow_status' });
    await addIndexIfNotExists(queryInterface,'payments', ['created_at'], { name: 'payments_created_at' });
    await addIndexIfNotExists(queryInterface,'payments', ['escrow_status', 'created_at'], { name: 'payments_escrow_created' });
    await addIndexIfNotExists(queryInterface,'payments', ['student_id', 'escrow_status'], { name: 'payments_student_escrow' });

    // 13. RescheduleHistory table (depends on bookings, users, payments)
    await queryInterface.createTable('reschedule_history', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      requested_by: {
        type: Sequelize.ENUM('student', 'coach', 'admin', 'system'),
        allowNull: false,
      },
      old_scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      new_scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      approved_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      approved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      approval_status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'auto_approved'),
        defaultValue: 'pending',
      },
      reason: {
        type: Sequelize.ENUM('weather', 'emergency', 'sickness', 'travel_delay', 'schedule_conflict', 'forgot', 'other'),
        allowNull: true,
      },
      reason_notes: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      affects_reliability: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      paid_reschedule: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      transaction_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'payments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      admin_override: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      requested_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'reschedule_history', ['booking_id'], { name: 'reschedule_history_booking_id' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['requested_by'], { name: 'reschedule_history_requested_by' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['requested_at'], { name: 'reschedule_history_requested_at' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['affects_reliability'], { name: 'reschedule_history_affects_reliability' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['paid_reschedule'], { name: 'reschedule_history_paid_reschedule' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['booking_id', 'requested_at'], { name: 'reschedule_history_booking_requested' });
    await addIndexIfNotExists(queryInterface,'reschedule_history', ['requested_by', 'affects_reliability', 'requested_at'], { name: 'reschedule_history_requested_reliability' });

    // 14. CancellationHistory table (depends on bookings, payments)
    await queryInterface.createTable('cancellation_history', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cancelled_by: {
        type: Sequelize.ENUM('student', 'coach', 'admin', 'system'),
        allowNull: false,
      },
      refund_amount: {
        type: Sequelize.DECIMAL(12, 2),
        defaultValue: 0,
      },
      penalty_amount: {
        type: Sequelize.DECIMAL(12, 2),
        defaultValue: 0,
      },
      reason: {
        type: Sequelize.ENUM('weather', 'emergency', 'sickness', 'travel_delay', 'schedule_conflict', 'forgot', 'other'),
        allowNull: true,
      },
      reason_notes: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      penalty_reason: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      affects_reliability: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      refund_payment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'payments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'cancellation_history', ['booking_id'], { name: 'cancellation_history_booking_id' });
    await addIndexIfNotExists(queryInterface,'cancellation_history', ['cancelled_at'], { name: 'cancellation_history_cancelled_at' });
    await addIndexIfNotExists(queryInterface,'cancellation_history', ['cancelled_by'], { name: 'cancellation_history_cancelled_by' });
    await addIndexIfNotExists(queryInterface,'cancellation_history', ['affects_reliability'], { name: 'cancellation_history_affects_reliability' });
    await addIndexIfNotExists(queryInterface,'cancellation_history', ['booking_id', 'cancelled_at'], { name: 'cancellation_history_booking_cancelled' });
    await addIndexIfNotExists(queryInterface,'cancellation_history', ['cancelled_by', 'affects_reliability', 'cancelled_at'], { name: 'cancellation_history_cancelled_reliability' });

    // 15. Payout table (depends on users, payments)
    await queryInterface.createTable('payouts', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'payments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      currency: {
        type: Sequelize.STRING(3),
        defaultValue: 'USD',
      },
      payout_method: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'paid', 'failed'),
        defaultValue: 'pending',
      },
      external_payout_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'payouts', ['coach_id'], { name: 'payouts_coach_id' });
    await addIndexIfNotExists(queryInterface,'payouts', ['payment_id'], { name: 'payouts_payment_id' });

    // 16. Review table (depends on bookings, users)
    await queryInterface.createTable('reviews', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      reviewer_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      target_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      attendance_badges: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      visibility: {
        type: Sequelize.ENUM('public', 'private', 'semi_public'),
        defaultValue: 'public',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'reviews', ['target_user_id'], { name: 'reviews_target_user_id' });
    await addIndexIfNotExists(queryInterface,'reviews', ['reviewer_id'], { name: 'reviews_reviewer_id' });
    await addIndexIfNotExists(queryInterface,'reviews', ['target_user_id', 'created_at'], { name: 'reviews_target_created' });

    // 17. UserReliability table (depends on users)
    await queryInterface.createTable('user_reliability', {
      user_id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      total_bookings: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      reschedules: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      paid_reschedules: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      late_cancels: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      no_shows: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      coach_cancels: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      reliability_score: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 100.00,
      },
      badges: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      last_updated: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'user_reliability', ['reliability_score'], { name: 'user_reliability_reliability_score' });

    // 18. Conversation table (depends on bookings)
    await queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'conversations', ['booking_id'], { name: 'conversations_booking_id' });

    // 19. Message table (depends on conversations, users)
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      conversation_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'conversations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sender_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      attachments: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'messages', ['conversation_id'], { name: 'messages_conversation_id' });
    await addIndexIfNotExists(queryInterface,'messages', ['sender_id'], { name: 'messages_sender_id' });
    
    // Add FULLTEXT index for message content search (idempotent)
    try {
      const msgIndexes = await queryInterface.showIndex('messages');
      const hasFt = msgIndexes.some((i) => (i.Key_name != null ? i.Key_name : i.name) === 'ft_messages_content');
      if (!hasFt) {
        await queryInterface.sequelize.query(`
          ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_content (content);
        `);
      }
    } catch (_) {}

    // 20. WebhookLog table (no dependencies)
    await queryInterface.createTable('webhook_logs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      provider: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      event_type: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      event_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      success: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      response: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      received_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'webhook_logs', ['provider'], { name: 'webhook_logs_provider' });
    await addIndexIfNotExists(queryInterface,'webhook_logs', ['event_type'], { name: 'webhook_logs_event_type' });
    await addIndexIfNotExists(queryInterface,'webhook_logs', ['received_at'], { name: 'webhook_logs_received_at' });
    await addIndexIfNotExists(queryInterface,'webhook_logs', ['provider', 'event_id'], { unique: true, name: 'webhook_logs_provider_event' });
    await addIndexIfNotExists(queryInterface,'webhook_logs', ['provider', 'event_type', 'received_at'], { name: 'webhook_logs_provider_type_received' });

    // 21. AuditLog table (depends on users)
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      table_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      record_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      before_state: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      after_state: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'audit_logs', ['user_id'], { name: 'audit_logs_user_id' });
    await addIndexIfNotExists(queryInterface,'audit_logs', ['action'], { name: 'audit_logs_action' });
    await addIndexIfNotExists(queryInterface,'audit_logs', ['created_at'], { name: 'audit_logs_created_at' });

    // 22. AdminAnalytics table (no dependencies)
    await queryInterface.createTable('admin_analytics', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      total_revenue: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_commissions: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      total_lessons: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      total_students: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      total_coaches: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      most_popular_lessons: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      top_rated_coaches: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    // 23. AdminAlert table (depends on users, bookings, payments)
    await queryInterface.createTable('admin_alerts', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      alert_type: {
        type: Sequelize.ENUM('no_show', 'pending_dispute', 'failed_payout', 'webhook_failure', 'other'),
        allowNull: false,
      },
      related_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      related_booking_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      related_payment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'payments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'critical'),
        defaultValue: 'warning',
      },
      resolved: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'admin_alerts', ['alert_type'], { name: 'admin_alerts_alert_type' });
    await addIndexIfNotExists(queryInterface,'admin_alerts', ['resolved'], { name: 'admin_alerts_resolved' });
    await addIndexIfNotExists(queryInterface,'admin_alerts', ['created_at'], { name: 'admin_alerts_created_at' });

    // 24. CoachReport table (depends on users)
    await queryInterface.createTable('coach_reports', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      total_earnings: {
        type: Sequelize.DECIMAL(14, 2),
        defaultValue: 0,
      },
      total_lessons: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      average_rating: {
        type: Sequelize.DECIMAL(3, 2),
        defaultValue: 0,
      },
      feedback_summary: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      report_month: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'coach_reports', ['coach_id'], { name: 'coach_reports_coach_id' });
    await addIndexIfNotExists(queryInterface,'coach_reports', ['report_month'], { name: 'coach_reports_report_month' });

    // 25. StudentFeedback table (depends on bookings, users)
    await queryInterface.createTable('student_feedback', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      visibility: {
        type: Sequelize.ENUM('private', 'semi_public', 'public'),
        defaultValue: 'private',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'student_feedback', ['coach_id'], { name: 'student_feedback_coach_id' });
    await addIndexIfNotExists(queryInterface,'student_feedback', ['student_id'], { name: 'student_feedback_student_id' });

    // 26. MessageTemplate table (depends on users)
    await queryInterface.createTable('message_templates', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      owner_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      title: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      body: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // 27. UserBadge table (depends on users)
    await queryInterface.createTable('user_badges', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      badge_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      awarded_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'user_badges', ['user_id'], { name: 'user_badges_user_id' });
    await addIndexIfNotExists(queryInterface,'user_badges', ['badge_key'], { name: 'user_badges_badge_key' });

    // 28. SessionHistory table (depends on bookings, users)
    await queryInterface.createTable('session_history', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      duration_minutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      feedback: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'session_history', ['booking_id'], { name: 'session_history_booking_id' });
    await addIndexIfNotExists(queryInterface,'session_history', ['student_id'], { name: 'session_history_student_id' });
    await addIndexIfNotExists(queryInterface,'session_history', ['coach_id'], { name: 'session_history_coach_id' });

    // 29. PromoCode table (no dependencies)
    await queryInterface.createTable('promo_codes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      discount_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
      },
      discount_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      max_uses: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      uses: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'promo_codes', ['code'], { name: 'promo_codes_code' });
    await addIndexIfNotExists(queryInterface,'promo_codes', ['expires_at'], { name: 'promo_codes_expires_at' });

    // 30. SystemJob table (depends on bookings)
    await queryInterface.createTable('system_jobs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      job_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      related_booking_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'completed', 'failed'),
        defaultValue: 'pending',
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      attempted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      retries: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'system_jobs', ['status'], { name: 'system_jobs_status' });
    await addIndexIfNotExists(queryInterface,'system_jobs', ['scheduled_at'], { name: 'system_jobs_scheduled_at' });
    await addIndexIfNotExists(queryInterface,'system_jobs', ['job_type'], { name: 'system_jobs_job_type' });
    await addIndexIfNotExists(queryInterface,'system_jobs', ['related_booking_id'], { name: 'system_jobs_related_booking_id' });

    // 31. Notification table (depends on users)
    await queryInterface.createTable('notifications', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      channel: {
        type: Sequelize.ENUM('email', 'sms', 'in_app'),
        allowNull: false,
      },
      entity_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      entity_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface,'notifications', ['user_id'], { name: 'notifications_user_id' });
    await addIndexIfNotExists(queryInterface,'notifications', ['status'], { name: 'notifications_status' });
    await addIndexIfNotExists(queryInterface,'notifications', ['channel'], { name: 'notifications_channel' });
    await addIndexIfNotExists(queryInterface,'notifications', ['entity_type', 'entity_id'], { name: 'notifications_entity' });
    await addIndexIfNotExists(queryInterface,'notifications', ['user_id', 'channel', 'read_at'], { name: 'notifications_user_channel_read' });
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order (respecting foreign key dependencies)
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('system_jobs');
    await queryInterface.dropTable('promo_codes');
    await queryInterface.dropTable('session_history');
    await queryInterface.dropTable('user_badges');
    await queryInterface.dropTable('message_templates');
    await queryInterface.dropTable('student_feedback');
    await queryInterface.dropTable('coach_reports');
    await queryInterface.dropTable('admin_alerts');
    await queryInterface.dropTable('admin_analytics');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('webhook_logs');
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('conversations');
    await queryInterface.dropTable('user_reliability');
    await queryInterface.dropTable('reviews');
    await queryInterface.dropTable('payouts');
    await queryInterface.dropTable('cancellation_history');
    await queryInterface.dropTable('reschedule_history');
    await queryInterface.dropTable('payments');
    await queryInterface.dropTable('disputes');
    await queryInterface.dropTable('booking_players');
    await queryInterface.dropTable('bookings');
    await queryInterface.dropTable('lessons');
    await queryInterface.dropTable('coach_court_locations');
    await queryInterface.dropTable('court_locations');
    await queryInterface.dropTable('coach_availabilities');
    await queryInterface.dropTable('coach_profiles');
    await queryInterface.dropTable('dispute_resolution_actions');
    await queryInterface.dropTable('dispute_types');
    await queryInterface.dropTable('users');
  }
};
