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
2. Select `PickleCoach_API.postman_collection.json`
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
