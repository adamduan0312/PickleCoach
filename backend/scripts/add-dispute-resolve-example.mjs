#!/usr/bin/env node
/**
 * One-off enrichment: inject a worked 200 OK example response into the
 * "Resolve Dispute (Admin)" item in PickleCoach_API_ByType.postman_collection.json
 * so Postman users can preview the shape of `data.dispute` (including the new
 * `decision` / `outcome` / `refund_amount` fields) and the `resolution` +
 * `refund` blocks for a partial-refund attendance resolution.
 *
 * Run from the repo root or backend/ folder. Idempotent: re-running replaces
 * the existing example with the canonical one rather than appending duplicates.
 *
 * After running, regenerate the ByFlow collection:
 *   node backend/scripts/reorganize-postman-flows.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const byTypePath = path.join(__dirname, '../../PickleCoach_API_ByType.postman_collection.json');

const collection = JSON.parse(fs.readFileSync(byTypePath, 'utf8'));

const EXAMPLE_NAME = '200 OK \u2014 Attendance partial refund';

const RESOLVE_REQUEST_BODY = JSON.stringify(
  {
    decision: 'partial',
    outcome: 'coach_no_show',
    financial_action: 'refund_student_partial',
    refund_amount: 20.0,
    resolution_notes: 'Coach was 35 minutes late; partial refund issued.',
  },
  null,
  2,
);

const RESOLVE_RESPONSE_BODY = {
  success: true,
  message: 'Dispute resolved successfully',
  data: {
    dispute: {
      id: 1,
      booking_id: 1,
      dispute_type_id: 1,
      notes: 'Coach no-show \u2014 waited 20 min',
      opened_by: 'student',
      status: 'resolved',
      resolution_action_id: 3,
      resolution_notes: 'Coach was 35 minutes late; partial refund issued.',
      decision: 'partial',
      outcome: 'coach_no_show',
      refund_amount: '20.00',
      penalize_role: 'none',
      resolved_at: '2026-05-14T17:30:00.000Z',
      escalated: false,
      escalated_to: null,
      escalation_triggered_at: null,
      stripe_dispute_id: null,
      stripe_dispute_status: null,
      opened_at: '2026-05-14T16:00:00.000Z',
      resolved_by_admin: { id: 10, full_name: 'Admin User' },
    },
    resolution: {
      decision: 'partial',
      financial_action: 'refund_student_partial',
      outcome: 'coach_no_show',
      derived_booking_status: 'coach_no_show',
    },
    refund: {
      queued: true,
      payment_action_id: 7,
      payment_id: 42,
      refund_amount: '20.00',
      refund_status: 'pending_stripe_execution',
      stripe_refund_id: null,
    },
  },
};

const exampleResponse = {
  name: EXAMPLE_NAME,
  originalRequest: {
    method: 'PUT',
    header: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: 'Bearer {{auth_token}}' },
    ],
    body: { mode: 'raw', raw: RESOLVE_REQUEST_BODY },
    url: {
      raw: '{{api_url}}/disputes/:id/resolve',
      host: ['{{api_url}}'],
      path: ['disputes', ':id', 'resolve'],
      variable: [{ key: 'id', value: '1' }],
    },
  },
  status: 'OK',
  code: 200,
  _postman_previewlanguage: 'json',
  header: [{ key: 'Content-Type', value: 'application/json' }],
  cookie: [],
  body: JSON.stringify(RESOLVE_RESPONSE_BODY),
};

const disputesFolder = collection.item.find((f) => f.name === 'Disputes');
if (!disputesFolder) {
  console.error('Could not find Disputes folder in ByType collection');
  process.exit(1);
}

const resolveItem = disputesFolder.item.find((it) => it.name === 'Resolve Dispute (Admin)');
if (!resolveItem) {
  console.error('Could not find "Resolve Dispute (Admin)" item in Disputes folder');
  process.exit(1);
}

if (!Array.isArray(resolveItem.response)) resolveItem.response = [];

const existingIdx = resolveItem.response.findIndex((r) => r.name === EXAMPLE_NAME);
if (existingIdx >= 0) {
  resolveItem.response[existingIdx] = exampleResponse;
  console.log(`Updated existing example: ${EXAMPLE_NAME}`);
} else {
  resolveItem.response.push(exampleResponse);
  console.log(`Added new example: ${EXAMPLE_NAME}`);
}

function escapeNonAscii(json) {
  return json.replace(/[\u0080-\uffff]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

fs.writeFileSync(
  byTypePath,
  escapeNonAscii(JSON.stringify(collection, null, '\t')) + '\n',
  'utf8',
);
console.log('Written:', byTypePath);
