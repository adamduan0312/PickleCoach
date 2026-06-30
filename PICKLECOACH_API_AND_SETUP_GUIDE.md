# PickleCoach API & Setup Guide

One comprehensive guide: Postman setup, coach courts workflow, action items (setup to production), and the full API reference.

## Table of Contents
1. [Quick Start (5-Minute Setup)](#1-quick-start-5-minute-setup)
2. [Coach Courts Workflow (Sequence)](#2-coach-courts-workflow-sequence)
3. [Testing Order](#3-testing-order)
4. [Postman Setup (Detailed)](#4-postman-setup-detailed)
5. [Action Items: Setup to Production](#5-action-items-setup-to-production)
6. [API Endpoints Reference (Complete)](#6-api-endpoints-reference-complete)
7. [Common Issues & Tips](#common-issues-and-solutions)

---

## 1. Quick Start (5-Minute Setup)

# Postman Quick Start Guide

## 🚀 5-Minute Setup

### Step 1: Install Postman Desktop App
**⚠️ Important**: You MUST use the **Desktop App** (not the web version) to test localhost!

- Download **Desktop App** from [postman.com/downloads](https://www.postman.com/downloads/)
- Install and open the Desktop App
- **Do NOT use web.postman.com** - it cannot access localhost

### Step 2: Create Environment
1. Click gear icon (⚙️) → "Add"
2. Name: "PickleCoach Local"
3. Add variables:
   - `base_url` = `http://localhost:4000`
   - `api_url` = `{{base_url}}/api`
   - `auth_token` = (leave empty)
   - `user_id` = (leave empty)
   - `coach_id` = (leave empty)
   - `lesson_id` = (leave empty)
   - `booking_id` = (leave empty)
   - `court_id` = (leave empty)
4. Select environment from dropdown (top right)

### Step 3: Import Collection
1. Click "Import" button
2. Select `PickleCoach_API_ByType.postman_collection.json` or `PickleCoach_API_ByFlow.postman_collection.json` (or both)
3. Click "Import"

### Step 4: Start Your Server
```bash
cd backend
npm start
```

### Step 5: Test Health Check
1. Open "Health Check" → "Health Check" request
2. Click "Send"
3. Should see: `{"status": "ok", "database": "connected"}`

---

## 📋 Testing Order

1. ✅ **Health Check** - Verify server is running
2. 🔐 **Register/Login** - Get auth token (auto-saved)
3. 👤 **Get Profile** - Verify authentication works
4. 🏃 **Coaches** - Browse/create coach profiles
5. 🏟️ **Courts** - Find/create courts
6. 📚 **Lessons** - Browse/create lessons
7. 📅 **Bookings** - Create bookings
8. 💰 **Payments** - View payment history
9. ⭐ **Reviews** - Create reviews
10. 💬 **Messages** - Send messages

---

## 🔑 Authentication

After **Login** or **Register**, the token is automatically saved to `{{auth_token}}`.

For authenticated requests:
- Go to "Authorization" tab
- Select "Bearer Token"
- Enter: `{{auth_token}}`

---

## ✅ Understanding Test Results

After sending a request, scroll down to see:
- ✅ Green checkmarks = Test passed
- ❌ Red X = Test failed
- Shows: "X/Y tests passed"

---

## 🐛 Common Issues

| Problem | Solution |
|---------|----------|
| "Cloud agent error: cannot send request" | **You're using web version!** Download Desktop App from [postman.com/downloads](https://www.postman.com/downloads/) |
| "Cannot GET /api/..." | Server not running - start with `npm start` |
| "401 Unauthorized" | Missing/invalid token - login again |
| "400 Bad Request" | Check JSON format in body |
| Variables not working | Select correct environment from dropdown |

---

## 📚 Full Documentation

See `POSTMAN_SETUP_GUIDE.md` for detailed instructions and all endpoint test scripts.

---

## 💡 Pro Tips

1. **Save IDs Automatically**: Test scripts save IDs from responses to variables
2. **Use Folders**: Requests are organized by category
3. **Check Test Results**: Always review test results after each request
4. **Update Variables**: Manually update IDs in environment if needed

---

**Ready to test!** Start with Health Check, then Register/Login to get your token. 🎉

---

## 2. Coach Courts Workflow (Sequence)

Use this sequence when adding courts to a coach in Postman (or in the app):

1. **Create courts** (public or private): **`POST /api/courts`** only — **court fields only** (no `coach_notes` or legacy `notes`; either returns **400**). Coach is **auto-linked**; response includes `court` and `coachCourt` (link row without `coach_notes`). For **coach-specific link notes**, call **`POST /api/coaches/me/courts`** with the same `court_id` and **`coach_notes`** (**200** updates the auto-linked row). **Distance rule:** If the coach already has other courts, the new court must be within **100 miles** of one of them.
2. **Add an existing court**: **`POST /api/coaches/me/courts`** with `court_id` (required), optional **`coach_notes`**. If already linked and you omit **`coach_notes`**, you get **409**; with **`coach_notes`**, link text is updated (**200**). **Distance rule:** New court must be within **100 miles** of one of your existing courts (if you have any).
3. **Remove a court from your profile** (e.g. when moving): **`DELETE /api/coaches/me/courts/:courtId`** where **`courtId`** is **`court_locations.id`** (same as **`court_id`** / **`court.id`** from List My Courts). This only removes **your** link; it does not delete the shared court. Then add courts in the new city and update your profile **location**.
4. **List your courts**: **`GET /api/coaches/me/courts`** returns all linked courts (use **`court_id`** in the unlink URL).

**In Postman:** **Courts** → **Create Court**; **Coaches** → **List My Courts**; **Coaches** → **Add Court to Coach**; **Coaches** → **Remove Court from Coach** (uses **`{{court_id}}`** — set from Create Court or List My Courts).

---

## 3. Testing Order

Test endpoints in this order because some depend on others:

1. ✅ **Health Check** – Verify server is running
2. 🔐 **Register/Login** – Get auth token (auto-saved)
3. 👤 **Get Profile** – Verify authentication works
4. 🏃 **Coaches** – Browse/create coach profiles. For the **student** flow (Postman **3 – Flow: Student**), after List Coaches and Get Coach By ID use **Get Coach Courts** and **Get Coach Availability** before creating a booking.
5. 🏟️ **Courts** – Find/create courts (**create courts before adding to coach**)
6. **Coach courts** – **List My Courts**, **Add Court to Coach** (see [Coach Courts Workflow](#2-coach-courts-workflow-sequence) above)
7. 📚 **Lessons** – Browse/create lessons
8. 📅 **Bookings** – Create bookings
9. 💰 **Payments** – View payment history
10. ⭐ **Reviews** – Create reviews
11. 💬 **Messages** – Send messages
12. **Other** – Reschedules, disputes, notifications, admin

---

## 4. Postman Setup (Detailed)

# Postman Setup Guide for PickleCoach API

## Table of Contents
1. [What is Postman?](#what-is-postman)
2. [Installing Postman](#installing-postman)
3. [Setting Up Your Environment](#setting-up-your-environment)
4. [Importing the Collection](#importing-the-collection)
5. [Understanding Postman Basics](#understanding-postman-basics)
6. [Testing Your First Endpoint](#testing-your-first-endpoint)
7. [Using Variables and Authentication](#using-variables-and-authentication)
8. [Test Scripts Explained](#test-scripts-explained)
9. [Endpoint Testing Guide](#endpoint-testing-guide)

---

## What is Postman?

Postman is a tool that lets you test API endpoints (like your backend server) without building a frontend. Think of it as a way to "talk" to your server and see what it responds with.

**Why use Postman?**
- Test your API quickly without writing frontend code
- See exactly what data your server sends and receives
- Debug errors easily
- Share API documentation with your team

---

## Installing Postman

### Step 1: Download Postman Desktop App
**⚠️ Important**: You MUST use the **Postman Desktop App** (not the web version) to test localhost endpoints like `http://localhost:4000`.

1. Go to [https://www.postman.com/downloads/](https://www.postman.com/downloads/)
2. Download the **Desktop App** for your operating system (Mac, Windows, or Linux)
3. Install the application
4. **Do NOT use the web version** at [web.postman.com](https://web.postman.com) - it cannot access localhost

**Why?** The web version of Postman runs in your browser and cannot access `localhost` URLs for security reasons. The Desktop App runs on your computer and can access local servers.

#### Postman Options Explained:

**✅ Postman Desktop App** (Recommended for localhost):
- Works with `localhost` URLs
- Full feature set
- Available for Mac, Windows, and Linux
- **This is what you should use for testing your local API**

**❌ Postman Web App** (web.postman.com):
- Cannot access `localhost` URLs
- Limited for local development
- Good for testing remote APIs only

**⚠️ Postman Mobile App** (iOS/Android):
- Can work with localhost, but requires network configuration
- More complex setup (need to ensure phone and computer are on same network)
- Not recommended for beginners
- Desktop App is much easier for local testing

### Step 2: Create a Postman Account (Optional but Recommended)
1. Open the Postman Desktop App
2. Click "Sign Up" or "Create Account" (you can use a free account)
3. This allows you to sync your collections across devices

---

## Setting Up Your Environment

An **environment** in Postman stores variables (like your server URL) that you can reuse across requests.

### Step 1: Create a New Environment
1. Click the gear icon (⚙️) in the top right corner
2. Click "Add" to create a new environment
3. Name it "PickleCoach Local" or "Development"

### Step 2: Add Variables
**Important**: These should be **Environment Variables** (not Global Variables). Environment variables are scoped to your specific environment, which allows you to have different values for development, staging, and production.

Add these variables to your environment:

| Variable Name | Initial Value | Current Value | Description |
|--------------|---------------|---------------|-------------|
| `base_url` | `http://localhost:4000` | `http://localhost:4000` | Your server URL |
| `api_url` | `{{base_url}}/api` | `{{base_url}}/api` | API base path |
| `auth_token` | (leave empty) | (leave empty) | JWT token (auto-filled after login) |
| `user_id` | (leave empty) | (leave empty) | User ID (auto-filled after login) |
| `coach_id` | (leave empty) | (leave empty) | Coach ID (auto-filled after creating coach profile) |
| `lesson_id` | (leave empty) | (leave empty) | Lesson ID (for testing) |
| `booking_id` | (leave empty) | (leave empty) | Booking ID (for testing) |
| `court_id` | (leave empty) | (leave empty) | Court ID (for testing) |

**Note**: When adding variables in Postman's environment editor, make sure you're adding them to the environment you just created (not as global variables). The variables table should show "Environment" as the scope.

### Step 3: Select Your Environment
1. In the top right corner, you'll see a dropdown that says "No Environment" (or shows the currently selected environment)
2. Click on this dropdown
3. Select "PickleCoach Local" (or whatever you named your new environment)

#### Environment Variables vs Global Variables

**Environment Variables** (what we're using):
- ✅ Scoped to a specific environment (e.g., "PickleCoach Local")
- ✅ Can have different values per environment (dev, staging, production)
- ✅ Perfect for URLs, tokens, and IDs that change per environment
- ✅ When you switch environments, variables automatically update

**Global Variables** (not what we want):
- ❌ Available across ALL environments
- ❌ Same value everywhere
- ❌ Not ideal for environment-specific values like URLs or tokens

**Why use Environment Variables?**
- You might want `base_url` to be `http://localhost:4000` for local testing, but `https://api.picklecoach.com` for production
- Each developer can have their own environment with their own tokens
- You can easily switch between environments without changing variable values manually

---

## Importing the Collection

A **collection** is a group of API requests organized by category.

### Option 1: Import from JSON File
1. In Postman, click "Import" button (top left)
2. Click "Upload Files"
3. Select the `PickleCoach_API_ByType` or `PickleCoach_API_ByFlow` collection file
4. Click "Import"

### Option 2: Manual Setup
If you prefer to create requests manually, follow the structure in the [Endpoint Testing Guide](#endpoint-testing-guide) section below.

---

## Understanding Postman Basics

### The Postman Interface

```
┌─────────────────────────────────────────┐
│  [Method] [URL]              [Send]     │  ← Request Builder
├─────────────────────────────────────────┤
│  Params | Authorization | Headers | ... │  ← Request Tabs
├─────────────────────────────────────────┤
│  Body (JSON, form-data, etc.)           │  ← Request Body
├─────────────────────────────────────────┤
│  Response (Status, Time, Size)          │  ← Response Area
│  Body | Headers | Cookies               │
└─────────────────────────────────────────┘
```

### Key Components:

1. **HTTP Method**: GET, POST, PUT, DELETE, etc.
   - GET = Retrieve data
   - POST = Create new data
   - PUT = Update existing data
   - DELETE = Remove data

2. **URL**: The endpoint address (e.g., `{{api_url}}/auth/login`)

3. **Headers**: Additional information sent with the request
   - Common header: `Content-Type: application/json`
   - Auth header: `Authorization: Bearer {{auth_token}}`

4. **Body**: Data sent to the server (for POST/PUT requests)
   - Usually JSON format: `{ "email": "test@example.com", "password": "password123" }`

5. **Response**: What the server sends back
   - Status code (200 = success, 404 = not found, 500 = server error)
   - Response body (the actual data)

---

## Testing Your First Endpoint

Let's test the health check endpoint (no authentication needed):

### Step 1: Create a New Request
1. Click "New" → "HTTP Request"
2. Name it "Health Check"

### Step 2: Configure the Request
- **Method**: Select `GET` from the dropdown
- **URL**: Enter `{{base_url}}/health`
  - Postman will automatically use your environment variable

### Step 3: Send the Request
1. Click the blue "Send" button
2. You should see a response like:
```json
{
  "status": "ok",
  "timestamp": "2026-01-25T...",
  "database": "connected",
  "uptime": 123.45
}
```

**If you get an error:**
- Make sure your server is running (`npm start` in the backend folder)
- Check that the port matches (default is 4000)
- Verify the URL is correct

---

## Using Variables and Authentication

### How Variables Work

Variables let you reuse values across requests. For example:
- Instead of typing `http://localhost:4000/api/auth/login` every time
- You type `{{api_url}}/auth/login`
- Postman automatically replaces `{{api_url}}` with the value from your environment

### Setting Up Authentication

Most endpoints require a JWT token. Here's how to get and use it:

#### Step 1: Register or Login
1. Use the "Register" or "Login" request
2. After a successful login, the test script automatically saves your token
3. Check your environment variables - `auth_token` should now be filled

#### Step 2: Using the Token
1. For authenticated requests, go to the "Authorization" tab
2. Select "Bearer Token" from the Type dropdown
3. Enter `{{auth_token}}` in the Token field
4. Postman will automatically include it in the request headers

**Alternative Method (Manual):**
1. Go to the "Headers" tab
2. Add a header:
   - Key: `Authorization`
   - Value: `Bearer {{auth_token}}`

---

## Test Scripts Explained

Test scripts in Postman run **after** you receive a response. They can:
- Check if the response is correct
- Save data from the response to variables
- Validate response structure

### Example Test Script

```javascript
// This runs after the request completes
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has success field", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('success');
    pm.expect(jsonData.success).to.be.true;
});

// Save token to environment variable
if (pm.response.code === 200) {
    var jsonData = pm.response.json();
    if (jsonData.data && jsonData.data.token) {
        pm.environment.set("auth_token", jsonData.data.token);
    }
    if (jsonData.data && jsonData.data.user && jsonData.data.user.id) {
        pm.environment.set("user_id", jsonData.data.user.id);
    }
}
```

### What Each Part Does:

1. **`pm.test("Description", function() {...})`**: Creates a test that shows as pass/fail
2. **`pm.response.to.have.status(200)`**: Checks if status code is 200
3. **`pm.response.json()`**: Converts response body to JavaScript object
4. **`pm.expect(...)`**: Asserts that something is true (like checking if a field exists)
5. **`pm.environment.set("variable_name", value)`**: Saves a value to your environment

### Viewing Test Results

After sending a request:
1. Scroll down to the "Test Results" section
2. You'll see green checkmarks (✓) for passed tests
3. Red X marks (✗) for failed tests
4. The number shows: "X/Y tests passed"

---

## Endpoint Testing Guide

### Testing Order (Important!)

Test endpoints in this order because some depend on others:

1. **Health Check** (no auth)
2. **Authentication** (register/login to get token)
3. **Profile** (update your profile)
4. **Coaches** (create coach profile if you're a coach)
5. **Courts** (find/create courts)
6. **Lessons** (create lessons if you're a coach)
7. **Bookings** (create bookings)
8. **Payments** (view payment history)
9. **Reviews** (create reviews)
10. **Messages** (send messages)
11. **Other endpoints** (disputes, notifications, admin)

**GET list endpoints and query parameters:** Many GET list endpoints (e.g. `GET /api/users`, `GET /api/bookings`, `GET /api/coaches`) accept optional query parameters for pagination and filtering. Common params: `page` (default 1), `limit` (default 10, max 100), plus endpoint-specific filters (e.g. `role`, `status`, `coach_id`). The API validates these; invalid values return 400 with error details.

---

## Detailed Endpoint Instructions

### 1. Health Check

**Request:**
- Method: `GET`
- URL: `{{base_url}}/health`
- Headers: None
- Body: None

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-25T...",
  "database": "connected",
  "uptime": 123.45
}
```

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Database is connected", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.database).to.eql("connected");
});
```

---

### 2. Authentication Endpoints

#### Register

**Request:**
- Method: `POST`
- URL: `{{api_url}}/auth/register`
- Headers: `Content-Type: application/json`
- Body (JSON):
```json
{
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123!",
  "role": "student"
}
```

**For Coaches:** To register as a coach, use `"role": "coach"` instead of `"role": "student"`. After registration, you'll need to create a coach profile separately using the [Create Coach Profile](#create-coach-profile) endpoint.

**Optional Fields:**
- `phone`: Phone number (string)
- `timezone`: Timezone (string, defaults to "UTC")
- `avatar_url`: Profile image URL (string, valid URL, max 255 chars). Can also be set/updated via `PUT /api/auth/profile`.

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response has token", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.have.property('token');
    
    // Save token and user ID
    pm.environment.set("auth_token", jsonData.data.token);
    if (jsonData.data.user && jsonData.data.user.id) {
        pm.environment.set("user_id", jsonData.data.user.id);
    }
});

pm.test("User is created successfully", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data.user.email).to.eql("john@example.com");
});
```

#### Login

**Request:**
- Method: `POST`
- URL: `{{api_url}}/auth/login`
- Headers: `Content-Type: application/json`
- Body (JSON):
```json
{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}
```

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has token", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.have.property('token');
    
    // Save token and user ID
    pm.environment.set("auth_token", jsonData.data.token);
    if (jsonData.data.user && jsonData.data.user.id) {
        pm.environment.set("user_id", jsonData.data.user.id);
    }
});

pm.test("Login successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

#### Forgot Password

**Request:**
- Method: `POST`
- URL: `{{api_url}}/auth/forgot-password`
- Headers: `Content-Type: application/json`
- Body (JSON):
```json
{
  "email": "john@example.com"
}
```

**Expected Response:** Same message whether the email exists or not (for security). If the email exists, a password-reset link is sent to that address (requires SendGrid configured). Token expires in 1 hour.

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
pm.test("Request processed", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

#### Reset Password

**Request:**
- Method: `POST`
- URL: `{{api_url}}/auth/reset-password`
- Headers: `Content-Type: application/json`
- Body (JSON): Use the token from the forgot-password email.
```json
{
  "token": "reset_token_from_email",
  "password": "NewSecurePassword123!"
}
```

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
pm.test("Password reset successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

#### Get Profile

**Request:**
- Method: `GET`
- URL: `{{api_url}}/auth/profile`
- Headers: `Authorization: Bearer {{auth_token}}`
- Body: None

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Profile data is returned", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.have.property('id');
    pm.expect(jsonData.data).to.have.property('email');
});
```

#### Update Profile

**Request:**
- Method: `PUT`
- URL: `{{api_url}}/auth/profile`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON) — all fields optional; omit any you don't want to change:
```json
{
  "full_name": "John Updated",
  "phone": "+1234567890",
  "timezone": "America/New_York",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Profile updated successfully", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data.full_name).to.eql("John Updated");
});
```

---

### 3. Coach Endpoints

#### List Coaches (Search)

**Request:**
- Method: `GET`
- URL: `{{api_url}}/coaches`
- Headers: None (public endpoint)
- Query params (all optional): `lat`, `lng`, `radius` (miles, default 10), `min_skill_rating`, `max_skill_rating`, `min_rating`, `page`, `limit` – use lat/lng/radius to find coaches near a location (e.g. "coaches near me").
- Body: None

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of coaches", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.be.an('array');
});
```

#### Create Coach Profile

**⚠️ Important: Two-Step Process**

Creating a coach involves **two separate steps**:

1. **First**: Register a User account with `role: "coach"` (see [Register](#register) section above)
   - This creates the User record with: `full_name`, `email`, `password`, `role`, `phone`, `timezone`, `avatar_url` (optional), etc.
   - You'll get back a JWT token to use for authentication

2. **Then**: Create the Coach Profile (this endpoint)
   - This creates the CoachProfile record linked to your User account
   - Contains coach-specific data: `bio`, `skill_rating`, `rating_system` (when set: **`self`**, **`DUPR`**, or **`UTR-P`** only — API-enforced), `experience_years`, etc. (Pricing is per **lesson**: `price` + `duration_minutes`; lessons expose read-only `effective_hourly_rate`.)

**Why two steps?** The User account (`full_name`, `email`, `password_hash`, `role`, etc.) is separate from the Coach Profile (`bio`, `skill_rating`, etc.). This allows:
- Users to exist without profiles (e.g., students)
- Coaches to have additional profile information beyond basic user data
- Better data organization and separation of concerns

**Request:**
- Method: `POST`
- URL: `{{api_url}}/coaches/profile`
- Headers: 
  - `Authorization: Bearer {{auth_token}}` (token from registration/login)
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "bio": "Experienced pickleball coach with 10 years of teaching",
  "skill_rating": 4.5,
  "rating_system": "self",
  "experience_years": 10
}
```

**Who can create coach profiles?**

1. **Coaches** (logged in with `role: "coach"`):
   - The `user_id` field is optional - if not provided, it will automatically use your authenticated user's ID
   - You can only create a profile for yourself

2. **Admins** (logged in with `role: "admin"`):
   - ✅ **Yes, admins CAN create coach profiles!**
   - You **must** provide the `user_id` of the coach you're creating the profile for
   - The target user must have `role: "coach"` (they must have registered as a coach first)

**Example for Coach creating their own profile:**
```json
{
  "bio": "Experienced pickleball coach with 10 years of teaching",
  "skill_rating": 4.5,
  "rating_system": "self",
  "experience_years": 10
}
```

**Example for Admin creating a profile for a coach:**
```json
{
  "user_id": 27,
  "bio": "Experienced pickleball coach with 10 years of teaching",
  "skill_rating": 4.5,
  "rating_system": "self",
  "experience_years": 10
}
```

**Note:** Use `experience_years` for years of coaching experience.

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Coach profile created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    
    // Save coach ID
    if (jsonData.data && jsonData.data.id) {
        pm.environment.set("coach_id", jsonData.data.id);
    }
});
```

#### Update My Coach Profile

**Request:**
- Method: `PUT`
- URL: `{{api_url}}/coaches/me/profile` (no user id in the path — always updates the logged-in coach)
- Headers: 
  - `Authorization: Bearer {{auth_token}}` (coach token)
  - `Content-Type: application/json`
- Body (JSON) — all fields optional:
```json
{
  "headline": "Updated Headline",
  "bio": "Updated bio with more experience",
  "experience_years": 12,
  "skill_rating": 4.5,
  "rating_system": "self",
  "certifications": "USAPA Certified, PPR Certified",
  "location": "Los Angeles, CA"
}
```

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Coach profile updated", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

#### Create Availability

**Request:**
- Method: `POST`
- URL: `{{api_url}}/coaches/me/availability`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "weekday": "monday",
  "start_time": "09:00",
  "end_time": "17:00"
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Availability created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

### 4. Court Endpoints

#### List/Search Courts

**Request:**
- Method: `GET`
- URL: `{{api_url}}/courts`
- Headers: None (public endpoint)
- Body: None

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of courts", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.be.an('array');
    
    // Save first court ID if available
    if (jsonData.data.length > 0 && jsonData.data[0].id) {
        pm.environment.set("court_id", jsonData.data[0].id);
    }
});
```

---

### 5. Lesson Endpoints

#### Get All Lessons

**Request:**
- Method: `GET`
- URL: `{{api_url}}/lessons`
- Headers: None (public endpoint)
- Body: None

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of lessons", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.be.an('array');
    
    // Save first lesson ID if available
    if (jsonData.data.length > 0 && jsonData.data[0].id) {
        pm.environment.set("lesson_id", jsonData.data[0].id);
    }
});
```

#### Create Lesson

**Request:**
- Method: `POST`
- URL: `{{api_url}}/lessons`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "title": "Beginner Pickleball Lesson",
  "description": "Learn the basics of pickleball",
  "price": 50.00,
  "duration_minutes": 60,
  "max_students": 4,
  "is_active": true
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Lesson created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    
    // Save lesson ID
    if (jsonData.data && jsonData.data.id) {
        pm.environment.set("lesson_id", jsonData.data.id);
    }
});
```

---

### 6. Booking Endpoints

#### Create Booking

**Request:**
- Method: `POST`
- URL: `{{api_url}}/bookings`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "lesson_id": "{{lesson_id}}",
  "scheduled_at": "2026-02-01T10:00:00Z",
  "duration_minutes": 60,
  "court_location_id": "{{court_id}}"
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Booking created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    
    // Save booking ID
    if (jsonData.data && jsonData.data.id) {
        pm.environment.set("booking_id", jsonData.data.id);
    }
});
```

#### Get My Bookings

**Request:**
- Method: `GET`
- URL: `{{api_url}}/bookings`
- Headers: `Authorization: Bearer {{auth_token}}`
- Body: None

**Test Script:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Returns array of bookings", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData.data).to.be.an('array');
});
```

---

### 7. Review Endpoints

#### Create Review

**Request:**
- Method: `POST`
- URL: `{{api_url}}/reviews`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "booking_id": "{{booking_id}}",
  "rating": 5,
  "comment": "Great lesson!",
  "target_user_id": "{{coach_id}}"
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Review created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data.rating).to.be.at.least(1).and.at.most(5);
});
```

---

### 8. Message Endpoints

#### Create Conversation

**Request:**
- Method: `POST`
- URL: `{{api_url}}/messages/conversations`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "booking_id": "{{booking_id}}"
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Conversation created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    
    // Save conversation ID
    if (jsonData.data && jsonData.data.id) {
        pm.environment.set("conversation_id", jsonData.data.id);
    }
});
```

#### Send Message

**Request:**
- Method: `POST`
- URL: `{{api_url}}/messages/send`
- Headers: 
  - `Authorization: Bearer {{auth_token}}`
  - `Content-Type: application/json`
- Body (JSON):
```json
{
  "conversation_id": "{{conversation_id}}",
  "content": "Hello, I have a question about the lesson"
}
```

**Test Script:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Message sent", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.data).to.have.property('content');
});
```

---

## Common Issues and Solutions

### Issue: "Cloud agent error: cannot send request" or "When testing an API locally, you need to use the Postman Desktop Agent"
**Solution**: 
- **You're using the web version of Postman** - it cannot access localhost
- **Fix**: Download and use the **Postman Desktop App** instead
  1. Go to [https://www.postman.com/downloads/](https://www.postman.com/downloads/)
  2. Download the Desktop App for your operating system
  3. Install and open the Desktop App
  4. Import your collection again in the Desktop App
  5. Your requests to `localhost` will now work

**Alternative (if you must use web version)**: You can install the Postman Desktop Agent, but using the Desktop App is much easier and recommended.

### Issue: "Cannot GET /api/..."
**Solution**: Make sure your server is running and the URL is correct

### Issue: "401 Unauthorized"
**Solution**: 
- Check that you're including the Authorization header
- Make sure your token is valid (try logging in again)
- Verify the token format: `Bearer {{auth_token}}`

### Issue: "400 Bad Request"
**Solution**:
- Check your request body format (should be valid JSON)
- Verify all required fields are included
- Check the Content-Type header is `application/json`

### Issue: "500 Internal Server Error"
**Solution**:
- Check your server logs for detailed error messages
- Verify your database is connected
- Check that all required environment variables are set

### Issue: Variables Not Working
**Solution**:
- Make sure you've selected the correct environment
- Check that variable names match exactly (case-sensitive)
- Use double curly braces: `{{variable_name}}`

---

## Tips for Effective Testing

1. **Test in Order**: Some endpoints depend on others (e.g., you need a booking before creating a review)

2. **Save IDs**: Use test scripts to automatically save IDs from responses to variables

3. **Use Collections**: Organize requests into folders (Auth, Coaches, Bookings, etc.)

4. **Document Requests**: Add descriptions to each request explaining what it does

5. **Check Test Results**: Always review the test results to catch issues early

6. **Use Pre-request Scripts**: Set up common headers or data before requests run

7. **Export Collections**: Save your collection as JSON to share with your team

---

## Next Steps

1. Import the Postman collection JSON file
2. Set up your environment variables
3. Start with the Health Check endpoint
4. Register/Login to get your auth token
5. Test endpoints one by one, following the order above
6. Review test results to ensure everything works

Happy testing! 🚀

---

## 5. Action Items: Setup to Production


---

## Recent Improvements (Jan 2026)

The following changes are already in the codebase; ensure migrations are run and docs are used as needed:

- **Password reset flow:** `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` are implemented. Run the password-reset migration if you haven’t (see Phase 1 Step 2).
- **Logging:** Controllers use the configured logger instead of `console.error`.
- **Request validation:** All relevant POST/PUT endpoints use Joi body validation; GET endpoints with query params use `validateQuery`. See `config/validation.js` and `middleware/validator.js`.
- **Error responses:** Consistent format (e.g. 404, validation errors). See the "Error Responses" section in `API_ENDPOINTS.md`.
- **Graceful shutdown:** Server closes HTTP connections before closing the database.

**Docs:** Full API details (including error responses) → `API_ENDPOINTS.md`. Postman → `POSTMAN_SETUP_GUIDE.md` / `POSTMAN_QUICK_START.md`.

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

3. **Run any new migrations** (e.g. password reset fields):
   After the initial schema is marked, run new migrations normally:
   ```bash
   npm run db:migrate
   ```
   This applies migrations such as `20260126120000-add-password-reset-fields.cjs` (adds `password_reset_token`, `password_reset_expires` to users). 
   
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

3. **Save tokens as environment variables:**
   - Create Postman environment: "PickleCoach Dev"
   - Variables:
     - `base_url`: `http://localhost:4000`
     - `student_token`: (from student login)
     - `coach_token`: (from coach login)
     - `admin_token`: (from admin login)

4. **Test Core Endpoints:**
   - Health check: `GET /health`
   - User profile: `GET /api/auth/profile` (with token)
   - Coach endpoints: `GET /api/coaches`, `POST /api/coaches/profile`, `PUT /api/coaches/me/profile`
   - Lesson endpoints: `POST /api/lessons`, `GET /api/lessons`
   - Booking endpoints: `POST /api/booking-intents`, `POST /api/bookings/confirm`, `GET /api/bookings`

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

## 6. API Endpoints Reference (Complete)

**Base URL**: All endpoints are prefixed with `/api`

**Authentication**: Most endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

**Response convention**: For create/update endpoints, the response body echoes all **safe** request-body fields (same keys, with `null` when optional and unset) so clients see a consistent shape and can easily compare request vs response in Postman. Sensitive fields (e.g. password) are never returned.

---

## Health Check

### `GET /health`
- **Auth**: None required
- **Description**: Health check endpoint to verify server and database connectivity
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-01-26T12:00:00.000Z",
    "database": "connected",
    "uptime": 123.45
  }
  ```

---

## Authentication (`/api/auth`)

### `POST /api/auth/register`
- **Auth**: None required
- **Description**: Register a new user account
- **Request Body**:
  ```json
  {
    "full_name": "string (required, 2-100 chars)",
    "email": "string (required, valid email, max 150 chars)",
    "password": "string (required, min 8 chars)",
    "role": "string (required, 'student' | 'coach')",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional, defaults to 'UTC')",
    "avatar_url": "string (optional, valid URL, max 255 chars)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "role": "student",
        "phone": null,
        "timezone": "UTC",
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Note**: All safe request fields (full_name, email, role, phone, timezone, avatar_url) are echoed in the response; optional ones are `null` when not sent. Avatar can also be set or changed later via `PUT /api/auth/profile`.
- **Error responses**: `400` (validation failed – invalid body), `409` (email already registered), `500` (server error).

### `POST /api/auth/login`
- **Auth**: None required
- **Description**: Login and receive JWT token
- **Request Body**:
  ```json
  {
    "email": "string (required, valid email)",
    "password": "string (required)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "role": "student",
        "avatar_url": null
      },
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Error responses**: `400` (validation failed – invalid body), `401` (invalid credentials), `403` (account inactive), `500` (server error).

### `POST /api/auth/refresh`
- **Auth**: Bearer token (can be expired)
- **Description**: Refresh an expired JWT token
- **Request Body**:
  ```json
  {
    "token": "string (required, JWT token)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Token refreshed successfully",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "role": "student",
        "avatar_url": null
      }
    }
  }
  ```

### `POST /api/auth/forgot-password`
- **Auth**: None required
- **Description**: Request a password reset link via email
- **Request Body**:
  ```json
  {
    "email": "string (required, valid email)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "If an account exists with this email, a password reset link has been sent",
    "data": null
  }
  ```
- **Error responses**: `400` (validation failed – invalid email), `500` (server error). Success message is the same whether email exists or not (security).
- **Note**: For security, the response is the same whether the email exists or not.

### `POST /api/auth/reset-password`
- **Auth**: None required
- **Description**: Reset password using the token from the forgot-password email
- **Request Body**:
  ```json
  {
    "token": "string (required, password reset token from email)",
    "password": "string (required, min 8 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Password reset successfully",
    "data": null
  }
  ```
- **Error responses**:
  - **400** — Invalid or expired token (wrong token, already used, or expired after 1 hour):
    ```json
    {
      "success": false,
      "message": "Invalid or expired reset token"
    }
    ```
  - **400** — Validation failed (missing/invalid body, e.g. short password):
    ```json
    {
      "success": false,
      "error": "Validation failed",
      "details": [ { "field": "password", "message": "\"password\" length must be at least 8 characters long" } ],
      "requestId": "..."
    }
    ```
  - **500** — Server error (e.g. database failure):
    ```json
    {
      "success": false,
      "message": "Failed to reset password"
    }
    ```
- **Error responses**: See full error response block above (400 invalid/expired token, 400 validation failed, 500 server error).
- **Note**: Token expires after 1 hour.

### `GET /api/auth/profile`
- **Auth**: Required
- **Description**: Get current authenticated user's profile
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "role": "student",
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": "https://example.com/avatar.jpg",
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
- **Error responses**: `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/profile`
- **Auth**: Required
- **Description**: Update current authenticated user's profile
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "data": {
      "id": 1,
      "full_name": "John Updated",
      "email": "john@example.com",
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  }
  ```
- **Error responses**: `400` (validation failed – invalid body), `401` (missing or invalid token), `500` (server error).

### `PUT /api/auth/me/role`
- **Auth**: Required
- **Description**: **Add** the **student** or **coach** role (self-service). Does **not** remove roles — you can have both. Admins cannot use this. Response may include a new **token** when a role was added. Removing coach/admin access is admin-only via **`PUT /api/users/:id`** and explicit **`roles`**; coach profile and Stripe data stay for payouts/history. After adding coach, create a profile with `POST /api/coaches/profile` if needed.
- **UI mode**: Server returns **`roles`** (all permissions). Use client-side **`activeRole`** / mode (`student` vs `coach`) to show one dashboard at a time — not stored by this API.
- **Request Body**: `{ "role": "student" | "coach" }` (required).
- **Response** (Status: 200): `{ "success": true, "message": "Role added successfully...", "data": { "user": { id, full_name, email, roles: [...], ... }, "token": "..." } }`.
- **Error responses**: `400` (invalid role), `403` (admin), `401` (missing or invalid token), `500` (server error).

### `DELETE /api/auth/me`
- **Auth**: Required
- **Description**: Delete the current user's account (**soft delete**). Sets `deleted_at` and `is_active: false`; coach profile is also soft-deleted if present. User can no longer log in. **Not available to admins** (use admin user management for that).
- **Response** (Status: 200): `{ "success": true, "message": "Account deleted successfully", "data": null }`.
- **Error responses**: `403` (admin), `401` (missing or invalid token), `500` (server error).

---

## Users (`/api/users`)

**User lifecycle:** Filtering on this list is by **deletion** only (`include_deleted`). `deleted_at` = soft-deleted; when set, `is_active` is also false. Admins can set `is_active: false` without deleting (suspend). Response items include `is_active` for client-side filtering. See API_ENDPOINTS.md for full lifecycle details.

### `GET /api/users`
- **Auth**: Required (Admin only)
- **Description**: Get all users (admin only). By default returns only non–soft-deleted users.
- **Query Parameters**:
  - `page`: number (optional, default: 1)
  - `limit`: number (optional, default: 10)
  - `role`: string (optional, filter by role: 'student' | 'coach' | 'admin')
  - `include_deleted`: string `'true'` | `'false'` (optional). If `'true'`, includes soft-deleted users; default is non-deleted only.
  - `search`: string (optional). Filter by full name or email (case-insensitive, partial match). Use for admin “find user” without scrolling the full list.
- **Note**: Each user in the response has `is_active`; filter or display by active/inactive on the client if needed.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Users retrieved successfully",
    "data": [
      {
        "id": 1,
        "full_name": "John Doe",
        "email": "john@example.com",
        "roles": ["student"],
        "role_state": { "locked": false, "allowed_roles": null, "effective_roles": ["student"], "source": "open" },
        "is_active": true,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```
  Note: Pagination info is included in the response structure (see pagination section)

### `GET /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Get user by ID (admin only). Non-admins should use `GET /api/auth/profile` for their own profile.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User retrieved successfully",
    "data": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "roles": ["coach"],
      "role_state": { "locked": false, "allowed_roles": null, "effective_roles": ["coach"], "source": "open" },
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": null,
      "is_active": true,
      "coachProfile": {
        "id": 1,
        "user_id": 1,
        "bio": "Experienced coach",
        "skill_rating": 4.5,
        "rating_system": "self"
      },
      "reliability": {
        "user_id": 1,
        "reliability_score": 95.5
      }
    }
  }
  ```

### `PUT /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: Update user (admin only - can update **roles** (full set), `is_active`, email, avatar_url, etc.)
- **Roles**: Send **`roles`** as the **complete** set (e.g. `["student","coach"]` or `["admin","student","coach"]`). Omit to leave roles unchanged. Including **`roles`** replaces all `user_roles` for that user. Legacy **`role`** (singular) is rejected with **400** — use **`roles`** only. **Valid:** any **1–3** unique combination of `student`, `coach`, and `admin` (roles are independent capabilities, including admin+student and all three).
- **Role governance**: Sending **`roles`** sets **`role_governance_locked`** and **`admin_allowed_roles`** so **`PUT /api/auth/me/role`** cannot bypass admin. Send **`role_governance_locked`: false** alone (no **`roles`** in same request) to unlock. See **`API_ENDPOINTS.md`**.
- **Admin safeguards**: You cannot remove your **own** `admin` role (**400**, e.g. `["admin","coach"]` → `"roles": ["coach"]` on your own user). Another admin must update you, or include **`admin`** in the `roles` you send for yourself. You cannot remove `admin` from the **last** admin (**409**). Same **409** if you **delete** the last admin (`DELETE /api/users/:id`).
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "full_name": "string (optional)",
    "email": "string (optional, must be unique; 400 if already in use)",
    "phone": "string (optional, max 30 chars)",
    "timezone": "string (optional)",
    "avatar_url": "string (optional, URI or empty string to clear)",
    "is_active": "boolean (optional, admin only)",
    "roles": ["optional: 1–3 unique entries from student, coach, admin"],
    "role_governance_locked": "boolean optional — false alone clears lock (not with roles)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "User updated successfully",
    "data": {
      "id": 1,
      "full_name": "Updated Name",
      "email": "john@example.com",
      "roles": ["coach", "student"],
      "role_state": { "locked": true, "allowed_roles": ["coach", "student"], "effective_roles": ["coach", "student"], "source": "admin" },
      "is_active": true,
      "phone": "+1234567890",
      "timezone": "America/New_York",
      "avatar_url": null
    }
  }
  ```

### `DELETE /api/users/:id`
- **Auth**: Required (Admin only)
- **Description**: **Soft delete** user (admin only). Sets `deleted_at` and `is_active: false`; coach profile soft-deleted if present. Deleted users are excluded from list/get and cannot log in.
- **Response** (Status: 200): `{ "success": true, "message": "User deleted successfully", "data": null }`.
- **Error responses**: `400` (already deleted), `404` (not found), `409` (last admin cannot be deleted), `500` (server error).

---

## Coaches (`/api/coaches`)

### `GET /api/coaches` (List / search coaches)
- **Auth**: Required (student or admin only). Coaches cannot use this endpoint (403).
- **Description**: List coaches with optional filters. Use **lat**, **lng**, and **radius** to find coaches who have courts within that distance (e.g. "coaches near me"). Other filters: **min_skill_rating**, **max_skill_rating**, **min_rating** (review average), page, limit.
- **Query Parameters**: `lat`, `lng`, `radius` (miles), `min_skill_rating`, `max_skill_rating`, `min_rating`, `page`, `limit` (all optional).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coaches retrieved successfully",
    "data": [
      {
        "id": 1,
        "user_id": 2,
        "full_name": "Jane Coach",
        "coachProfile": {
          "skill_rating": 4.5,
          "rating_system": "self",
          "rating_average": 4.8
        }
      }
    ]
  }
  ```

### `GET /api/coaches/:id`
- **Auth**: None required
- **Description**: Get coach details by ID (public)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach retrieved successfully",
    "data": {
      "id": 1,
      "user_id": 2,
      "full_name": "Jane Coach",
      "coachProfile": {
        "skill_rating": 4.5,
        "rating_system": "self",
        "rating_average": 4.8
      },
      "total_reviews": 25,
      "availability": [],
      "lessons": []
    }
  }
  ```

### `POST /api/coaches/profile`
- **Auth**: Required
- **Description**: Create coach profile (for users with coach role)
- **Request Body**:
  ```json
  {
    "user_id": "number (optional, admin only - defaults to authenticated user's ID)",
    "headline": "string (optional)",
    "bio": "string (optional)",
    "experience_years": "number (optional, defaults to 0)",
    "skill_rating": "number (optional, 2.0–6.0, 0.5 steps) or null",
    "rating_system": "\"self\" | \"DUPR\" | \"UTR-P\" (optional; default self when omitted)",
    "certifications": "string (optional)",
    "location": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Coach profile created successfully",
    "data": {
      "id": 1,
      "user_id": 1,
      "headline": "Professional Pickleball Coach",
      "bio": "Experienced pickleball coach with 10 years of teaching",
      "experience_years": 10,
      "skill_rating": 4.5,
      "rating_system": "self",
      "certifications": "USAPA Certified",
      "location": "New York, NY",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/coaches/me/profile`
- **Auth**: Required (**coach** only)
- **Description**: Update **your own** coach profile. No `:id` in the URL — always the logged-in coach.
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "headline": "string (optional)",
    "bio": "string (optional)",
    "experience_years": "number (optional)",
    "skill_rating": "number (optional) or null",
    "rating_system": "\"self\" | \"DUPR\" | \"UTR-P\" (optional)",
    "certifications": "string (optional)",
    "location": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach profile updated successfully",
    "data": {
      "id": 1,
      "headline": "Updated Headline",
      "bio": "Updated bio with more experience",
      "experience_years": 12,
      "skill_rating": 4.5,
      "rating_system": "self"
    }
  }
  ```

### `PUT /api/coaches/profile/:id` (admin only)
- **Auth**: Required (**admin** only)
- **Description**: Update **another** coach’s profile. `:id` is that coach’s **user id**. Coaches must use **`PUT /api/coaches/me/profile`** instead.
- **Request Body** (same as `PUT /api/coaches/me/profile`).
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Coach profile updated successfully",
    "data": {
      "id": 1,
      "headline": "Updated Headline",
      "bio": "Updated bio with more experience",
      "experience_years": 12,
      "skill_rating": 4.5,
      "rating_system": "self"
    }
  }
  ```

### `GET /api/coaches/me/availability`
- **Auth**: Required (coach only)
- **Description**: List **your** availability slots only (owner-scoped). Same pagination query params as `GET /api/coaches/:id/availability`.

### `POST /api/coaches/me/availability`
- **Auth**: Required (coach only)
- **Description**: Create coach availability slot for the authenticated coach. Do **not** send `coach_id`; it is derived from the session. Slots are **recurrence-based**: `weekday` + **`start_time`** / **`end_time`** (required) + optional **`start_date`** / **`end_date`** as plain **`YYYY-MM-DD`** strings (not coerced through JS `Date` / `toISOString()`).
- **Request Body**:
  ```json
  {
    "weekday": "string or number (e.g. 'monday' or 1)",
    "start_time": "string (required, e.g. '09:00' or '09:00:00')",
    "end_time": "string (required, e.g. '17:00' or '17:00:00')",
    "start_date": "string (optional, YYYY-MM-DD)",
    "end_date": "string (optional, YYYY-MM-DD)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Availability created successfully",
    "data": {
      "id": 1,
      "coach_id": 1,
      "weekday": 1,
      "start_time": "09:00:00",
      "end_time": "17:00:00",
      "start_date": "2026-02-01",
      "end_date": "2026-12-01",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/coaches/me/availability/:id`
- **Auth**: Required (coach only)
- **Description**: Update one slot you own. Body same shape as POST (replace window fields). `:id` = availability row id.

### `GET /api/coaches/:id/availability`
- **Auth**: Required — **student** or **admin** (effective roles). Coach-only: **403**. Anonymous: **401**.
- **Description**: Get another coach’s availability for the student booking flow. Coaches who also hold the student role can call this when using a session with `student` in effective roles.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Availability retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 1,
        "weekday": 1,
        "start_time": "09:00:00",
        "end_time": "17:00:00",
        "start_date": "2026-02-01",
        "end_date": "2026-12-01",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `DELETE /api/coaches/me/availability/:id`
- **Auth**: Required (Coach only)
- **Description**: Delete a coach availability slot (**hard delete**). Coaches can only delete their own. `:id` is the availability record id (from `GET /api/coaches/me/availability` or POST create).
- **Response** (Status: 200): `{ "success": true, "message": "Availability deleted successfully", "data": null }`.
- **Error responses**: `403` (not coach or not own), `404` (not found), `500` (server error).

**Coach courts workflow**
- **Create courts**: **`POST /api/courts`** (no `coach_notes` / `notes` on this route). Coach is auto-linked. Use **`POST /api/coaches/me/courts`** with the same `court_id` and **`coach_notes`** to set or change link notes (**200** after auto-link). **Distance rule:** New court must be within **100 miles** of one of your existing courts (if any).
- **Add existing court**: **`POST /api/coaches/me/courts`** with `court_id`; duplicate without **`coach_notes`** → **409**. **Distance rule:** Court must be within **100 miles** of one of your existing courts (if any).
- **Remove court from profile**: **`DELETE /api/coaches/me/courts/:courtId`** (`courtId` = `court_locations.id`, same as `court_id` from GET). Unlinks you only; does not delete the global court.
- **List your courts**: **`GET /api/coaches/me/courts`** (use **`court_id`** for unlink).

### `GET /api/coaches/me/courts`
- **Auth**: Required (coach only)
- **Description**: List courts associated with the authenticated coach
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "court_id": 1,
        "coach_notes": "My home base",
        "created_at": "...",
        "updated_at": "...",
        "court": {
          "id": 1,
          "name": "Central Park Pickleball Court",
          "address": "123 Main St",
          "latitude": 40.7,
          "longitude": -74.0,
          "is_private": false
        }
      }
    ]
  }
  ```

### `POST /api/coaches/me/courts`
- **Auth**: Required (coach only; admins cannot add courts to their profile)
- **Description**: Link an **existing** court to the coach's available courts. Does not create a new court; use `POST /api/courts` to create courts (coaches are auto-linked when they create). **Already linked?** Include **`coach_notes`** in the body to update `coach_court_locations.coach_notes` (**200**); duplicate `court_id` without **`coach_notes`** → **409**.
- **Request Body**:
  ```json
  {
    "court_id": "number (required)",
    "coach_notes": "string (optional)"
  }
  ```
- **Response**: **201** when a new link is created; **200** when the coach was already linked and the body included **`coach_notes`** (coach_notes updated only). `data` contains `coachCourt` (id, coach_id, court_id, coach_notes, created_at, updated_at) and `court` (id, name, address, latitude, longitude, is_private). `rate_modifier` is reserved in DB for future pricing and is not returned on coach APIs.
- **Error responses**: `400` (court_id missing/invalid or court &gt;100 miles from your existing courts), `404` (court not found), `409` (already linked and **`coach_notes`** omitted).

### `DELETE /api/coaches/me/courts/:courtId`
- **Auth**: Required (coach only)
- **Description**: Unlink your profile from this court (`coach_court_locations` only). **`courtId`** = **`court_locations.id`** (same as **`court_id`** on **`GET /api/coaches/me/courts`**). Does not delete the shared court or affect other coaches.
- **Response** (200): `{ "success": true, "message": "Court removed from your profile", "data": { "court_id": <number>, "name": "<string|null>" } }` — echoes the court id and display name that was unlinked from your profile.
- **Error responses**: `404` if the court does not exist, is globally deleted, or you are not linked to it.

### `POST /api/coaches/me/stripe-connect/onboard`
- **Auth**: Required
- **Description**: Initiate Stripe Connect onboarding for coach payouts
- **Request Body**:
  ```json
  {
    "coach_id": "number (optional, admin only - defaults to authenticated user's ID)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Stripe Connect onboarding initiated",
    "data": {
      "onboarding_url": "https://connect.stripe.com/setup/c/..."
    }
  }
  ```

### `GET /api/coaches/me/stripe-connect/status`
- **Auth**: Required
- **Description**: Check Stripe Connect onboarding status
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Stripe Connect status retrieved",
    "data": {
      "stripe_account_id": "acct_...",
      "charges_enabled": true,
      "payouts_enabled": true,
      "details_submitted": true
    }
  }
  ```

---

## Courts (`/api/courts`)

**Field notes:** `is_private` — coach-set. **Private courts are excluded from public discovery** (`GET /api/courts`, `GET /api/courts/:id` returns **404** for private ids). Coach profile / booking / admin APIs still return private courts where applicable. `rate_modifier` on coach–court links is stored for future per-court pricing but not exposed on coach/student APIs until booking logic uses it.

### `GET /api/courts`
- **Auth**: None required
- **Description**: Search courts (with lazy import from OpenStreetMap if no results)
- **Query Parameters**: Search filters (location, name, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Courts retrieved successfully",
    "data": [
      {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "is_private": false
      }
    ]
  }
  ```

### `GET /api/courts/:id`
- **Auth**: None required
- **Description**: Get court details by ID (public)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Court retrieved successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address": "123 Main St",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "source": "manual",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/courts`
- **Auth**: Required (Coach or Admin only)
- **Description**: Create a new court location (**court entity only**). **Coach auto-link:** When a coach creates a court, the server creates a link row with **only** `coach_id` and `court_id`. **`coach_notes` / `notes` are not accepted** on this route — body must not include those properties (**400** if present). Use **`POST /api/coaches/me/courts`** with `court_id` and optional **`coach_notes`** for relationship metadata.
- **Request Body**:
  ```json
  {
    "name": "string (required)",
    "address": "string (optional)",
    "latitude": "number (optional)",
    "longitude": "number (optional)",
    "is_private": "boolean (optional, defaults to false)"
  }
  ```
- **Response** (Status: 201) — **coach**:
  ```json
  {
    "success": true,
    "message": "Court created successfully",
    "data": {
      "court": {
        "id": 1,
        "name": "Central Park Pickleball Court",
        "address": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "is_private": false
      },
      "coachCourt": {
        "id": 10,
        "coach_id": 2,
        "court_id": 1,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    }
  }
  ```
- **Response** (Status: 201) — **admin** (court object only; no coach link):
  ```json
  {
    "success": true,
    "message": "Court created successfully",
    "data": {
      "id": 1,
      "name": "Central Park Pickleball Court",
      "address": "123 Main St",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "is_private": false,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `DELETE /api/courts/:id`
- **Auth**: Required (**Admin only**)
- **Description**: **Global soft delete** of the court (`court_locations.deleted_at`) and removal of **all** `coach_court_locations` for that court. Coaches **cannot** use this route — they unlink with **`DELETE /api/coaches/me/courts/:courtId`** only.
- **Response** (Status: 200): `{ "success": true, "message": "Court deleted successfully", "data": null }`.
- **Error responses**: `403` (not admin), `404` (not found or already deleted), `500` (server error).

---

## Lessons (`/api/lessons`)

### `GET /api/lessons`
- **Auth**: None required
- **Description**: Get all lessons (public)
- **Query Parameters**: Filters (coach_id, is_active, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lessons retrieved successfully",
    "data": [
      {
        "id": 1,
        "coach_id": 2,
        "title": "Beginner Pickleball Lesson",
        "description": "Learn the basics",
        "duration_minutes": 60,
        "price": 50.00,
        "max_students": 4,
        "is_active": true
      }
    ]
  }
  ```

### `GET /api/lessons/:id`
- **Auth**: Optional (Bearer token to load **inactive** lessons as **coach owner** or **admin**)
- **Description**: Get lesson by ID. **Active** = public. **Inactive** = **`404`** for students, other coaches, and anonymous users; **owner** and **admin** with token get **200**. **Deleted** = **`404`** for everyone (including owner). Manage inactive offerings via **`GET /api/coaches/me/lessons`**.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lesson retrieved successfully",
    "data": {
      "id": 1,
      "coach_id": 2,
      "title": "Beginner Pickleball Lesson",
      "description": "Learn the basics of pickleball",
      "duration_minutes": 60,
      "price": 50.00,
      "max_students": 4,
      "is_active": true,
      "coach": {
        "id": 2,
        "full_name": "Jane Coach"
      }
    }
  }
  ```

### `POST /api/lessons`
- **Auth**: Required (Coach only)
- **Description**: Create a new lesson
- **Request Body**:
  ```json
  {
    "title": "string (required, 3-255 chars)",
    "description": "string (optional)",
    "duration_minutes": "number (required, 15-480)",
    "price": "number (required, positive)",
    "max_students": "number (optional, 1-20, defaults to 1)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Lesson created successfully",
    "data": {
      "id": 1,
      "coach_id": 2,
      "title": "Beginner Pickleball Lesson",
      "description": "Learn the basics of pickleball",
      "duration_minutes": 60,
      "price": 50.00,
      "max_students": 4,
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/lessons/:id`
- **Auth**: Required
- **Description**: Update lesson (coach owner or admin). **`404`** if soft-deleted (`deleted_at` set). Use **`is_active: false`** to hide without deleting.
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "title": "string (optional)",
    "description": "string (optional)",
    "duration_minutes": "number (optional)",
    "price": "number (optional)",
    "max_students": "number (optional)",
    "is_active": "boolean (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lesson updated successfully",
    "data": {
      "id": 1,
      "title": "Updated Lesson Title",
      "description": "Updated description",
      "duration_minutes": 90,
      "price": 55.00,
      "max_students": 6,
      "is_active": true
    }
  }
  ```

### `DELETE /api/lessons/:id`
- **Auth**: Required
- **Description**: Soft-delete lesson (`deleted_at`). Row kept for booking history. **`404`** if already deleted. Use **`PUT`** with **`is_active: false`** to hide without deleting.
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Lesson deleted successfully",
    "data": null
  }
  ```

---

## Bookings (`/api/bookings`)

### `GET /api/bookings`
- **Auth**: Required
- **Description**: Get user's bookings (filtered by role - coach sees coach bookings, student sees student bookings)
- **Query Parameters**: Filters (status, date range, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Bookings retrieved successfully",
    "data": [
      {
        "id": 1,
        "lesson_id": 1,
        "coach_id": 2,
        "primary_student_id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z",
        "duration_minutes": 60,
        "price": 50.00,
        "status": "pending",
        "lesson": {
          "title": "Beginner Pickleball Lesson"
        }
      }
    ]
  }
  ```

### `GET /api/bookings/:id`
- **Auth**: Required
- **Description**: Get booking details by ID
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking retrieved successfully",
    "data": {
      "id": 1,
      "lesson_id": 1,
      "coach_id": 2,
      "primary_student_id": 1,
      "scheduled_at": "2026-02-01T10:00:00.000Z",
      "duration_minutes": 60,
      "price": 50.00,
      "status": "pending",
      "lesson": {
        "id": 1,
        "title": "Beginner Pickleball Lesson"
      },
      "coach": {
        "id": 2,
        "full_name": "Jane Coach"
      },
      "student": {
        "id": 1,
        "full_name": "John Doe"
      }
    }
  }
  ```

### `POST /api/booking-intents`
- **Auth**: Required (verified email)
- **Description**: Create Stripe PaymentIntent for a lesson slot (manual capture). No booking row until confirm.
- **Response** (201): `client_secret`, `payment_intent_id`, `lesson_id`, `scheduled_at`, `amount`

### `POST /api/bookings/confirm`
- **Auth**: Required (verified email)
- **Description**: After Stripe authorization (`requires_capture`), creates booking (`pending`) + payment (`authorized`). Idempotent per `payment_intent_id`.
- **Request Body**: `{ "payment_intent_id": "pi_xxx" }`
- **Response** (201): `{ booking, payment }`

### `POST /api/bookings` (deprecated)
- **Status**: **410 Gone** — use booking-intents + confirm flow. See `backend/docs/MIGRATION_AUTHORIZE_FIRST_BOOKING.md`.

### `PUT /api/bookings/:id/status`
- **Auth**: Required
- **Description**: Update booking status (e.g., confirm, complete)
- **Request Body**:
  ```json
  {
    "status": "string (required, booking status)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking status updated successfully",
    "data": {
      "id": 1,
      "status": "confirmed",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/bookings/:id/cancel`
- **Auth**: Required
- **Description**: Cancel a booking (triggers refund if applicable)
- **Request Body**:
  ```json
  {
    "reason": "string (required, valid cancellation reason)",
    "reason_notes": "string (optional, max 255 chars)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Booking cancelled successfully",
    "data": {
      "id": 1,
      "status": "cancelled",
      "cancelled_at": "2026-01-01T00:00:00.000Z",
      "cancelled_by": "student"
    }
  }
  ```

**Schedule changes:** Cancel + rebook (no reschedule API). Cancellation reasons: excused (`weather`, `emergency`, `sickness`) vs unexcused (`travel_delay`, `schedule_conflict`, `forgot`, `other`).

---

## Payments (`/api/payments`)

### `GET /api/payments`
- **Auth**: Required
- **Description**: Get user's payments (filtered by role)
- **Query Parameters**: Filters (status, escrow_status, student_id, coach_id, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Payments retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "student_id": 1,
        "coach_id": 2,
        "total_charge_to_student": 50.00,
        "platform_fee_amount": 4.00,
        "coach_payout_amount": 46.00,
        "payment_status": "captured",
        "escrow_status": "released"
      }
    ]
  }
  ```

### `GET /api/payments/:id`
- **Auth**: Required
- **Description**: Get payment details by ID
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Payment retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "student_id": 1,
      "coach_id": 2,
      "total_charge_to_student": 50.00,
      "platform_fee_amount": 4.00,
      "coach_payout_amount": 46.00,
      "payment_status": "captured",
      "escrow_status": "released",
      "booking": {
        "id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z"
      }
    }
  }
  ```

**MVP note:** Payment rows are created when a student confirms a booking (`POST /api/bookings/confirm`) and updated via Stripe webhooks and booking flows. There are no admin HTTP endpoints to create payments, adjust status, or mark refunds in isolation—use Stripe Dashboard and webhook replay; refunds that move money go through **`paymentService.processRefund`** (e.g. booking cancellation).

---

## Reviews (`/api/reviews`)

### `GET /api/reviews`
- **Auth**: None required
- **Description**: Get reviews (public)
- **Query Parameters**: Filters (coach_id, student_id, rating, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reviews retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "reviewer_id": 1,
        "target_user_id": 2,
        "rating": 5,
        "comment": "Great lesson!",
        "visibility": "public",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/reviews`
- **Auth**: Required
- **Description**: Create a review
- **Request Body**:
  ```json
  {
    "booking_id": "number (required, positive integer)",
    "target_user_id": "number (optional, positive integer)",
    "rating": "number (required, 1-5 integer)",
    "comment": "string (optional, max 1000 chars)",
    "attendance_badges": "array (optional, array of strings)",
    "visibility": "string (optional, 'public' | 'private' | 'semi_public', defaults to 'public')"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Review created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "reviewer_id": 1,
      "target_user_id": 2,
      "rating": 5,
      "comment": "Great lesson!",
      "visibility": "public",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/reviews/:id`
- **Auth**: Required
- **Description**: Update review (only by reviewer)
- **Request Body** (all fields optional - omit fields you don't want to update):
  ```json
  {
    "rating": "number (optional, 1-5 integer)",
    "comment": "string (optional, max 1000 chars)",
    "attendance_badges": "array (optional, array of strings)",
    "visibility": "string (optional, 'public' | 'private' | 'semi_public')"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Review updated successfully",
    "data": {
      "id": 1,
      "rating": 4,
      "comment": "Updated review comment",
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `DELETE /api/reviews/:id`
- **Auth**: Required
- **Description**: Delete review (only by reviewer)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Review deleted successfully",
    "data": null
  }
  ```

---

## Messages (`/api/messages`)

**Booking-scoped messaging (V1).** One conversation per booking. Text only (`message_text`) — no attachments, edits, deletes, reactions, typing indicators, or read receipts.

**Lifecycle:** derived from `booking.status` — `pending` locked; `confirmed` / `awaiting_verification` unlocked; terminal statuses locked (read-only). Admin: read yes, send no. Conversation is **auto-created when the booking becomes `confirmed`** (coach accept or payment capture).

**Access:** coach, primary student, admin may read; only coach/student may send when unlocked. Locked sends → **409** `Messaging is unavailable for this booking`.

### `GET /api/messages/conversations`
- **Auth**: Required — participant bookings (admin: all)

### `GET /api/messages/conversations/:id`
- **Auth**: Required — includes `messaging_locked`; history readable when locked

### `POST /api/messages/conversations`
- **Auth**: Required (verified email) — body: `{ "booking_id": number }`

### `POST /api/messages/send`
- **Auth**: Required (verified email)
- **Request Body**:
  ```json
  {
    "conversation_id": "number (required)",
    "message_text": "string (required, 1-5000 chars)"
  }
  ```

---

## Disputes (`/api/disputes`)

MVP `dispute_types` ids (see migrations `20260408120000-canonical-dispute-types-mvp` and `20260421120000-dispute-types-attendance-claims`): **1** `coach_no_show_claim` (student claims coach no-show), **2** `late_arrival`, **3** `misconduct`, **4** `lesson_not_completed`, **5** `refund_request`, **6** `billing_issue`, **7** `other`, **8** `student_no_show_claim` (coach claims student no-show). Final attendance outcomes are **`bookings.status`** (`student_no_show` / `coach_no_show`), set when resolving disputes or via admin no-show booking routes when not disputed.

### `GET /api/disputes`
- **Auth**: Required
- **Description**: Get disputes (filtered by user role)
- **Query Parameters**: Filters (status, type, booking_id, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Disputes retrieved successfully",
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "dispute_type_id": 1,
        "opened_by": "student",
        "status": "open",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `GET /api/disputes/:id`
- **Auth**: Required
- **Description**: Get dispute details by ID
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dispute retrieved successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "dispute_type_id": 1,
      "opened_by": "student",
      "status": "open",
      "booking": {
        "id": 1,
        "scheduled_at": "2026-02-01T10:00:00.000Z"
      },
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `POST /api/disputes`
- **Auth**: Required
- **Description**: Create a dispute. Admins can also use `POST /api/admin/disputes` (same handler) when support opens a case; this sets `opened_by` to `admin`.
- **Reliability consistency (current rules)**:
  - Coach no-show severity is aligned across signals: **35-point weight** whether represented by booking status `coach_no_show` or resolved **`coach_no_show_claim`** disputes (same bucket as before rename).
  - Duplicate-signal protection is enabled: if booking status already represents the no-show incident, the matching claim dispute is not counted again for scoring.
- **Request Body**:
  ```json
  {
    "booking_id": "number (required)",
    "dispute_type_id": "number (required)",
    "notes": "string (optional)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Dispute created successfully",
    "data": {
      "id": 1,
      "booking_id": 1,
      "dispute_type_id": 1,
      "opened_by": "student",
      "status": "open",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/disputes/:id/resolve`
- **Auth**: Required (Admin only)
- **Description**: Resolve a dispute (admin only). Full contract is in **`backend/API_ENDPOINTS.md`**. Summary: send **`decision`** + **`financial_action`**. For attendance claims, **`outcome`** is always required; **`rejected`** fixes the contradicting factual outcome, and **`financial_action`** must match that outcome (e.g. **`coach_no_show`** → refund path; **`student_no_show`** → **`no_change`**). **`refund_amount`** is required for **`refund_student_partial`**. Response may include **`data.resolution`** and **`data.refund`**.

---

## Notifications (`/api/notifications`)

### `GET /api/notifications`
- **Auth**: Required
- **Description**: Get user's notifications
- **Query Parameters**: Filters (status, type, unread_only, etc.)
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Notifications retrieved successfully",
    "data": [
      {
        "id": 1,
        "user_id": 1,
        "type": "booking_confirmed",
        "channel": "in_app",
        "payload": {
          "title": "Booking Confirmed",
          "message": "Your booking has been confirmed"
        },
        "read_at": null,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

### `POST /api/notifications`
- **Auth**: Required (Admin only)
- **Description**: Create a notification (admin only)
- **Request Body**:
  ```json
  {
    "user_id": "number (required)",
    "type": "string (required)",
    "channel": "string (required)",
    "payload": "object (required)"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Notification created successfully",
    "data": {
      "id": 1,
      "user_id": 1,
      "type": "system",
      "channel": "in_app",
      "payload": {
        "title": "System Notification",
        "message": "This is a system notification"
      },
      "status": "pending",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/notifications/:id/read`
- **Auth**: Required
- **Description**: Mark notification as read
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Notification marked as read",
    "data": {
      "id": 1,
      "read_at": "2026-01-01T12:00:00.000Z"
    }
  }
  ```

---

## Admin (`/api/admin`)

### `GET /api/admin/dashboard`
- **Auth**: Required (Admin only)
- **Description**: Get admin dashboard statistics
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Dashboard stats retrieved successfully",
    "data": {
      "users": {
        "total_students": 150,
        "total_coaches": 25
      },
      "bookings": {
        "total": 500,
        "active": 45
      },
      "revenue": {
        "total": 25000.00,
        "commissions": 2000.00
      },
      "disputes": {
        "pending": 3
      }
    }
  }
  ```

### `POST /api/admin/users`
- **Auth**: Required (Admin only)
- **Description**: Create an admin user account
- **Request Body**:
  ```json
  {
    "full_name": "string (required)",
    "email": "string (required, valid email)",
    "password": "string (required, min 8 chars)",
    "phone": "string (optional)",
    "timezone": "string (optional, defaults to 'UTC')"
  }
  ```
- **Response** (Status: 201):
  ```json
  {
    "success": true,
    "message": "Admin account created successfully",
    "data": {
      "id": 10,
      "full_name": "Admin User",
      "email": "admin@example.com",
      "role": "admin",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

### `PUT /api/admin/users/:id/reliability`
- **Auth**: Required (Admin only)
- **Description**: Manually adjust user reliability score
- **Request Body**:
  ```json
  {
    "new_score": "number (required, 0-100)",
    "reason": "string (optional)",
    "explanation": "string (optional)"
  }
  ```
- **Response** (Status: 200):
  ```json
  {
    "success": true,
    "message": "Reliability score adjusted successfully",
    "data": {
      "user_id": 1,
      "user_role": "coach",
      "previous_score": 100.00,
      "new_score": 85.5,
      "adjusted_by": 10,
      "reason": "Manual adjustment",
      "explanation": "Adjusted due to dispute resolution"
    }
  }
  ```

---

## Webhooks (`/api/webhooks`)

### `POST /api/webhooks/stripe`
- **Auth**: None (uses Stripe signature verification)
- **Description**: Stripe webhook endpoint for payment events
- **Headers**: `Stripe-Signature` (required for signature verification)
- **Request Body**: Stripe webhook event JSON
- **Response**: Success acknowledgment

---

## Error Responses

Error responses vary slightly by source:

**From controllers** (e.g. invalid token, not found, conflict):
```json
{
  "success": false,
  "message": "Error message"
}
```

**From validation middleware** (invalid request body or query):
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [ { "field": "fieldName", "message": "Validation message" } ],
  "requestId": "uuid"
}
```

**Status codes**: `400` Bad Request, `401` Unauthorized, `403` Forbidden, `404` Not Found, `409` Conflict, `500` Internal Server Error.

## Success Responses

All endpoints return consistent success responses:

```json
{
  "success": true,
  "data": {},
  "message": "Success message"
}
```

## Notes on Request Bodies

- **Optional Fields**: For update endpoints, omit fields you don't want to update. Setting a field to `null` or `""` will update the database to that value.
- **Validation**: Endpoints with validation schemas will strip unknown fields and validate field types/ranges.
- **Defaults**: Fields marked with defaults will use the default value if not provided.
- **Required vs Optional**: Required fields must be included. Optional fields can be omitted entirely.

## Notes on Responses

- **Consistent Structure**: All successful responses follow the format:
  ```json
  {
    "success": true,
    "message": "Success message",
    "data": { /* response data */ }
  }
  ```

- **Error Responses**: See the "Error Responses" section and per-endpoint "Error responses" lines. Controller errors use `success: false` and `message`; validation errors use `error: "Validation failed"`, `details`, and `requestId`.

- **Pagination**: Paginated endpoints return data in the `data` field as an array, with pagination metadata included.

- **Status Codes**: 
  - `200` - Success (GET, PUT, DELETE)
  - `201` - Created (POST)
  - `400` - Bad Request (validation errors)
  - `401` - Unauthorized (missing/invalid token)
  - `403` - Forbidden (insufficient permissions)
  - `404` - Not Found
  - `409` - Conflict (duplicate resource)
  - `500` - Internal Server Error
