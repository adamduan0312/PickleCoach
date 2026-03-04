# Login Troubleshooting Guide

## Quick Diagnosis

Run this command to verify your user exists and can login:

```bash
cd backend
node scripts/test-login.js adamduan0312@gmail.com "03122003"
```

This will check:
1. ✅ User exists in database
2. ✅ User account is active
3. ✅ Password is correct
4. ✅ Shows exact Postman request format

---

## Common Issues & Solutions

### Issue 1: "Invalid credentials" (401)

**Possible causes:**
- User doesn't exist in database
- Password is incorrect
- User account is inactive

**Solution:**
1. Verify user exists:
   ```bash
   node scripts/test-login.js adamduan0312@gmail.com "03122003"
   ```

2. If user doesn't exist, create it:
   ```bash
   node scripts/create-first-admin.js adamduan0312@gmail.com "03122003" "Adam Duan"
   ```

3. If user exists but password is wrong, you'll need to:
   - Delete the user from database, OR
   - Update the password_hash directly in database

---

### Issue 2: "Cannot POST /api/auth/login" or Connection Error

**Possible causes:**
- Server is not running
- Wrong URL
- Postman environment variable not set

**Solution:**
1. **Start the server:**
   ```bash
   cd backend
   npm start
   ```
   You should see: `🚀 API listening on http://localhost:4000`

2. **Check Postman environment variables:**
   - Click gear icon (⚙️) in Postman
   - Make sure you have an environment selected
   - Verify `api_url` = `http://localhost:4000/api`
   - Verify `base_url` = `http://localhost:4000`

3. **Test health check first:**
   - In Postman: `GET {{base_url}}/health`
   - Should return: `{"status": "ok", "database": "connected"}`

---

### Issue 3: "400 Bad Request" or Validation Error

**Possible causes:**
- JSON format is wrong
- Missing required fields
- Email format invalid

**Solution:**
1. **Check request body format:**
   - Must be `raw` (not form-data or x-www-form-urlencoded)
   - Must be `JSON` (not Text)
   - Must have proper JSON syntax

2. **Correct format:**
   ```json
   {
     "email": "adamduan0312@gmail.com",
     "password": "03122003"
   }
   ```

3. **Check headers:**
   - Must have: `Content-Type: application/json`

---

### Issue 4: "500 Internal Server Error"

**Possible causes:**
- Database connection issue
- JWT_SECRET not set
- Server error

**Solution:**
1. **Check database connection:**
   ```bash
   # Test health endpoint
   curl http://localhost:4000/health
   ```

2. **Check environment variables:**
   - Make sure `.env.development` exists
   - Must have `JWT_SECRET` (minimum 32 characters)
   - Check `backend/.env.development`

3. **Check server logs:**
   - Look at terminal where server is running
   - Check for error messages

---

## Step-by-Step Verification

### Step 1: Verify User Exists
```bash
cd backend
node scripts/verify-user.js adamduan0312@gmail.com "03122003"
```

**Expected output:**
```
✅ User found!
   ID: 1
   Name: Adam Duan
   Email: adamduan0312@gmail.com
   Role: admin
   Active: true
✅ Password is correct!
```

### Step 2: Verify Server is Running
```bash
curl http://localhost:4000/health
```

**Expected output:**
```json
{"status":"ok","database":"connected","timestamp":"...","uptime":123}
```

### Step 3: Test Login in Postman

**Request:**
- Method: `POST`
- URL: `{{api_url}}/auth/login`
- Headers: `Content-Type: application/json`
- Body (raw JSON):
  ```json
  {
    "email": "adamduan0312@gmail.com",
    "password": "03122003"
  }
  ```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "full_name": "Adam Duan",
      "email": "adamduan0312@gmail.com",
      "role": "admin"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "Login successful"
}
```

---

## Postman Setup Checklist

- [ ] Postman Desktop App installed (not web version)
- [ ] Environment created with variables:
  - [ ] `base_url` = `http://localhost:4000`
  - [ ] `api_url` = `http://localhost:4000/api`
- [ ] Environment selected from dropdown (top right)
- [ ] Collection imported (`PickleCoach_API_ByType` or `PickleCoach_API_ByFlow`)
- [ ] Server running (`npm start` in backend folder)
- [ ] Health check works (`GET {{base_url}}/health`)

---

## Still Not Working?

1. **Check server logs** - Look at terminal output for errors
2. **Check database** - Make sure MySQL is running
3. **Verify credentials** - Run `node scripts/test-login.js` to verify
4. **Check Postman console** - View → Show Postman Console (see actual request/response)

---

## Quick Test Script

Run this to test everything at once:

```bash
cd backend

# 1. Test user exists
echo "Testing user..."
node scripts/test-login.js adamduan0312@gmail.com "03122003"

# 2. Test server (if running)
echo "\nTesting server..."
curl -s http://localhost:4000/health | jq .
```
