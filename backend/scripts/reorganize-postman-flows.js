#!/usr/bin/env node
/**
 * Reorganizes PickleCoach_API_ByType.postman_collection.json so that ALL endpoints
 * live inside one of the three flow folders (Admin, Coach, Student) in the
 * correct user-flow order. Removes standalone folders (Health Check, Auth, etc.).
 * Does not delete any endpoint — moves/copies each into the appropriate flow.
 *
 * Rule: Each endpoint appears only in flow folder(s) where that role is ALLOWED
 * to use it (no 403). E.g. Admin cannot use Add Role (self-service) or Delete My Account, so
 * those are only in Coach and Student flows. Coach cannot use List Coaches (Search)
 * or Create Booking, so those are only in Admin and Student flows. Student cannot
 * use explicit booking action endpoints (accept/decline/complete/student-no-show/cancel).
 *
 * ## String contract (By Type is canonical)
 *
 * - **PickleCoach_API_ByType.postman_collection.json** is the single source of truth for
 *   request bodies, URLs, and tests. **Folder name + request name** must match the
 *   tuples in `ADMIN_ORDER`, `COACH_ORDER`, and `STUDENT_ORDER` exactly (case-sensitive).
 * - **PickleCoach_API_ByFlow.postman_collection.json** is generated only by this script;
 *   do not hand-edit it (changes will be overwritten on `npm run postman:reorganize-flows`).
 * - Renaming a request in By Type without updating the `*_ORDER` arrays causes this script
 *   to **exit with code 1** (see `assertFlowOrdersResolvable`). Same for typos.
 * - One HTTP endpoint should exist **once** in By Type. If multiple flows need it, list the
 *   same `[folderName, requestName]` in each `*_ORDER` (optionally with a 4th element
 *   `displayName` for sidebar clarity). Use `applyDescriptionOverride` for per-flow copy only.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const byTypePath = path.join(__dirname, '../../PickleCoach_API_ByType.postman_collection.json');
const byFlowPath = path.join(__dirname, '../../PickleCoach_API_ByFlow.postman_collection.json');
const collection = JSON.parse(fs.readFileSync(byTypePath, 'utf8'));

// Build map: "FolderName|RequestName" -> full request item (name, request, response, event)
// ByType has folders: Health Check, Authentication, Coaches, Courts, etc.
const requestMap = new Map();
for (const folder of collection.item) {
  if (!folder.item || !Array.isArray(folder.item)) continue;
  const folderName = folder.name;
  for (const item of folder.item) {
    if (item.request) {
      requestMap.set(`${folderName}|${item.name}`, { ...item });
    }
  }
}

function getRequest(folderName, requestName) {
  const key = `${folderName}|${requestName}`;
  const found = requestMap.get(key);
  if (!found) {
    return null;
  }
  return JSON.parse(JSON.stringify(found));
}

/** Fail fast if any `*_ORDER` tuple does not resolve in By Type (prevents silent flow drops). */
function assertFlowOrdersResolvable() {
  const missing = [];
  const check = (label, entries) => {
    for (const entry of entries) {
      const [folderName, requestName] = entry;
      const key = `${folderName}|${requestName}`;
      if (!requestMap.has(key)) missing.push(`${label}: ${key}`);
    }
  };
  check('ADMIN_ORDER', ADMIN_ORDER);
  check('COACH_ORDER', COACH_ORDER);
  check('STUDENT_ORDER', STUDENT_ORDER);
  for (const [folderName, requestName] of REFERENCE_ITEMS) {
    const key = `${folderName}|${requestName}`;
    if (!requestMap.has(key)) missing.push(`REFERENCE_ITEMS: ${key}`);
  }
  if (missing.length) {
    console.error(
      'Postman: flow order references missing By Type requests. Fix folder/request names in reorganize-postman-flows.js or add the request to PickleCoach_API_ByType.postman_collection.json:\n',
    );
    for (const line of missing) console.error(' ', line);
    process.exit(1);
  }
}

/**
 * Each ORDER entry is a tuple:
 *   [folderName, requestName]                                  → auto-numbered
 *   [folderName, requestName, prefixOverride]                  → custom prefix (e.g. "10b")
 *   [folderName, requestName, prefixOverride, displayName]     → custom prefix + rename
 *
 * Custom-prefix entries do NOT consume a sequential counter slot, so the
 * surrounding items keep their natural numbering (e.g. "10", "10b", "11").
 */
function buildFlowFolder(name, description, order) {
  const items = [];
  let counter = 0;
  for (const entry of order) {
    const [folderName, requestName, prefixOverride, displayName] = entry;
    const req = getRequest(folderName, requestName);
    if (!req) {
      throw new Error(
        `Internal: missing By Type request after validation: ${folderName}|${requestName}`,
      );
    }
    let prefix;
    if (prefixOverride) {
      prefix = prefixOverride;
    } else {
      counter += 1;
      prefix = String(counter);
    }
    req.name = `${prefix}. ${displayName || requestName}`;
    items.push(req);
  }
  return { name, description, item: items };
}

/**
 * Build the top-level "Reference (Not for Manual Run)" folder for ByFlow.
 *
 * Pulls the documentation-only Stripe webhook from the ByType source
 * (folder: "Webhooks (Reference Only)" / request: "[DO NOT RUN] Stripe Webhook (POST /api/webhooks/stripe)")
 * and preserves its full name (no "1. " prefix) so the [DO NOT RUN] label
 * shows in the Postman sidebar.
 */
function buildReferenceFolder() {
  const items = [];
  for (const [sourceFolder, sourceName] of REFERENCE_ITEMS) {
    const req = getRequest(sourceFolder, sourceName);
    if (req) items.push(req); // keep original name (no renumbering)
  }
  return {
    name: 'Reference (Not for Manual Run)',
    description:
      "Endpoints documented here for visibility, but **not** part of any Postman flow. They cannot be exercised meaningfully from Postman (e.g. signed webhooks). See each request's description for how to trigger them via the appropriate tooling (Stripe CLI, Dashboard resend, etc.).",
    item: items,
  };
}

const REFERENCE_ITEMS = [
  ['Webhooks (Reference Only)', '[DO NOT RUN] Stripe Webhook (POST /api/webhooks/stripe)'],
];

// Order: [sourceFolderName, sourceRequestName]
const ADMIN_ORDER = [
  ['Health Check', 'Health Check'],
  ['Authentication', 'Login'],
  ['Authentication', 'Get Profile'],
  ['Authentication', 'Refresh Token'],
  ['Admin', 'Get Dashboard Stats'],
  ['Admin', 'Get Audit Logs'],
  ['Admin', 'Create Admin User'],
  ['Admin', 'Get All Users (Admin)'],
  ['Admin', 'Get User By ID (Admin)'],
  ['Admin', 'Update User (Admin)'],
  ['Admin', 'Get User Reliability (Admin Full Breakdown)', '10b', 'Get User Reliability (Admin)'],
  ['Admin', 'Adjust User Reliability'],
  ['Notifications', 'Create Notification (Admin)'],
  ['Admin', 'Get My Notifications'],
  ['Admin', 'Get Coach Courts (Admin)'],
  // Same canonical request as Coaches → Get Coach Availability (one definition in By Type).
  ['Coaches', 'Get Coach Availability', '14b', 'Get Coach Availability (Admin)'],
  ['Admin', 'Delete Coach Court (Admin)'],
  ['Admin', 'Delete Coach Availability (Admin)'],
  ['Admin', 'Delete User (Admin)'],
  ['Authentication', 'Register'],
  ['Authentication', 'Forgot Password'],
  ['Authentication', 'Reset Password'],
  ['Authentication', 'Update Profile'],
  ['Authentication', 'Change Password'],
  ['Authentication', 'Request Email Verification'],
  ['Authentication', 'Confirm Email Verification'],
  ['Authentication', 'Request Email Change'],
  ['Authentication', 'Confirm Email Change'],
  // Admin cannot use PUT /auth/me/role (self-service add role) or Delete My Account (403)
  ['Authentication', 'Logout'],
  ['Courts', 'List/Search Courts'],
  ['Courts', 'Get Court By ID'],
  ['Lessons', 'Get All Lessons (Filter by coach_id)'],
  ['Lessons', 'Get Lesson By ID'],
  ['Disputes', 'Get All Disputes'],
  ['Disputes', 'Get Dispute By ID'],
  ['Admin', 'Get Bookings (Admin)'],
  ['Admin', 'Get Booking By ID (Admin)'],
  ['Admin', 'Cancel Booking (Admin)'],
  ['Admin', 'Create Dispute (Admin)'],
  ['Admin', 'Mark Student No-Show (Admin)'],
  ['Admin', 'Mark Coach No-Show (Admin)'],
  ['Admin', 'Refund Booking (Admin)'],
  ['Disputes', 'Resolve Dispute (Admin)'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID', null, 'Get Payment By ID (Admin)'],
  // Note: Stripe Webhook is intentionally excluded from the Admin flow.
  // It lives in the top-level "Reference (Not for Manual Run)" folder
  // (built by buildReferenceFolder below) and cannot be tested from Postman
  // — use `stripe listen` or Dashboard "Resend" instead.
];

const COACH_ORDER = [
  ['Health Check', 'Health Check'],
  ['Authentication', 'Register'],
  ['Authentication', 'Login'],
  ['Authentication', 'Get Profile'],
  ['Coaches', 'Get Coach Reliability (Me - Full Breakdown)', '4b', 'Get My Coach Reliability'],
  ['Authentication', 'Update Profile'],
  ['Authentication', 'Request Email Verification'],
  ['Authentication', 'Confirm Email Verification'],
  ['Authentication', 'Change Password'],
  ['Authentication', 'Request Email Change'],
  ['Authentication', 'Confirm Email Change'],
  ['Authentication', 'Add Role (Self-Service)'],
  ['Coaches', 'Create Coach Profile'],
  ['Coaches', 'Update My Coach Profile'],
  ['Coaches', 'Create Availability'],
  ['Coaches', 'Get My Coach Availability'],
  ['Coaches', 'Update My Availability'],
  ['Coaches', 'Delete Availability'],
  ['Courts', 'List/Search Courts'],
  ['Courts', 'Get Court By ID'],
  ['Courts', 'Create Court'],
  ['Coaches', 'Add Court to Coach'],
  ['Coaches', 'List My Courts'],
  ['Coaches', 'Get My Lessons'],
  ['Coaches', 'Remove Court from Coach'],
  ['Coaches', 'Initiate Stripe Connect Onboarding'],
  ['Coaches', 'Get Stripe Connect Status'],
  ['Lessons', 'Get All Lessons (Filter by coach_id)'],
  ['Lessons', 'Get Lesson By ID'],
  ['Lessons', 'Create Lesson'],
  ['Lessons', 'Update Lesson'],
  ['Lessons', 'Delete Lesson'],
  ['Coaches', 'List My Coach Bookings (Coach Dashboard)'],
  ['Bookings', 'Get My Booking by ID'],
  ['Bookings', 'Accept Booking'],
  ['Bookings', 'Decline Booking'],
  ['Bookings', 'Cancel Booking'],
  ['Bookings', 'Complete Booking'],
  ['Bookings', 'Mark Student No-Show'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID', null, 'Get My Payment By ID'],
  ['Reviews', 'Get All Reviews'],
  ['Messages', 'Get Conversations'],
  ['Messages', 'Create Conversation'],
  ['Messages', 'Get Conversation By ID'],
  ['Messages', 'Send Message'],
  ['Disputes', 'Get All Disputes'],
  ['Disputes', 'Get Dispute By ID'],
  ['Disputes', 'Create Dispute'],
  ['Notifications', 'Get My Notifications'],
  ['Notifications', 'Mark Notification As Read'],
  ['Authentication', 'Forgot Password'],
  ['Authentication', 'Reset Password'],
  ['Authentication', 'Logout'],
  ['Authentication', 'Delete My Account'],
];

const STUDENT_ORDER = [
  ['Health Check', 'Health Check'],
  ['Authentication', 'Register'],
  ['Authentication', 'Login'],
  ['Authentication', 'Get Profile'],
  ['Students', 'Get Student Reliability (Me - Full Breakdown)', '4b', 'Get My Student Reliability'],
  ['Authentication', 'Update Profile'],
  ['Authentication', 'Request Email Verification'],
  ['Authentication', 'Confirm Email Verification'],
  ['Authentication', 'Change Password'],
  ['Authentication', 'Request Email Change'],
  ['Authentication', 'Confirm Email Change'],
  ['Authentication', 'Add Role (Self-Service)'],
  ['Coaches', 'List Coaches (Search)'],
  ['Coaches', 'Get Coach By ID'],
  ['Coaches', 'Get Coach Reliability (Score Only)', '13b', 'Get Coach Reliability (Student \u2014 detail)'],
  ['Coaches', 'Get Coach Courts'],
  ['Coaches', 'Get Coach Availability'],
  ['Courts', 'List/Search Courts'],
  ['Courts', 'Get Court By ID'],
  ['Lessons', 'Get All Lessons (Filter by coach_id)'],
  ['Lessons', 'Get Lesson By ID'],
  ['Bookings', 'Create Booking Intent'],
  ['Bookings', 'Confirm Booking'],
  ['Students', 'List My Student Bookings (Student Dashboard)', '22'],
  ['Bookings', 'Get My Booking by ID'],
  // Students do not get coach/admin booking override endpoints in flow ordering
  ['Bookings', 'Cancel Booking'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID', null, 'Get My Payment By ID'],
  ['Reviews', 'Get All Reviews'],
  ['Reviews', 'Create Review'],
  ['Reviews', 'Update Review'],
  ['Reviews', 'Delete Review'],
  ['Messages', 'Get Conversations'],
  ['Messages', 'Create Conversation'],
  ['Messages', 'Get Conversation By ID'],
  ['Messages', 'Send Message'],
  ['Disputes', 'Get All Disputes'],
  ['Disputes', 'Get Dispute By ID'],
  ['Disputes', 'Create Dispute'],
  ['Notifications', 'Get My Notifications'],
  ['Notifications', 'Mark Notification As Read'],
  ['Authentication', 'Forgot Password'],
  ['Authentication', 'Reset Password'],
  ['Authentication', 'Logout'],
  ['Authentication', 'Delete My Account'],
];

assertFlowOrdersResolvable();

const adminFolder = buildFlowFolder(
  '1 – Flow: Admin',
  'All admin endpoints in user-flow order. Run in sequence: Health → Login (admin) → Profile → Dashboard → Users → Payments → Disputes → Notifications → Coach support → Auth extras. See backend/POSTMAN_TESTING_GUIDE.md.\n\nNote: The Stripe webhook (`POST /api/webhooks/stripe`) is documentation-only and lives under the top-level **Reference (Not for Manual Run)** folder. It is intentionally excluded from this flow so the runner stays green end-to-end.',
  ADMIN_ORDER
);

const coachFolder = buildFlowFolder(
  '2 – Flow: Coach',
  'All coach endpoints in user-flow order. Run in sequence: Health → Register/Login → Profile → **GET /coaches/me/reliability** → Coach profile → Courts → Availability → Stripe Connect → Lessons → Bookings → Payments → **Get All Reviews** (read-only) → Messages → Disputes → Notifications → Auth extras. See backend/POSTMAN_TESTING_GUIDE.md.\n\nBooking MVP: student uses booking-intents + confirm; coach uses PUT .../accept or PUT .../decline only for pending requests (coach on that booking only). Schedule changes: cancel + book again (no reschedule API). Accept/decline/cancel notify the other party.\n\nReviews: coaches may **list** reviews (e.g. filter `target_user_id`); only the booking primary student creates/updates/deletes reviews — use **3 – Flow: Student** for those.',
  COACH_ORDER
);

const studentFolder = buildFlowFolder(
  '3 – Flow: Student',
  'All student endpoints in user-flow order. Run in sequence: Health → Register/Login → Profile → **GET /students/me/reliability** → Search coaches (each result includes **reliability** score) → Open coach (GET /coaches/:id, includes **reliability**) → Optional GET /coaches/:id/reliability → Get coach courts → Check availability → Create Booking Intent → Confirm Booking → Bookings → Payments → Reviews (create/update/delete after completed lesson) → Messages → Disputes → Notifications → Auth extras. See backend/POSTMAN_TESTING_GUIDE.md.\n\nBooking MVP: POST /booking-intents → Stripe authorize → POST /bookings/confirm creates a pending request; the coach accepts or declines with PUT .../accept | PUT .../decline. To change time: cancel this booking, then book again.',
  STUDENT_ORDER
);

const REGISTER_PASSWORD = 'Test1234!Ab';

const DEV_LOGINS = {
  admin: {
    email: 'admin.testflow@picklecoach.example.org',
    password: REGISTER_PASSWORD,
    fullName: 'Test Admin',
  },
  coach: {
    email: 'coach.testflow@picklecoach.example.org',
    password: REGISTER_PASSWORD,
    fullName: 'Test Coach',
  },
  student: {
    email: 'student.testflow@picklecoach.example.org',
    password: REGISTER_PASSWORD,
    fullName: 'Test Student',
  },
};

function registerBodyRaw(role) {
  const cfg = DEV_LOGINS[role] || DEV_LOGINS.student;
  return `{\n  "full_name": "${cfg.fullName}",\n  "email": "{{auth_email}}",\n  "password": "${REGISTER_PASSWORD}",\n  "role": "${role}",\n  "phone": "+1234567890",\n  "timezone": "America/New_York",\n  "avatar_url": ""\n}`;
}

const REGISTER_BODY_RAW = registerBodyRaw('student');

function registerPrerequestExec(role) {
  return [
    `pm.collectionVariables.set("register_role", "${role}");`,
    `pm.environment.set("register_role", "${role}");`,
    'const unique = Date.now().toString(36) + Math.floor(Math.random() * 10000).toString();',
    `const email = "${role}+" + unique + "@example.com";`,
    'pm.collectionVariables.set("auth_email", email);',
    'pm.environment.set("auth_email", email);',
  ];
}

function stripFlowPrefix(name) {
  return name.replace(/^\d+[a-zA-Z]?\.\s+/, '');
}

function applySeededLoginExample(flowFolder, role) {
  const cfg = DEV_LOGINS[role];
  const loginReq = flowFolder.item.find((it) => /\. Login$/.test(it.name));
  if (!loginReq?.request || !cfg) return;
  loginReq.request.body = {
    mode: 'raw',
    raw: `{\n  "email": "${cfg.email}",\n  "password": "${cfg.password}"\n}`,
  };
}

function applySeededRegisterExample(flowFolder, role) {
  const registerReq = flowFolder.item.find((it) => /\. Register$/.test(it.name));
  if (!registerReq?.request) return;
  registerReq.request.body = {
    mode: 'raw',
    raw: registerBodyRaw(role),
  };
  const pre = registerReq.event?.find((e) => e.listen === 'prerequest');
  if (pre?.script) {
    pre.script.exec = registerPrerequestExec(role);
  }
}

/**
 * Override request.description for a single item inside a flow folder,
 * matched by its display name (with or without the "N. " / "Nb. " prefix).
 *
 * Use for requests that are shared across multiple flows but need different
 * per-flow descriptions (e.g. `Get Profile` reads different reliability fields
 * depending on the caller's role).
 */
function applyDescriptionOverride(flowFolder, baseName, description) {
  const item = flowFolder.item.find((it) => stripFlowPrefix(it.name) === baseName);
  if (!item?.request) return;
  item.request.description = description;
}

applySeededLoginExample(adminFolder, 'admin');
applySeededLoginExample(coachFolder, 'coach');
applySeededLoginExample(studentFolder, 'student');

// Per-flow `Get Profile` descriptions. The single source request in the
// `Authentication` folder holds the general description; each flow tweaks it
// to mention the role-specific reliability fields visible in the response.
applyDescriptionOverride(
  adminFolder,
  'Get Profile',
  "Roles: Student, Coach, Admin. Get current authenticated user's profile."
);
applyDescriptionOverride(
  coachFolder,
  'Get Profile',
  "Roles: Student, Coach, Admin. Get current authenticated user's profile. Coaches may see `data.reliability`; users with both roles may also see `data.reliability_student`."
);
applyDescriptionOverride(
  studentFolder,
  'Get Profile',
  "Roles: Student, Coach, Admin. Get current authenticated user's profile. Students may see `data.reliability_student` when a student reliability row exists; dual-role users may also see coach `data.reliability`."
);
// Same cloned request as `Coaches/Get Coach Availability`; admin flow label is "(Admin)" for the sidebar only.
applyDescriptionOverride(
  adminFolder,
  'Get Coach Availability (Admin)',
  '**Admin flow** — uses the **same** By Type request as **Coaches → Get Coach Availability** (`GET /api/coaches/:id/availability`). Use an **admin** JWT to inspect a coach’s weekly windows (support). Effective roles must include **student** or **admin**; coach-only tokens get **403**. Path `:id` = coach user id (`{{coach_id}}`). Edit the canonical request under **Coaches** only so Student and Admin flows stay in sync.',
);
applyDescriptionOverride(
  adminFolder,
  'Get Payment By ID (Admin)',
  '**Admin flow** — same route as coach/student (`GET /api/payments/:id`). **Admin** may fetch any payment by ID. Path `:id` = payment row id; use `{{payment_id}}` from the previous **Get My Payments** step when available.',
);
applyDescriptionOverride(
  coachFolder,
  'Get My Payment By ID',
  '**Coach flow** — same route as admin (`GET /api/payments/:id`). Only payments where you are `coach_id` (or `student_id` if you have both roles). **403** if the ID is not one of your payments. Path `:id` = `{{payment_id}}` from **Get My Payments**.',
);
applyDescriptionOverride(
  studentFolder,
  'Get My Payment By ID',
  '**Student flow** — same route as admin (`GET /api/payments/:id`). Only payments where you are `student_id` (or `coach_id` if you have both roles). **403** if the ID is not one of your payments. Path `:id` = `{{payment_id}}` from **Get My Payments**.',
);
applySeededRegisterExample(adminFolder, 'admin');
applySeededRegisterExample(coachFolder, 'coach');
applySeededRegisterExample(studentFolder, 'student');

const referenceFolder = buildReferenceFolder();

const flowCollection = {
  ...collection,
  info: {
    ...collection.info,
    name: 'PickleCoach API (By Flow)',
    description: 'Endpoints grouped by user flow (Admin, Coach, Student). Run requests in order. See backend/POSTMAN_TESTING_GUIDE.md.',
  },
  item: [adminFolder, coachFolder, studentFolder, referenceFolder],
};

/**
 * Match canonical formatting: escape all non-ASCII chars as \uXXXX. Postman
 * itself reads either form transparently, but keeping the on-disk format
 * consistent makes git diffs reflect only intentional changes.
 */
function escapeNonAscii(json) {
  return json.replace(/[\u0080-\uffff]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

fs.writeFileSync(byFlowPath, escapeNonAscii(JSON.stringify(flowCollection, null, '\t')) + '\n', 'utf8');
console.log('Reorganized ByFlow collection from ByType: 3 flow folders + 1 reference folder.');
console.log('Admin:', adminFolder.item.length, 'requests');
console.log('Coach:', coachFolder.item.length, 'requests');
console.log('Student:', studentFolder.item.length, 'requests');
console.log('Reference (Not for Manual Run):', referenceFolder.item.length, 'requests');
