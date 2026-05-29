/**
 * Single source of truth for "what Sequelize thinks the DB looks like"
 * — built from `rawAttributes` + `field` overrides. Used by drift + field-usage scripts.
 *
 * **Rule:** At runtime, the **database** is authoritative for what exists; this map is the
 * **representation** we compare against (drift = DB columns vs this map).
 */

import {
  User,
  UserRole,
  CoachProfile,
  CoachAvailability,
  CourtLocation,
  CoachCourtLocation,
  Lesson,
  Booking,
  BookingPlayer,
  DisputeType,
  DisputeResolutionAction,
  Dispute,
  Payment,
  PaymentAction,
  RescheduleHistory,
  CancellationHistory,
  Payout,
  Review,
  UserReliability,
  Conversation,
  Message,
  WebhookLog,
  AuditLog,
  StudentFeedback,
  MessageTemplate,
  SystemJob,
  PromoCode,
  Notification,
} from '../models/index.js';

/** @typedef {{ attributeKey: string, dbColumn: string, typeLabel: string }} ColumnInfo */

function describeType(type) {
  if (!type) return 'unknown';
  const key = type.key || type.constructor?.name || 'unknown';
  if (type.options?.length != null) return `${key}(${type.options.length})`;
  return String(key);
}

/**
 * @param {import('sequelize').Model} Model
 * @returns {Record<string, ColumnInfo>}
 */
function columnsForModel(Model) {
  const out = {};
  if (!Model.rawAttributes) return out;
  for (const [attributeKey, def] of Object.entries(Model.rawAttributes)) {
    if (def.type?.constructor?.name === 'VIRTUAL') continue;
    const dbColumn = def.field != null ? def.field : attributeKey;
    out[dbColumn] = {
      attributeKey,
      dbColumn,
      typeLabel: describeType(def.type),
    };
  }
  return out;
}

/**
 * Sequelize models registered in `models/index.js` (excludes `sequelize` export).
 * @returns {{
 *   tables: Record<string, { modelName: string, columns: Record<string, ColumnInfo> }>,
 *   modelNameToTable: Record<string, string>,
 *   scanEntities: Array<{ modelName: string, tableName: string, Model: import('sequelize').Model, varPatterns: RegExp[] }>,
 * }}
 */
export function getSchemaMap() {
  const pairs = [
    ['User', User, [/\bUser\.(\w+)\b/g]],
    ['UserRole', UserRole, [/\bUserRole\.(\w+)\b/g, /\buserRole\.(\w+)\b/gi]],
    ['CoachProfile', CoachProfile, [/\bCoachProfile\.(\w+)\b/g, /\bcoachProfile\.(\w+)\b/gi]],
    [
      'CoachAvailability',
      CoachAvailability,
      [/\bCoachAvailability\.(\w+)\b/g, /\bavailability\.(\w+)\b/gi],
    ],
    ['CourtLocation', CourtLocation, [/\bCourtLocation\.(\w+)\b/g, /\bcourtLocation\.(\w+)\b/gi]],
    ['CoachCourtLocation', CoachCourtLocation, [/\bCoachCourtLocation\.(\w+)\b/g, /\bcoachCourtLocation\.(\w+)\b/gi]],
    ['Lesson', Lesson, [/\bLesson\.(\w+)\b/g, /\blesson\.(\w+)\b/gi]],
    ['Booking', Booking, [/\bBooking\.(\w+)\b/g, /\bbooking\.(\w+)\b/gi, /\blocked\.(\w+)\b/gi, /\bbookingPreview\.(\w+)\b/gi, /\bafterBooking\.(\w+)\b/gi]],
    ['BookingPlayer', BookingPlayer, [/\bBookingPlayer\.(\w+)\b/g, /\bbookingPlayer\.(\w+)\b/gi]],
    ['DisputeType', DisputeType, [/\bDisputeType\.(\w+)\b/g, /\bdisputeType\.(\w+)\b/gi]],
    ['DisputeResolutionAction', DisputeResolutionAction, [/\bDisputeResolutionAction\.(\w+)\b/g, /\bresolutionAction\.(\w+)\b/gi]],
    ['Dispute', Dispute, [/\bDispute\.(\w+)\b/g, /\bdispute\.(\w+)\b/gi]],
    ['Payment', Payment, [/\bPayment\.(\w+)\b/g, /\bpayment\.(\w+)\b/gi, /\bpayPre\.(\w+)\b/gi, /\bexistingPayment\.(\w+)\b/gi, /\bpaymentForAudit\.(\w+)\b/gi]],
    ['PaymentAction', PaymentAction, [/\bPaymentAction\.(\w+)\b/g, /\bpaymentAction\.(\w+)\b/gi]],
    ['RescheduleHistory', RescheduleHistory, [/\bRescheduleHistory\.(\w+)\b/g, /\brescheduleHistory\.(\w+)\b/gi]],
    ['CancellationHistory', CancellationHistory, [/\bCancellationHistory\.(\w+)\b/g, /\bcancellationHistory\.(\w+)\b/gi]],
    ['Payout', Payout, [/\bPayout\.(\w+)\b/g, /\bpayout\.(\w+)\b/gi]],
    ['Review', Review, [/\bReview\.(\w+)\b/g, /\breview\.(\w+)\b/gi]],
    ['UserReliability', UserReliability, [/\bUserReliability\.(\w+)\b/g, /\buserReliability\.(\w+)\b/gi]],
    ['Conversation', Conversation, [/\bConversation\.(\w+)\b/g, /\bconversation\.(\w+)\b/gi]],
    ['Message', Message, [/\bMessage\.(\w+)\b/g, /\bmessage\.(\w+)\b/gi]],
    ['WebhookLog', WebhookLog, [/\bWebhookLog\.(\w+)\b/g, /\bwebhookLog\.(\w+)\b/gi]],
    ['AuditLog', AuditLog, [/\bAuditLog\.(\w+)\b/g, /\bauditLog\.(\w+)\b/gi]],
    ['StudentFeedback', StudentFeedback, [/\bStudentFeedback\.(\w+)\b/g, /\bstudentFeedback\.(\w+)\b/gi]],
    ['MessageTemplate', MessageTemplate, [/\bMessageTemplate\.(\w+)\b/g, /\bmessageTemplate\.(\w+)\b/gi]],
    ['SystemJob', SystemJob, [/\bSystemJob\.(\w+)\b/g, /\bsystemJob\.(\w+)\b/gi]],
    ['PromoCode', PromoCode, [/\bPromoCode\.(\w+)\b/g, /\bpromoCode\.(\w+)\b/gi]],
    ['Notification', Notification, [/\bNotification\.(\w+)\b/g, /\bnotification\.(\w+)\b/gi]],
  ];

  const tables = {};
  const modelNameToTable = {};
  const scanEntities = [];

  for (const [modelName, Model, varPatterns] of pairs) {
    if (!Model?.tableName || !Model.rawAttributes) continue;
    const tableName = Model.tableName;
    tables[tableName] = {
      modelName,
      columns: columnsForModel(Model),
    };
    modelNameToTable[modelName] = tableName;
    scanEntities.push({ modelName, tableName, Model, varPatterns });
  }

  return { tables, modelNameToTable, scanEntities };
}
