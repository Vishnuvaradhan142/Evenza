import express from "express";
import db from "../db.js";

const router = express.Router();

// ONE-TIME MIGRATION ENDPOINT - Remove after use!
router.post("/setup-schema", async (req, res) => {
  try {
    console.log("🚀 Starting schema setup...");
    
    // Only works with PostgreSQL
    if (!process.env.DATABASE_URL) {
      return res.status(400).json({ message: "This endpoint only works with PostgreSQL (production)" });
    }

    // Create categories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        category_id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Update events table to match MySQL schema
    await db.query(`
      CREATE TABLE IF NOT EXISTS events (
        event_id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        capacity INTEGER,
        locations JSONB,
        sessions JSONB,
        documents JSONB,
        category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
        start_time TIMESTAMPTZ,
        end_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        image VARCHAR(255) DEFAULT '/uploads/events/default-event.png'
      )
    `);

    // Create all other tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        registration_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        registration_date TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'registered',
        attended BOOLEAN DEFAULT FALSE,
        ticket_type VARCHAR(50) DEFAULT 'General',
        tickets_purchased INTEGER DEFAULT 1,
        total_price DECIMAL(10,2) DEFAULT 0
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id SERIAL PRIMARY KEY,
        registration_id INTEGER NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
        ticket_number VARCHAR(100) UNIQUE NOT NULL,
        qr_code TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS saved_events (
        saved_event_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, event_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        faq_id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS chatrooms (
        chatroom_id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        message_id SERIAL PRIMARY KEY,
        chatroom_id INTEGER NOT NULL REFERENCES chatrooms(chatroom_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS friends (
        friendship_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        friend_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, friend_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'general',
        related_id INTEGER NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS draft_events (
        draft_id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        title VARCHAR(255),
        description TEXT,
        capacity INTEGER,
        locations JSONB,
        sessions JSONB,
        documents JSONB NULL,
        category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
        start_time TIMESTAMPTZ,
        end_time TIMESTAMPTZ,
        requires_approval BOOLEAN DEFAULT FALSE,
        submitted_by INTEGER REFERENCES users(user_id),
        submitted_at TIMESTAMPTZ,
        status VARCHAR(50) DEFAULT 'draft',
        attachments JSONB NULL,
        collaborators TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("✅ Schema setup complete!");
    res.json({ 
      success: true, 
      message: "Schema created successfully. You can now migrate your data." 
    });

  } catch (err) {
    console.error("❌ Schema setup failed:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});

// IMPORT USERS - Replace all users with MySQL data
router.post("/import-users", async (req, res) => {
  try {
    console.log("🚀 Starting user import...");
    
    // Only works with PostgreSQL
    if (!process.env.DATABASE_URL) {
      return res.status(400).json({ message: "This endpoint only works with PostgreSQL (production)" });
    }

    const { users } = req.body;
    
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ message: "users array is required" });
    }

    // Clear existing users
    await db.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
    console.log("✅ Cleared existing users");

    // Insert all users
    let count = 0;
    for (const user of users) {
      await db.query(
        `INSERT INTO users (user_id, username, email, password, role, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.user_id, user.username, user.email, user.password, user.role, user.created_at]
      );
      count++;
    }

    // Reset sequence
    await db.query(`SELECT setval('users_user_id_seq', (SELECT MAX(user_id) FROM users))`);

    console.log(`✅ Imported ${count} users`);
    res.json({ 
      success: true, 
      message: `Successfully imported ${count} users` 
    });

  } catch (err) {
    console.error("❌ User import failed:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});

export default router;
