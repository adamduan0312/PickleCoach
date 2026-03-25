#!/usr/bin/env node
/**
 * Reorganizes PickleCoach_API_ByType.postman_collection.json so that ALL endpoints
 * live inside one of the three flow folders (Admin, Coach, Student) in the
 * correct user-flow order. Removes standalone folders (Health Check, Auth, etc.).
 * Does not delete any endpoint — moves/copies each into the appropriate flow.
 *
 * Rule: Each endpoint appears only in flow folder(s) where that role is ALLOWED
 * to use it (no 403). E.g. Admin cannot use Switch Role or Delete My Account, so
 * those are only in Coach and Student flows. Coach cannot use List Coaches (Search)
 * or Create Booking, so those are only in Admin and Student flows. Student cannot
 * use Update Booking Status (coach/admin only), so it is only in Admin and Coach flows.
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
    console.warn(`Missing: ${folderName} -> ${requestName}`);
    return null;
  }
  return JSON.parse(JSON.stringify(found));
}

function buildFlowFolder(name, description, order) {
  const items = [];
  order.forEach(([folderName, requestName], index) => {
    const req = getRequest(folderName, requestName);
    if (req) {
      req.name = `${index + 1}. ${requestName}`;
      items.push(req);
    }
  });
  return { name, description, item: items };
}

// Order: [sourceFolderName, sourceRequestName]
const ADMIN_ORDER = [
  ['Health Check', 'Health Check'],
  ['Authentication', 'Login'],
  ['Authentication', 'Get Profile'],
  ['Authentication', 'Refresh Token'],
  ['Admin', 'Get Dashboard Stats'],
  ['Admin', 'Get Audit Logs'],
  ['Admin', 'Get Alerts'],
  ['Admin', 'Resolve Alert'],
  ['Admin', 'Create Admin User'],
  ['Admin', 'Get All Users (Admin)'],
  ['Admin', 'Get User By ID (Admin)'],
  ['Admin', 'Update User (Admin)'],
  ['Admin', 'Adjust User Reliability'],
  ['Payments', 'Create Payment (Admin)'],
  ['Payments', 'Process Refund (Admin)'],
  ['Payments', 'Update Payment Status (Admin)'],
  ['Disputes', 'Resolve Dispute (Admin)'],
  ['Notifications', 'Create Notification (Admin)'],
  ['Admin', 'Get Coach Courts (Admin)'],
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
  // Admin cannot use Switch Role or Delete My Account (403)
  ['Authentication', 'Logout'],
  ['Courts', 'Get All Courts'],
  ['Courts', 'Get Court By ID'],
  ['Lessons', 'Get All Lessons'],
  ['Lessons', 'Get Lesson By ID'],
  ['Disputes', 'Get All Disputes'],
  ['Disputes', 'Get Dispute By ID'],
  ['Bookings', 'Accept Booking'],
  ['Bookings', 'Decline Booking'],
  ['Bookings', 'Update Booking Status'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID'],
  ['Webhooks', 'Stripe Webhook'],
];

const COACH_ORDER = [
  ['Health Check', 'Health Check'],
  ['Authentication', 'Register'],
  ['Authentication', 'Login'],
  ['Authentication', 'Get Profile'],
  ['Authentication', 'Update Profile'],
  ['Authentication', 'Request Email Verification'],
  ['Authentication', 'Confirm Email Verification'],
  ['Authentication', 'Change Password'],
  ['Authentication', 'Request Email Change'],
  ['Authentication', 'Confirm Email Change'],
  ['Authentication', 'Switch Role (Student ↔ Coach)'],
  ['Coaches', 'Create Coach Profile'],
  ['Coaches', 'Update Coach Profile'],
  ['Coaches', 'Get Coach Availability'],
  ['Coaches', 'Create Availability'],
  ['Coaches', 'Delete Availability'],
  ['Courts', 'Get All Courts'],
  ['Courts', 'Get Court By ID'],
  ['Courts', 'Create Court'],
  ['Courts', 'Delete Court'],
  ['Coaches', 'Add Court to Coach'],
  ['Coaches', 'List My Courts'],
  ['Coaches', 'Remove Court from Coach'],
  ['Coaches', 'Initiate Stripe Connect Onboarding'],
  ['Coaches', 'Get Stripe Connect Status'],
  ['Lessons', 'Get All Lessons'],
  ['Lessons', 'Get Lesson By ID'],
  ['Lessons', 'Create Lesson'],
  ['Lessons', 'Update Lesson'],
  ['Lessons', 'Delete Lesson'],
  ['Bookings', 'Get My Bookings'],
  ['Bookings', 'Get Booking By ID'],
  ['Bookings', 'Accept Booking'],
  ['Bookings', 'Decline Booking'],
  ['Bookings', 'Update Booking Status'],
  ['Bookings', 'Cancel Booking'],
  ['Bookings', 'Request Reschedule'],
  ['Reschedules', 'Get Reschedule History'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID'],
  ['Reviews', 'Get All Reviews'],
  ['Reviews', 'Create Review'],
  ['Reviews', 'Update Review'],
  ['Reviews', 'Delete Review'],
  ['Messages', 'Get Conversations'],
  ['Messages', 'Create Conversation'],
  ['Messages', 'Get Conversation By ID'],
  ['Messages', 'Send Message'],
  ['Messages', 'Mark Message As Read'],
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
  ['Authentication', 'Update Profile'],
  ['Authentication', 'Request Email Verification'],
  ['Authentication', 'Confirm Email Verification'],
  ['Authentication', 'Change Password'],
  ['Authentication', 'Request Email Change'],
  ['Authentication', 'Confirm Email Change'],
  ['Authentication', 'Switch Role (Student ↔ Coach)'],
  ['Coaches', 'List Coaches (Search)'],
  ['Coaches', 'Get Coach By ID'],
  ['Coaches', 'Get Coach Courts'],
  ['Coaches', 'Get Coach Availability'],
  ['Courts', 'Get All Courts'],
  ['Courts', 'Get Court By ID'],
  ['Lessons', 'Get All Lessons'],
  ['Lessons', 'Get Lesson By ID'],
  ['Bookings', 'Create Booking'],
  ['Bookings', 'Get My Bookings'],
  ['Bookings', 'Get Booking By ID'],
  // Update Booking Status is coach/admin only; student gets 403
  ['Bookings', 'Cancel Booking'],
  ['Bookings', 'Request Reschedule'],
  ['Reschedules', 'Get Reschedule History'],
  ['Payments', 'Get My Payments'],
  ['Payments', 'Get Payment By ID'],
  ['Reviews', 'Get All Reviews'],
  ['Reviews', 'Create Review'],
  ['Reviews', 'Update Review'],
  ['Reviews', 'Delete Review'],
  ['Messages', 'Get Conversations'],
  ['Messages', 'Create Conversation'],
  ['Messages', 'Get Conversation By ID'],
  ['Messages', 'Send Message'],
  ['Messages', 'Mark Message As Read'],
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

const adminFolder = buildFlowFolder(
  '1 – Flow: Admin',
  'All admin endpoints in user-flow order. Run in sequence: Health → Login (admin) → Profile → Dashboard → Users → Payments → Disputes → Notifications → Coach support → Auth extras → Webhook. See backend/POSTMAN_TESTING_GUIDE.md.',
  ADMIN_ORDER
);

const coachFolder = buildFlowFolder(
  '2 – Flow: Coach',
  'All coach endpoints in user-flow order. Run in sequence: Health → Register/Login → Profile → Coach profile → Courts → Availability → Stripe Connect → Lessons → Bookings → Payments → Reviews → Messages → Disputes → Notifications → Auth extras. See backend/POSTMAN_TESTING_GUIDE.md.',
  COACH_ORDER
);

const studentFolder = buildFlowFolder(
  '3 – Flow: Student',
  'All student endpoints in user-flow order. Run in sequence: Health → Register/Login → Profile → Search coaches → Open coach (GET /coaches/:id) → Get coach courts (GET /coaches/:id/courts) → Check availability (GET /coaches/:id/availability) → Create Booking → Bookings → Payments → Reviews → Messages → Disputes → Notifications → Auth extras. See backend/POSTMAN_TESTING_GUIDE.md.',
  STUDENT_ORDER
);

const flowCollection = {
  ...collection,
  info: {
    ...collection.info,
    name: 'PickleCoach API (By Flow)',
    description: 'Endpoints grouped by user flow (Admin, Coach, Student). Run requests in order. See backend/POSTMAN_TESTING_GUIDE.md.',
  },
  item: [adminFolder, coachFolder, studentFolder],
};

fs.writeFileSync(byFlowPath, JSON.stringify(flowCollection, null, '\t'), 'utf8');
console.log('Reorganized ByFlow collection from ByType: only 3 flow folders, all endpoints inside in order.');
console.log('Admin:', adminFolder.item.length, 'requests');
console.log('Coach:', coachFolder.item.length, 'requests');
console.log('Student:', studentFolder.item.length, 'requests');
