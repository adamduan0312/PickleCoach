# PickleCoach Backend API

A comprehensive backend API for the PickleCoach platform built with Node.js, Express, and Sequelize.

## Features

- **User Management**: Registration, authentication, profile management
- **Coach Profiles**: Coach profiles, availability, ratings
- **Lessons**: Lesson creation, management, and booking
- **Bookings**: Booking system with rescheduling and cancellation
- **Payments**: Payment processing with escrow, commissions, and refunds
- **Reviews**: Student reviews and coach feedback
- **Messaging**: In-app messaging system
- **Disputes**: Dispute management and resolution
- **Notifications**: Notification system
- **Admin Dashboard**: Admin analytics and alerts
- **Reliability System**: User reliability scoring

## Project Structure

```
backend/
├── config/
│   ├── db.js              # MySQL connection pool
│   └── sequelize.js       # Sequelize configuration
├── controllers/           # Request handlers
│   ├── adminController.js
│   ├── authController.js
│   ├── bookingController.js
│   ├── coachController.js
│   ├── disputeController.js
│   ├── lessonController.js
│   ├── messageController.js
│   ├── notificationController.js
│   ├── paymentController.js
│   ├── rescheduleController.js
│   ├── reviewController.js
│   └── userController.js
├── middleware/
│   ├── auth.js            # Authentication & authorization
│   ├── errorHandler.js    # Error handling
│   └── validator.js       # Request validation
├── models/                # Sequelize models
│   ├── index.js           # Model associations
│   └── [Model].js         # Individual models
├── routes/                # API routes
│   ├── index.js           # Route aggregator
│   └── [Entity]Routes.js  # Entity-specific routes
├── services/              # Business logic
│   ├── bookingService.js
│   ├── notificationService.js
│   ├── paymentService.js
│   └── reliabilityService.js
├── utils/                 # Utility functions
│   ├── audit.js
│   ├── errors.js
│   ├── pagination.js
│   └── response.js
├── .gitignore
├── env.example
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
   cp env.example .env
   ```
   Update `.env` with your database credentials and JWT secret.

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

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get current user profile
- `PUT /api/auth/profile` - Update current user profile

### Users
- `GET /api/users` - Get all users (admin only)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user (admin only)
- `DELETE /api/users/:id` - Delete user (admin only)

### Coaches
- `GET /api/coaches` - Get all coaches
- `GET /api/coaches/:id` - Get coach by ID
- `POST /api/coaches/profile` - Create coach profile
- `PUT /api/coaches/profile/:id` - Update coach profile
- `POST /api/coaches/availability` - Create availability
- `GET /api/coaches/:id/availability` - Get coach availability

### Lessons
- `GET /api/lessons` - Get all lessons
- `GET /api/lessons/:id` - Get lesson by ID
- `POST /api/lessons` - Create lesson (coach only)
- `PUT /api/lessons/:id` - Update lesson
- `DELETE /api/lessons/:id` - Delete lesson

### Bookings
- `GET /api/bookings` - Get bookings
- `GET /api/bookings/:id` - Get booking by ID
- `POST /api/bookings` - Create booking
- `PUT /api/bookings/:id/status` - Update booking status
- `POST /api/bookings/:id/cancel` - Cancel booking

### Payments
- `GET /api/payments` - Get payments
- `GET /api/payments/:id` - Get payment by ID
- `POST /api/payments` - Create payment
- `PUT /api/payments/:id/status` - Update payment status (admin only)
- `POST /api/payments/:id/refund` - Process refund (admin only)

### Reschedules
- `GET /api/reschedules` - Get reschedule history
- `POST /api/reschedules/request` - Request reschedule
- `PUT /api/reschedules/:id/approve` - Approve reschedule

### Reviews
- `GET /api/reviews` - Get reviews
- `POST /api/reviews` - Create review
- `PUT /api/reviews/:id` - Update review
- `DELETE /api/reviews/:id` - Delete review

### Messages
- `GET /api/messages/conversations` - Get conversations
- `GET /api/messages/conversations/:id` - Get conversation by ID
- `POST /api/messages/conversations` - Create conversation
- `POST /api/messages/send` - Send message
- `PUT /api/messages/:id/read` - Mark message as read

### Disputes
- `GET /api/disputes` - Get disputes
- `GET /api/disputes/:id` - Get dispute by ID
- `POST /api/disputes` - Create dispute
- `PUT /api/disputes/:id/resolve` - Resolve dispute (admin only)

### Notifications
- `GET /api/notifications` - Get notifications
- `POST /api/notifications` - Create notification (admin only)
- `PUT /api/notifications/:id/read` - Mark notification as read

### Admin
- `GET /api/admin/dashboard` - Get dashboard stats (admin only)
- `GET /api/admin/alerts` - Get alerts (admin only)
- `PUT /api/admin/alerts/:id/resolve` - Resolve alert (admin only)

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
- Database models will auto-sync in development mode
- Use migrations for production database changes
