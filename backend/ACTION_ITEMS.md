# Action Items: From Setup to Production

This document outlines all the steps needed to get your PickleCoach backend from the current state to testing and then to production.

---

## Recent Improvements (Jan 2026)

The following changes are already in the codebase; ensure migrations are run and docs are used as needed:

- **Password reset flow:** `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` are implemented. Run the password-reset migration if you haven’t (see Phase 1 Step 2).
- **Logging:** Controllers use the configured logger instead of `console.error`.
- **Request validation:** All relevant POST/PUT endpoints use Joi body validation; GET endpoints with query params use `validateQuery`. See `config/validation.js` and `middleware/validator.js`.
- **Error responses:** Consistent format (e.g. 404, validation errors). See the "Error Responses" section in `API_ENDPOINTS.md`.
- **Graceful shutdown:** Server closes HTTP connections before closing the database.

**Docs:** Full API details (including error responses) → `API_ENDPOINTS.md`. Postman and full setup → `PICKLECOACH_API_AND_SETUP_GUIDE.md` (project root).

## Phase 1: Initial Setup & Testing (Development)

### ✅ Step 1: Environment Configuration ✅ DONE

1. **Create `.env.development` file** ✅ Already created
   ```bash
   cd backend
   cp env.development.example .env.development
   ```

2. **Update `.env.development` with required values:**
   - `JWT_SECRET`: Generate a secure random string (minimum 32 characters) ⚠️ **VERIFY THIS IS SET**
     ```bash
     # Generate a secure JWT secret (run this command if needed)
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `DB_PASSWORD`: Your MySQL password (from config.json or set your own) ⚠️ **VERIFY THIS IS SET**
   - `PORT`: 4000 (default, or your preferred port)
   - `FRONTEND_URL`: http://localhost:3000 (or your frontend URL)

3. **Optional but recommended for testing:**
   - `LOG_LEVEL`: Set to `debug` for more detailed logs during development

### ✅ Step 2: Database Setup (Schema Already Created)

**Since you created the schema in MySQL Workbench first, then wrote migrations, you should NOT run `npm run db:migrate`. Instead:**

1. **Verify database and schema exist** ✅ Already done
   - Your database `picklecoach_development` exists
   - All tables have been created from your SQL schema

2. **Mark migrations as executed** ⚠️ **DO THIS NOW**
   
   Since you created the schema first, you need to mark the initial migration as executed so Sequelize knows the schema is up to date:
   
   ```bash
   node scripts/check-and-mark-migration.js
   ```
   
   This script will:
   - Verify all expected tables exist in your database
   - Mark the initial migration (`20260101171440-initial-schema.cjs`) as executed in `SequelizeMeta` table
   - Allow future migrations to run normally
   
   **Important:** This is a one-time step. After this, you can use normal migration workflow for any new schema changes.

3. **Run any new migrations** (e.g. password reset fields, email verification + token versioning):
   After the initial schema is marked, run new migrations normally:
   ```bash
   npm run db:migrate
   ```
   This applies migrations such as:
   - `20260126120000-add-password-reset-fields.cjs` (adds `password_reset_token`, `password_reset_expires` to users).
   - `20260224180000-add-email-and-token-version-fields.cjs` (adds `token_version`, `email_verified_at`, email verification/change tokens and fields to users).
   
4. **Handle the fix migration** (if needed)
   
   If you have the second migration file (`20260105172550-fix-foreign-keys-and-fulltext-index.cjs`), you may need to:
   
   ```bash
   # Check if fix migration needs to be run or marked
   # If the fixes are already in your schema, mark it as executed too
   node scripts/fix-sequelize-meta.cjs
   ```

5. **(Optional) Seed demo data**
   ```bash
   npm run db:seed
   ```
   This creates sample data for testing.

### ✅ Step 3: Install Dependencies (if not done)

```bash
npm install
```

### ✅ Step 4: Start the Server

```bash
npm run dev
```

The server should start on `http://localhost:4000`. You should see:
- ✅ Database connection established
- ✅ API listening on http://localhost:4000
- ✅ Background workers started

**Test the health endpoint:**
```bash
curl http://localhost:4000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "...",
  "database": "connected",
  "uptime": ...
}
```

### ✅ Step 5: Create First Admin Account

You need to create an admin account manually (see `ADMIN_SETUP.md` for details).

**Option A: Using Node.js script** (Recommended)
```bash
# Make sure your database is running first!
# Then create the admin user:
cd backend
node scripts/create-first-admin.js adamduan0312@gmail.com "03122003" "Adam Duan"

# Verify the user was created:
node scripts/test-login.js adamduan0312@gmail.com "03122003"
```

**Option B: Direct SQL**
```sql
-- First, generate a bcrypt hash for your password
-- Use: node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('yourpassword', 10).then(h => console.log(h))"

INSERT INTO users (full_name, email, password_hash, role, is_active, created_at, updated_at)
VALUES (
  'Admin User',
  'admin@picklecoach.com',
  '$2a$10$...your_bcrypt_hash_here...',
  'admin',
  1,
  NOW(),
  NOW()
);
```

### ✅ Step 6: Postman Testing Setup

1. **Create a Postman Collection**
   - Import or create a new collection called "PickleCoach API"
   - Set collection variable: `base_url` = `http://localhost:4000`

2. **Test Authentication Endpoints First:**
   - `POST /api/auth/register` - Register a test student
   - `POST /api/auth/register` - Register a test coach
   - `POST /api/auth/login` - Login as student
   - `POST /api/auth/login` - Login as coach
   - `POST /api/auth/login` - Login as admin
   - `POST /api/auth/forgot-password` - Request password reset (body: `{ "email": "..." }`)
   - `POST /api/auth/reset-password` - Reset password with token (body: `{ "token": "...", "password": "..." }`)
   - `POST /api/auth/verify-email/request` - Send verification email for the logged-in user
   - `POST /api/auth/verify-email/confirm` - Confirm email verification with token (body: `{ "token": \"...\" }`)
   - `PUT /api/auth/change-password` - Change password using current_password + new_password
   - `POST /api/auth/change-email/request` - Start 2-step email change flow (body: `{ "new_email": \"...\", "password": \"current_password\" }`)
   - `POST /api/auth/change-email/confirm` - Confirm email change with token (body: `{ "token": \"...\" }`)

3. **Save tokens as environment variables:**
   - Create Postman environment: "PickleCoach Dev"
   - Variables:
     - `base_url`: `http://localhost:4000`
     - `student_token`: (from student login)
     - `coach_token`: (from coach login)
     - `admin_token`: (from admin login)

4. **Test Core Endpoints (after verifying email for the test account):**
   - Health check: `GET /health`
   - User profile: `GET /api/auth/profile` (with token)
   - Coach endpoints: `GET /api/coaches`, `POST /api/coaches/profile`
   - Lesson endpoints: `POST /api/lessons`, `GET /api/lessons`
   - Booking endpoints: `POST /api/bookings`, `GET /api/bookings`

5. **Test with Authentication:**
   - Add header to requests: `Authorization: Bearer {{student_token}}`
   - Test protected endpoints

### ✅ Step 7: Add Third-Party Service Variables (For Full Testing)

#### Stripe Setup (Required for Payment Processing)

1. **Create Stripe Account:**
   - Go to https://stripe.com
   - Sign up for a test account
   - Get your test API keys from Dashboard → Developers → API keys

2. **Add to `.env.development`:**
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...  # Get this after setting up webhook endpoint
   STRIPE_CONNECT_RETURN_URL=http://localhost:3000/coach/onboarding/return
   STRIPE_CONNECT_REFRESH_URL=http://localhost:3000/coach/onboarding/refresh
   ```

3. **Set up Stripe Webhook (for local testing):**
   - Install Stripe CLI: https://stripe.com/docs/stripe-cli
   - Forward webhooks to local server:
     ```bash
     stripe listen --forward-to localhost:4000/api/webhooks/stripe
     ```
   - Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

4. **Test Stripe Integration:**
   - Test coach Stripe Connect onboarding
   - Test payment creation
   - Test webhook handling

#### SendGrid Setup (For Email Notifications)

1. **Create SendGrid Account:**
   - Go to https://sendgrid.com
   - Sign up for free account (100 emails/day free tier)
   - Verify your sender email address

2. **Get API Key:**
   - Go to Settings → API Keys
   - Create API Key with "Full Access" or "Mail Send" permissions
   - Copy the API key (starts with `SG.`)

3. **Add to `.env.development`:**
   ```env
   SENDGRID_API_KEY=SG....
   SENDGRID_FROM_EMAIL=noreply@picklecoach.com  # Use your verified email
   ```

4. **Test Email Sending:**
   - Create a booking to trigger reminder emails
   - Check SendGrid dashboard for email delivery status

#### Twilio Setup (For SMS Notifications)

1. **Create Twilio Account:**
   - Go to https://www.twilio.com
   - Sign up for free trial account
   - Get $15.50 credit for testing

2. **Get Credentials:**
   - Account SID (starts with `AC`)
   - Auth Token
   - Phone Number (get a trial number from Twilio console)

3. **Add to `.env.development`:**
   ```env
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number
   ```

4. **Test SMS Sending:**
   - Create notifications with SMS channel
   - Verify SMS delivery in Twilio console

### ✅ Step 8: Redis Setup (Optional but Recommended)

**Note:** Redis is used by BullMQ for background job processing. Currently, workers use node-cron, but Redis is in dependencies for future use.

1. **Install Redis:**
   ```bash
   # macOS
   brew install redis
   brew services start redis

   # Or use Docker
   docker run -d -p 6379:6379 redis:latest
   ```

2. **Add Redis config to `.env.development` (if needed in future):**
   ```env
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=  # Optional
   ```

3. **Test Redis connection:**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

---

## Phase 2: Production Preparation

### ✅ Step 9: Production Environment Configuration

1. **Create `.env.production` file:**
   ```bash
   cp env.development.example .env.production
   ```

2. **Update production values:**
   - `NODE_ENV=production`
   - `PORT`: Your production port (e.g., 4000 or 8080)
   - `FRONTEND_URL`: Your production frontend URL
   - `DB_HOST`: Production database host
   - `DB_NAME`: Production database name
   - `DB_USER`: Production database user
   - `DB_PASSWORD`: Production database password (use secure secret management)
   - `JWT_SECRET`: **Generate a new, strong secret for production**
   - `LOG_LEVEL`: `info` or `warn` (not `debug`)

3. **Production Stripe Keys:**
   - Switch from test keys to live keys
   - Update `STRIPE_SECRET_KEY` with live key (starts with `sk_live_`)
   - Set up production webhook endpoint
   - Update `STRIPE_WEBHOOK_SECRET` with production webhook secret

4. **Production SendGrid:**
   - Use production API key
   - Update `SENDGRID_FROM_EMAIL` to your production email
   - Verify domain (recommended for production)

5. **Production Twilio:**
   - Upgrade from trial to paid account
   - Use production phone number
   - Update all Twilio credentials

### ✅ Step 10: Database Production Setup

1. **Create production database:**
   ```sql
   CREATE DATABASE picklecoach_production;
   ```

2. **Update `config/config.json` production settings:**
   - Update host, username, password, database name
   - **IMPORTANT:** Don't commit passwords to git! Use environment variables or secret management

3. **Run migrations in production:**
   ```bash
   NODE_ENV=production npm run db:migrate
   ```

4. **Set up database backups:**
   - Configure automated daily backups
   - Test restore procedure

### ✅ Step 11: Security Hardening

1. **Environment Variables:**
   - ✅ Never commit `.env` files to git (check `.gitignore`)
   - ✅ Use secret management service (AWS Secrets Manager, HashiCorp Vault, etc.)
   - ✅ Rotate JWT_SECRET periodically
   - ✅ Use different secrets for each environment

2. **Database Security:**
   - ✅ Use strong database passwords
   - ✅ Limit database user permissions (not root)
   - ✅ Enable SSL for database connections (if supported)
   - ✅ Restrict database access to application server only

3. **API Security:**
   - ✅ Update CORS to only allow your frontend domain
   - ✅ Enable rate limiting (already implemented)
   - ✅ Use HTTPS in production
   - ✅ Set secure cookie flags if using cookies

4. **Dependencies:**
   ```bash
   # Check for vulnerabilities
   npm audit
   npm audit fix
   ```

### ✅ Step 12: Monitoring & Logging

1. **Set up Application Monitoring:**
   - Consider services like:
     - Sentry (error tracking)
     - New Relic (APM)
     - Datadog (full-stack monitoring)
     - LogRocket (session replay)

2. **Log Management:**
   - Set up log aggregation (ELK stack, CloudWatch, etc.)
   - Configure log rotation
   - Set up alerts for errors

3. **Health Checks:**
   - Use `/health` endpoint for load balancer health checks
   - Set up uptime monitoring (UptimeRobot, Pingdom, etc.)

### ✅ Step 13: Deployment Checklist

1. **Server Setup:**
   - [ ] Choose hosting provider (AWS, Heroku, DigitalOcean, etc.)
   - [ ] Set up Node.js runtime environment
   - [ ] Configure process manager (PM2, systemd, etc.)
   - [ ] Set up reverse proxy (Nginx, Apache)
   - [ ] Configure SSL certificate (Let's Encrypt)

2. **Application Deployment:**
   - [ ] Set up CI/CD pipeline (GitHub Actions, GitLab CI, etc.)
   - [ ] Configure environment variables on server
   - [ ] Deploy application code
   - [ ] Run database migrations
   - [ ] Start application server
   - [ ] Verify health endpoint

3. **Post-Deployment:**
   - [ ] Test all critical endpoints
   - [ ] Verify Stripe webhooks are working
   - [ ] Test email delivery
   - [ ] Test SMS delivery
   - [ ] Monitor error logs
   - [ ] Set up automated backups

### ✅ Step 14: Performance Optimization

1. **Database:**
   - [ ] Add database indexes (check migration files)
   - [ ] Set up connection pooling (already configured)
   - [ ] Enable query caching if needed
   - [ ] Monitor slow queries

2. **Application:**
   - [ ] Enable compression (already enabled)
   - [ ] Set up Redis caching (optional)
   - [ ] Configure CDN for static assets (if any)
   - [ ] Optimize worker schedules

3. **Scaling:**
   - [ ] Plan for horizontal scaling (multiple instances)
   - [ ] Set up load balancer
   - [ ] Configure Redis for distributed rate limiting
   - [ ] Set up database read replicas (if needed)

---

## Quick Reference Commands

### Development
```bash
# Start development server
npm run dev

# Run migrations
npm run db:migrate

# Undo last migration
npm run db:migrate:undo

# Seed database
npm run db:seed

# Check health
curl http://localhost:4000/health
```

### Production
```bash
# Start production server
NODE_ENV=production npm start

# Run migrations in production
NODE_ENV=production npm run db:migrate

# Check for vulnerabilities
npm audit
npm audit fix
```

---

## Testing Checklist

### Basic Functionality
- [ ] Server starts without errors
- [ ] Database connection works
- [ ] Health endpoint returns OK
- [ ] User registration works
- [ ] User login works
- [ ] Forgot-password sends email (or returns success message); reset-password works with token
- [ ] JWT tokens are generated correctly
- [ ] Protected routes require authentication
- [ ] Admin routes require admin role

### Payment Integration
- [ ] Stripe Connect onboarding works
- [ ] Payment creation works
- [ ] Webhook handling works
- [ ] Refunds work correctly

### Notifications
- [ ] Email notifications send (SendGrid)
- [ ] SMS notifications send (Twilio)
- [ ] Reminder notifications trigger correctly

### Background Workers
- [ ] Reminder worker runs
- [ ] Auto-confirm worker runs
- [ ] Payout worker runs
- [ ] Reliability worker runs

---

## Common Issues & Solutions

### Issue: "JWT_SECRET must be at least 32 characters"
**Solution:** Generate a longer secret using the command in Step 1.

### Issue: "Database connection failed"
**Solution:** 
- Check MySQL is running
- Verify database credentials in `.env.development` or `config.json`
- Ensure database exists

### Issue: "Migration already exists" or "Tables already exist"
**Solution:** 
- If you created the schema first (like you did), DON'T run `npm run db:migrate` 
- Instead, run `node scripts/check-and-mark-migration.js` to mark existing migrations as executed
- Check `SequelizeMeta` table in database to see what's already marked

### Issue: "SendGrid/Twilio not sending"
**Solution:**
- Check API keys are correct
- Verify accounts are activated (not in trial/sandbox mode)
- Check service dashboards for error messages
- Review application logs

### Issue: "Stripe webhook not working"
**Solution:**
- Verify webhook secret matches
- Check webhook endpoint URL is correct
- Use Stripe CLI for local testing
- Check Stripe dashboard for webhook delivery logs

---

## Next Steps After Setup

1. **Frontend Integration:**
   - Connect frontend to backend API
   - Implement authentication flow
   - Test end-to-end user flows

2. **Documentation:**
   - Document API endpoints for frontend team
   - Create API documentation (Swagger/OpenAPI)
   - Document deployment procedures

3. **Testing:**
   - Write unit tests
   - Write integration tests
   - Set up automated testing pipeline

4. **Monitoring:**
   - Set up error tracking
   - Configure performance monitoring
   - Set up alerts

---

## Support Resources

- **API Documentation:** See `API_ENDPOINTS.md`
- **Admin Setup:** See `ADMIN_SETUP.md`
- **Migration Guide:** See `MIGRATION_GUIDE.md`
- **Quick Reference:** See `QUICK_REFERENCE.md`

---

**Last Updated:** January 2026


---

