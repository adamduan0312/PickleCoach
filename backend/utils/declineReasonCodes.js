/** Coach decline reason codes — analytics/reporting only; human copy lives in message_to_student. */
export const DECLINE_REASON_CODES = [
  'availability_conflict',
  'sickness',
  'weather',
  'outside_service_area',
  'lesson_not_fit',
  'other',
];

/** Human labels for student-facing notifications and admin dashboards. */
export const DECLINE_REASON_LABELS = {
  availability_conflict: 'Availability conflict',
  sickness: 'Sickness',
  weather: 'Weather',
  outside_service_area: 'Outside service area',
  lesson_not_fit: 'Lesson not a good fit',
  other: 'Other',
};

export const getValidDeclineReasonCodes = () => [...DECLINE_REASON_CODES];

export const isValidDeclineReasonCode = (code) => DECLINE_REASON_CODES.includes(code);

export const formatDeclineReasonLabel = (code) =>
  code ? (DECLINE_REASON_LABELS[code] || code) : null;
