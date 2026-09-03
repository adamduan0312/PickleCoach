/**
 * Verify booking-list QA matrix: sort order + student/coach card copy.
 *
 * Prerequisite: npm run seed:booking-list-qa
 *
 * Usage (from backend/):
 *   npm run verify:booking-list-qa
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { sequelize, Booking, User, Lesson } from '../models/index.js';
import { serializeBookingListItem } from '../utils/bookingDto.js';
import { sortBookingsForList } from '../../frontend/src/domain/bookingStatus.js';
import { coachAcceptanceDeadlineAt, bookingStatusLabel } from '../../frontend/src/domain/bookingStatus.js';
import { formatListWhenInZone } from '../../frontend/src/utils/datetime.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const IDEM_PREFIX = 'qa_list_matrix_';
const EXPECTED_STUDENT_KEYS = [
  'pending_tomorrow',
  'confirmed_today',
  'confirmed_next_week',
  'awaiting_verification_2h_ago',
  'completed_yesterday',
  'cancelled_tomorrow',
  'cancelled_last_week',
];
const EXPECTED_COACH_KEYS = [
  'pending_tomorrow',
  'awaiting_verification_2h_ago',
  'confirmed_today',
  'confirmed_next_week',
  'completed_yesterday',
  'cancelled_tomorrow',
  'cancelled_last_week',
];

function cardLines(dto, { audience, tz }) {
  const other = audience === 'coach' ? dto.primaryStudent : dto.coach;
  const lines = [
    dto.lesson?.title || 'Lesson',
    `${other?.full_name || '—'} · $${Number(dto.price).toFixed(2)}`,
    formatListWhenInZone(dto.scheduled_at, tz),
  ];
  if (dto.created_at) {
    lines.push(`Requested ${formatListWhenInZone(dto.created_at, tz)}`);
  }
  if (dto.status === 'pending') {
    const deadline = coachAcceptanceDeadlineAt(dto);
    if (deadline) {
      const when = formatListWhenInZone(deadline, tz);
      lines.push(
        audience === 'coach'
          ? `Respond by ${when}`
          : `Coach has until ${when} to accept or decline`,
      );
    }
  }
  lines.push(bookingStatusLabel(dto.status, { audience }));
  return lines;
}

async function loadMatrixBookings(studentId, coachId) {
  const rows = await Booking.findAll({
    where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
    include: [
      { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
      { model: User, as: 'coach', attributes: ['id', 'full_name'] },
      { model: User, as: 'primaryStudent', attributes: ['id', 'full_name'] },
    ],
    order: [['id', 'ASC']],
  });

  const dtos = rows.map((row) =>
    serializeBookingListItem(row, { viewerIsPrivileged: false }),
  );

  const keyById = Object.fromEntries(
    rows.map((r) => [r.id, r.idempotency_key.replace(IDEM_PREFIX, '')]),
  );

  return { dtos, keyById, studentId, coachId };
}

function assertOrder(sortedDtos, keyById, expectedKeys, label) {
  const matrixOnly = sortedDtos.filter((d) => keyById[d.id]);
  const actualKeys = matrixOnly.map((d) => keyById[d.id]);
  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(`${label}: expected ${expectedKeys.length} matrix bookings, found ${actualKeys.length}`);
  }
  for (let i = 0; i < expectedKeys.length; i += 1) {
    if (actualKeys[i] !== expectedKeys[i]) {
      throw new Error(
        `${label}: order mismatch at position ${i + 1}. Expected ${expectedKeys[i]}, got ${actualKeys[i]}. Full order: ${actualKeys.join(' → ')}`,
      );
    }
  }
}

async function main() {
  try {
    await sequelize.authenticate();

    const matrixRows = await Booking.findAll({
      where: { idempotency_key: { [Op.like]: `${IDEM_PREFIX}%` } },
      attributes: ['primary_student_id', 'coach_id'],
      limit: 1,
    });
    if (matrixRows.length === 0) {
      console.error('No QA matrix bookings found. Run: npm run seed:booking-list-qa');
      process.exit(1);
    }

    const studentId = matrixRows[0].primary_student_id;
    const coachId = matrixRows[0].coach_id;

    const student = await User.findByPk(studentId, { attributes: ['id', 'email', 'timezone', 'full_name'] });
    const coach = await User.findByPk(coachId, { attributes: ['id', 'full_name', 'timezone'] });

    const allStudentRows = await Booking.findAll({
      where: { primary_student_id: studentId },
      include: [
        { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
        { model: User, as: 'coach', attributes: ['id', 'full_name'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name'] },
      ],
    });
    const allCoachRows = await Booking.findAll({
      where: { coach_id: coachId },
      include: [
        { model: Lesson, as: 'lesson', attributes: ['id', 'title'] },
        { model: User, as: 'coach', attributes: ['id', 'full_name'] },
        { model: User, as: 'primaryStudent', attributes: ['id', 'full_name'] },
      ],
    });

    const studentDtos = allStudentRows.map((r) => serializeBookingListItem(r));
    const coachDtos = allCoachRows.map((r) =>
      serializeBookingListItem(r, { viewerIsPrivileged: true }),
    );

    const { keyById } = await loadMatrixBookings(studentId, coachId);

    const studentSorted = sortBookingsForList(studentDtos, undefined, { audience: 'student' });
    const coachSorted = sortBookingsForList(coachDtos, undefined, { audience: 'coach' });

    assertOrder(studentSorted, keyById, EXPECTED_STUDENT_KEYS, 'Student All tab');
    assertOrder(coachSorted, keyById, EXPECTED_COACH_KEYS, 'Coach All tab');

    const studentTz = student?.timezone || 'America/New_York';
    const pendingDto = studentSorted.find((d) => keyById[d.id] === 'pending_tomorrow');

    console.log('✅ Sort order verified (matrix bookings within full All list)');
    console.log(`   Student: ${student?.email} (${studentTz})`);
    console.log(`   Coach: ${coach?.full_name}\n`);

    console.log('--- Student pending card ---');
    for (const line of cardLines(pendingDto, { audience: 'student', tz: studentTz })) {
      console.log(line);
    }

    console.log('\n--- Coach pending card ---');
    const coachPending = coachSorted.find((d) => keyById[d.id] === 'pending_tomorrow');
    for (const line of cardLines(coachPending, { audience: 'coach', tz: coach?.timezone || studentTz })) {
      console.log(line);
    }

    console.log('\n--- Full student All tab (matrix rows only) ---');
    for (const dto of studentSorted.filter((d) => keyById[d.id])) {
      console.log(`\n[${keyById[dto.id]}]`);
      for (const line of cardLines(dto, { audience: 'student', tz: studentTz })) {
        console.log(`  ${line}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
