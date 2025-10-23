# Troubleshooting Guide - Evenza Backend

## Signup Not Working - "Server error. Please try again later."

### Step 1: Check Backend Server
1. **Verify server is running:**
   ```bash
   cd backend
   npm start
   ```
   You should see: `Server running on port 5000`

2. **Test backend connection:**
   - Go to: `http://localhost:5000/api/test`
   - Should show: `{"message":"Backend server is running!","timestamp":"..."}`

### Step 2: Check Database Connection
1. **Verify MySQL is running:**
   - Windows: Check Services > MySQL
   - Mac/Linux: `sudo systemctl status mysql`

2. **Check database credentials in `.env`:**
   ```env
   DB_HOST=localhost
   DB_USER=your_username
   DB_PASSWORD=your_password
   DB_NAME=evenza
   JWT_SECRET=your_secret_key
   PORT=5000
   ```

3. **Test database connection:**
   - Backend console should show: `DB connection works ✅`
   - If not, check your MySQL credentials

### Step 3: Check Database Schema
1. **Verify tables exist:**
   ```sql
   USE evenza;
   SHOW TABLES;
   ```
   Should show: `users`, `events`, `registrations`

2. **If tables don't exist, run schema:**
   ```bash
   mysql -u your_username -p evenza < schema.sql
   ```

### Step 4: Check Frontend Configuration
1. **Verify API endpoint:**
   - Frontend calls: `http://localhost:5000/api/auth/signup`
   - Backend route: `/api/auth/signup` ✅

2. **Check CORS:**
   - Backend allows: `http://localhost:3000`
   - Frontend runs on: `http://localhost:3000` ✅

### Step 5: Common Issues & Solutions

#### Issue: "Database table 'users' not found"
**Solution:** Run the database schema
```bash
mysql -u your_username -p evenza < schema.sql
```

#### Issue: "Database connection refused"
**Solution:** Start MySQL service
```bash
# Windows
net start mysql

# Mac/Linux
sudo systemctl start mysql
```

#### Issue: "Database access denied"
**Solution:** Check `.env` file credentials
```env
DB_USER=your_actual_mysql_username
DB_PASSWORD=your_actual_mysql_password
```

#### Issue: "Port already in use"
**Solution:** Change port or kill existing process
```bash
# Kill process on port 5000
npx kill-port 5000

# Or change port in .env
PORT=5001
```

### Step 6: Test Signup Flow
1. **Start backend:** `npm start`
2. **Start frontend:** `npm start`
3. **Go to signup page:** `http://localhost:3000/signup`
4. **Click "Test Backend Connection"** - should show success
5. **Try signup** with test data

### Step 7: Debug Information
Check backend console for detailed logs:
- Signup request received
- Database queries
- Error details with codes

### Still Having Issues?
1. **Check browser console** for network errors
2. **Check backend console** for error logs
3. **Verify all services** are running
4. **Check firewall/antivirus** blocking connections

### Quick Fix Commands
```bash
# Restart everything
cd backend && npm start
# In new terminal:
cd frontend && npm start

# Test backend
curl http://localhost:5000/api/test

# Check MySQL
mysql -u root -p -e "SHOW DATABASES;"
```

