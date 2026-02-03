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
3. Select the `PickleCoach_API.postman_collection.json` file
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
11. **Other endpoints** (reschedules, disputes, notifications, admin)

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

#### Get All Coaches

**Request:**
- Method: `GET`
- URL: `{{api_url}}/coaches`
- Headers: None (public endpoint)
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
   - Contains coach-specific data: `bio`, `hourly_rate`, `skill_level`, `experience_years`, etc.

**Why two steps?** The User account (`full_name`, `email`, `password_hash`, `role`, etc.) is separate from the Coach Profile (`bio`, `hourly_rate`, `skill_level`, etc.). This allows:
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
  "hourly_rate": 50.00,
  "skill_level": "advanced",
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
  "hourly_rate": 50.00,
  "skill_level": "advanced",
  "experience_years": 10
}
```

**Example for Admin creating a profile for a coach:**
```json
{
  "user_id": 27,
  "bio": "Experienced pickleball coach with 10 years of teaching",
  "hourly_rate": 50.00,
  "skill_level": "advanced",
  "experience_years": 10
}
```

**Note:** You can also use `years_experience` instead of `experience_years` for backward compatibility.

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

#### Create Availability

**Request:**
- Method: `POST`
- URL: `{{api_url}}/coaches/availability`
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

#### Get All Courts

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
