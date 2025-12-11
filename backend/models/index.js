// Import sequelize from separate file to avoid circular dependencies
import { sequelize } from './sequelize.js';
export { sequelize };

// Import all models using dynamic imports to avoid circular dependency
// Models are imported after sequelize is created and exported
const UserModule = await import('./User.js');
const CoachProfileModule = await import('./CoachProfile.js');
const CoachAvailabilityModule = await import('./CoachAvailability.js');
const CourtLocationModule = await import('./CourtLocation.js');
const CoachCourtLocationModule = await import('./CoachCourtLocation.js');
const LessonModule = await import('./Lesson.js');
const BookingModule = await import('./Booking.js');
const BookingPlayerModule = await import('./BookingPlayer.js');
const DisputeTypeModule = await import('./DisputeType.js');
const DisputeResolutionActionModule = await import('./DisputeResolutionAction.js');
const DisputeModule = await import('./Dispute.js');
const PaymentModule = await import('./Payment.js');
const RescheduleHistoryModule = await import('./RescheduleHistory.js');
const CancellationHistoryModule = await import('./CancellationHistory.js');
const PayoutModule = await import('./Payout.js');
const ReviewModule = await import('./Review.js');
const UserReliabilityModule = await import('./UserReliability.js');
const PrebookingInquiryModule = await import('./PrebookingInquiry.js');
const ConversationModule = await import('./Conversation.js');
const MessageModule = await import('./Message.js');
const WebhookLogModule = await import('./WebhookLog.js');
const AuditLogModule = await import('./AuditLog.js');
const AdminAnalyticsModule = await import('./AdminAnalytics.js');
const AdminAlertModule = await import('./AdminAlert.js');
const CoachReportModule = await import('./CoachReport.js');
const StudentFeedbackModule = await import('./StudentFeedback.js');
const MessageTemplateModule = await import('./MessageTemplate.js');
const UserBadgeModule = await import('./UserBadge.js');
const SessionHistoryModule = await import('./SessionHistory.js');
const PromoCodeModule = await import('./PromoCode.js');
const SystemJobModule = await import('./SystemJob.js');
const NotificationModule = await import('./Notification.js');

// Extract default exports
const User = UserModule.default;
const CoachProfile = CoachProfileModule.default;
const CoachAvailability = CoachAvailabilityModule.default;
const CourtLocation = CourtLocationModule.default;
const CoachCourtLocation = CoachCourtLocationModule.default;
const Lesson = LessonModule.default;
const Booking = BookingModule.default;
const BookingPlayer = BookingPlayerModule.default;
const DisputeType = DisputeTypeModule.default;
const DisputeResolutionAction = DisputeResolutionActionModule.default;
const Dispute = DisputeModule.default;
const Payment = PaymentModule.default;
const RescheduleHistory = RescheduleHistoryModule.default;
const CancellationHistory = CancellationHistoryModule.default;
const Payout = PayoutModule.default;
const Review = ReviewModule.default;
const UserReliability = UserReliabilityModule.default;
const PrebookingInquiry = PrebookingInquiryModule.default;
const Conversation = ConversationModule.default;
const Message = MessageModule.default;
const WebhookLog = WebhookLogModule.default;
const AuditLog = AuditLogModule.default;
const AdminAnalytics = AdminAnalyticsModule.default;
const AdminAlert = AdminAlertModule.default;
const CoachReport = CoachReportModule.default;
const StudentFeedback = StudentFeedbackModule.default;
const MessageTemplate = MessageTemplateModule.default;
const UserBadge = UserBadgeModule.default;
const SessionHistory = SessionHistoryModule.default;
const PromoCode = PromoCodeModule.default;
const SystemJob = SystemJobModule.default;
const Notification = NotificationModule.default;

// Initialize User model (it uses initModel pattern)
User.initModel(sequelize);

// Define associations
// User associations
User.hasOne(CoachProfile, { foreignKey: 'user_id', as: 'coachProfile' });
User.hasMany(CoachAvailability, { foreignKey: 'coach_id', as: 'availabilities' });
User.hasMany(CoachCourtLocation, { foreignKey: 'coach_id', as: 'coachCourts' });
User.hasMany(CourtLocation, { foreignKey: 'created_by_user_id', as: 'createdCourts' });
User.hasMany(Lesson, { foreignKey: 'coach_id', as: 'lessons' });
User.hasMany(Booking, { foreignKey: 'coach_id', as: 'coachBookings' });
User.hasMany(Booking, { foreignKey: 'primary_student_id', as: 'studentBookings' });
User.hasMany(Payment, { foreignKey: 'coach_id', as: 'coachPayments' });
User.hasMany(Payment, { foreignKey: 'student_id', as: 'studentPayments' });
User.hasMany(Payout, { foreignKey: 'coach_id', as: 'payouts' });
User.hasMany(Review, { foreignKey: 'reviewer_id', as: 'reviewsGiven' });
User.hasMany(Review, { foreignKey: 'target_user_id', as: 'reviewsReceived' });
User.hasOne(UserReliability, { foreignKey: 'user_id', as: 'reliability' });
User.hasMany(PrebookingInquiry, { foreignKey: 'student_id', as: 'inquiriesSent' });
User.hasMany(PrebookingInquiry, { foreignKey: 'coach_id', as: 'inquiriesReceived' });
User.hasMany(Message, { foreignKey: 'sender_id', as: 'sentMessages' });
User.hasMany(Message, { foreignKey: 'receiver_id', as: 'receivedMessages' });
User.hasMany(AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
User.hasMany(StudentFeedback, { foreignKey: 'coach_id', as: 'feedbackGiven' });
User.hasMany(StudentFeedback, { foreignKey: 'student_id', as: 'feedbackReceived' });
User.hasMany(MessageTemplate, { foreignKey: 'owner_id', as: 'messageTemplates' });
User.hasMany(UserBadge, { foreignKey: 'user_id', as: 'badges' });
User.hasMany(SessionHistory, { foreignKey: 'student_id', as: 'studentSessions' });
User.hasMany(SessionHistory, { foreignKey: 'coach_id', as: 'coachSessions' });

// CoachProfile associations
CoachProfile.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// CoachAvailability associations
CoachAvailability.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });

// CourtLocation associations
CourtLocation.belongsTo(User, { foreignKey: 'created_by_user_id', as: 'createdBy' });
CourtLocation.hasMany(Booking, { foreignKey: 'court_location_id', as: 'bookings' });
CourtLocation.belongsToMany(User, { through: CoachCourtLocation, foreignKey: 'court_id', otherKey: 'coach_id', as: 'coaches' });

// CoachCourtLocation associations
CoachCourtLocation.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
CoachCourtLocation.belongsTo(CourtLocation, { foreignKey: 'court_id', as: 'court' });

// Lesson associations
Lesson.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
Lesson.hasMany(Booking, { foreignKey: 'lesson_id', as: 'bookings' });

// Booking associations
Booking.belongsTo(Lesson, { foreignKey: 'lesson_id', as: 'lesson' });
Booking.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
Booking.belongsTo(User, { foreignKey: 'primary_student_id', as: 'primaryStudent' });
Booking.belongsTo(CourtLocation, { foreignKey: 'court_location_id', as: 'courtLocation' });
Booking.hasMany(BookingPlayer, { foreignKey: 'booking_id', as: 'players' });
Booking.hasMany(Payment, { foreignKey: 'booking_id', as: 'payments' });
Booking.hasMany(RescheduleHistory, { foreignKey: 'booking_id', as: 'rescheduleHistory' });
Booking.hasMany(CancellationHistory, { foreignKey: 'booking_id', as: 'cancellationHistory' });
Booking.hasMany(Dispute, { foreignKey: 'booking_id', as: 'disputes' });
Booking.hasOne(Conversation, { foreignKey: 'booking_id', as: 'conversation' });
Booking.hasMany(Review, { foreignKey: 'booking_id', as: 'reviews' });
Booking.hasMany(StudentFeedback, { foreignKey: 'booking_id', as: 'feedback' });
Booking.hasOne(SessionHistory, { foreignKey: 'booking_id', as: 'sessionHistory' });

// BookingPlayer associations
BookingPlayer.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
BookingPlayer.belongsTo(User, { foreignKey: 'player_id', as: 'player' });

// Dispute associations
Dispute.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Dispute.belongsTo(DisputeType, { foreignKey: 'dispute_type_id', as: 'disputeType' });
Dispute.belongsTo(DisputeResolutionAction, { foreignKey: 'resolution_action_id', as: 'resolutionAction' });
Dispute.belongsTo(User, { foreignKey: 'admin_id', as: 'admin' });
Dispute.belongsTo(User, { foreignKey: 'escalated_to', as: 'escalatedTo' });
Dispute.hasOne(Payment, { foreignKey: 'dispute_id', as: 'payment' });

// Payment associations
Payment.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Payment.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
Payment.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
Payment.belongsTo(Dispute, { foreignKey: 'dispute_id', as: 'dispute' });
Payment.hasMany(Payout, { foreignKey: 'payment_id', as: 'payouts' });
Payment.hasMany(RescheduleHistory, { foreignKey: 'transaction_id', as: 'rescheduleTransactions' });
Payment.hasMany(CancellationHistory, { foreignKey: 'refund_payment_id', as: 'refundPayments' });

// RescheduleHistory associations
RescheduleHistory.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
RescheduleHistory.belongsTo(User, { foreignKey: 'approved_by', as: 'approver' });
RescheduleHistory.belongsTo(Payment, { foreignKey: 'transaction_id', as: 'transaction' });

// CancellationHistory associations
CancellationHistory.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
CancellationHistory.belongsTo(Payment, { foreignKey: 'refund_payment_id', as: 'refundPayment' });

// Payout associations
Payout.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
Payout.belongsTo(Payment, { foreignKey: 'payment_id', as: 'payment' });

// Review associations
Review.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Review.belongsTo(User, { foreignKey: 'reviewer_id', as: 'reviewer' });
Review.belongsTo(User, { foreignKey: 'target_user_id', as: 'targetUser' });

// UserReliability associations
UserReliability.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// PrebookingInquiry associations
PrebookingInquiry.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
PrebookingInquiry.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });

// Conversation associations
Conversation.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Conversation.hasMany(Message, { foreignKey: 'conversation_id', as: 'messages' });

// Message associations
Message.belongsTo(Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'receiver_id', as: 'receiver' });

// AdminAlert associations
AdminAlert.belongsTo(User, { foreignKey: 'related_user_id', as: 'relatedUser' });
AdminAlert.belongsTo(Booking, { foreignKey: 'related_booking_id', as: 'relatedBooking' });
AdminAlert.belongsTo(Payment, { foreignKey: 'related_payment_id', as: 'relatedPayment' });

// CoachReport associations
CoachReport.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });

// StudentFeedback associations
StudentFeedback.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
StudentFeedback.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });
StudentFeedback.belongsTo(User, { foreignKey: 'student_id', as: 'student' });

// MessageTemplate associations
MessageTemplate.belongsTo(User, { foreignKey: 'owner_id', as: 'owner' });

// UserBadge associations
UserBadge.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// SessionHistory associations
SessionHistory.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
SessionHistory.belongsTo(User, { foreignKey: 'student_id', as: 'student' });
SessionHistory.belongsTo(User, { foreignKey: 'coach_id', as: 'coach' });

// SystemJob associations
SystemJob.belongsTo(Booking, { foreignKey: 'related_booking_id', as: 'relatedBooking' });

// Notification associations
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

export {
  User,
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
  RescheduleHistory,
  CancellationHistory,
  Payout,
  Review,
  UserReliability,
  PrebookingInquiry,
  Conversation,
  Message,
  WebhookLog,
  AuditLog,
  AdminAnalytics,
  AdminAlert,
  CoachReport,
  StudentFeedback,
  MessageTemplate,
  UserBadge,
  SessionHistory,
  PromoCode,
  SystemJob,
  Notification,
};
