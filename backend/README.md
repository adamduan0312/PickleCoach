# PickleCoach Backend API

A comprehensive backend API for the PickleCoach platform built with Node.js, Express, and Sequelize.

## Features

- **User Management**: Registration, authentication, profile management
- **Coach Profiles**: Coach profiles, availability, ratings
- **Lessons**: Lesson creation, management, and booking
- **Bookings**: MVP create/accept/decline flow plus rescheduling and cancellation
- **Payments**: Payment processing with escrow, commissions, and refunds
- **Reviews**: Student reviews and coach feedback
- **Messaging**: In-app messaging system
- **Disputes**: Dispute management and resolution
- **Notifications**: Notification system
- **Admin Dashboard**: Admin analytics
- **Reliability System**: User reliability scoring

## Project Structure

```
backend/
├── config/
│   ├── config.json        # Sequelize CLI configuration
│   ├── logger.js          # Winston logger configuration
│   └── validation.js      # Joi validation schemas
├── controllers/           # Request handlers
│   ├── adminController.js
│   ├── authController.js
│   ├── bookingController.js
│   ├── coachController.js
│   ├── courtController.js
│   ├── disputeController.js
│   ├── lessonController.js
│   ├── messageController.js
│   ├── notificationController.js
│   ├── paymentController.js
│   ├── rescheduleController.js
│   ├── reviewController.js
│   ├── userController.js
│   └── webhookController.js
├── middleware/
│   ├── auth.js            # Authentication & authorization
│   ├── errorHandler.js    # Error handling
│   ├── rateLimiter.js     # Rate limiting
│   ├── requestId.js       # Request ID tracking
│   └── validator.js       # Request validation
├── migrations/            # Database migrations
│   └── [timestamp]-[name].cjs
├── models/                # Sequelize models
│   ├── index.js           # Model associations
│   ├── sequelize.js       # Sequelize instance
│   └── [Model].js         # Individual models (30 models)
├── routes/                # API routes
│   ├── index.js           # Route aggregator
│   └── [Entity]Routes.js  # Entity-specific routes
├── scripts/               # Utility scripts
│   ├── check-and-mark-migration.js
│   ├── compare-schema.js
│   └── fix-sequelize-meta.cjs
├── seeders/               # Database seeders
│   └── [timestamp]-[name].cjs
├── services/              # Business logic
│   ├── bookingService.js
│   ├── courtImportService.js
│   ├── notificationService.js
│   ├── paymentService.js
│   ├── reliabilityPenaltyService.js
│   ├── reliabilityService.js
│   └── stripeService.js
├── utils/                 # Utility functions
│   ├── audit.js
│   ├── errors.js
│   ├── pagination.js
│   └── response.js
├── workers/               # Background workers
│   ├── autoConfirmWorker.js
│   ├── chargePaidRescheduleWorker.js
│   ├── index.js
│   ├── payoutWorker.js
│   ├── reliabilityWorker.js
│   ├── reminderWorker.js
│   └── retryFailedPaymentsWorker.js
├── logs/                  # Application logs (gitignored)
├── .gitignore
├── env.development.example # Environment template
├── package.json
└── server.js              # Application entry point
```

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp env.development.example .env.development
   ```
   Update `.env.development` with your database credentials and JWT secret.
   
   **Note**: The application uses environment-specific `.env` files (e.g., `.env.development`, `.env.production`) based on `NODE_ENV`.

3. **Database Setup**
   - Create MySQL database using the provided SQL schema
   - Update database credentials in `.env`

4. **Run Application**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## API Endpoints

For a complete list of all API endpoints with detailed descriptions, see **[API_ENDPOINTS.md](./API_ENDPOINTS.md)**.

Quick reference:
- **Authentication**: `/api/auth` - Register, login, refresh token, profile management
- **Users**: `/api/users` - User management (admin only)
- **Coaches**: `/api/coaches` - Coach profiles, availability, Stripe Connect
- **Courts**: `/api/courts` - Court location search and management
- **Lessons**: `/api/lessons` - Lesson creation and management
- **Bookings**: `/api/bookings` - MVP: student `POST /bookings`, coach `PUT .../accept` | `PUT .../decline`; also list/detail, complete, `POST .../student-no-show`, cancel, reschedule
- **Payments**: `/api/payments` - List and get payment records (created with bookings; refunds via booking flows / `paymentService`)
- **Reschedules**: `/api/reschedules` - Reschedule history and requests
- **Reviews**: `/api/reviews` - Review system
- **Messages**: `/api/messages` - In-app messaging
- **Disputes**: `/api/disputes` - Dispute management
- **Notifications**: `/api/notifications` - Notification system
- **Admin**: `/api/admin` - Admin dashboard and management
- **Webhooks**: `/api/webhooks/stripe` - Stripe webhook handler

## Authentication

Most endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Error Handling

The API uses consistent error responses:

```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

## Database Models

All models are defined in the `models/` directory and include:
- User management
- Coach profiles and availability
- Lessons and bookings
- Payments and payouts
- Reviews and feedback
- Messaging system
- Disputes and resolution
- Notifications
- Admin analytics
- User reliability tracking

## Notes

- The application uses Sequelize ORM for database operations
- JWT tokens are used for authentication
- Password hashing uses bcryptjs
- All timestamps are handled automatically by Sequelize
- Database relationships are defined in `models/index.js`

## Development

- Use `npm run dev` for development with auto-reload
- Use migrations for all database schema changes (see [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md))
- Run seeders with `npm run db:seed` for demo data
- See [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for common migration workflows

## Documentation

Additional documentation files:
- **[API_ENDPOINTS.md](./API_ENDPOINTS.md)** - Complete API endpoint reference
- **[ADMIN_SETUP.md](./ADMIN_SETUP.md)** - Admin account setup guide
- **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Complete migration guide (setup, workflow, helper scripts)
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick command reference for migrations
- **[ENTERPRISE_ASSESSMENT.md](./ENTERPRISE_ASSESSMENT.md)** - Enterprise-level assessment
- **[SCHEMA_VERIFICATION-BEGINNING-0F-JAN-2026.md](./SCHEMA_VERIFICATION-BEGINNING-0F-JAN-2026.md)** - Schema verification report

