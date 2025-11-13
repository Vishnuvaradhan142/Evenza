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

// GET ALL USERS - View current users in database
router.get("/get-users", async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(400).json({ message: "This endpoint only works with PostgreSQL (production)" });
    }

    const [users] = await db.query(
      "SELECT user_id, username, email, role, created_at FROM users ORDER BY user_id"
    );

    res.json({ 
      success: true, 
      count: users.length,
      users: users 
    });

  } catch (err) {
    console.error("❌ Get users failed:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});

// IMPORT ALL TABLES DATA - Import all remaining tables from MySQL
router.post("/import-all-data", async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.query("BEGIN");
    
    const {
      categories, events, registrations, tickets, saved_events,
      chatrooms, chat_messages, friends, notifications, faqs, draft_events
    } = req.body;

    let importedCounts = {};

    // Import categories
    if (categories && categories.length > 0) {
      await connection.query("TRUNCATE TABLE categories CASCADE");
      for (const cat of categories) {
        await connection.query(
          "INSERT INTO categories (category_id, category_name, description) VALUES ($1, $2, $3)",
          [cat.category_id, cat.category_name, cat.description]
        );
      }
      await connection.query("SELECT setval('categories_category_id_seq', (SELECT MAX(category_id) FROM categories))");
      importedCounts.categories = categories.length;
    }

    // Import events
    if (events && events.length > 0) {
      await connection.query("TRUNCATE TABLE events CASCADE");
      for (const event of events) {
        await connection.query(
          `INSERT INTO events (event_id, title, description, capacity, locations, sessions, documents,
           category_id, start_time, end_time, created_at, created_by, image) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            event.event_id,
            event.title,
            event.description,
            event.capacity,
            event.locations ? JSON.stringify(event.locations) : null,
            event.sessions ? JSON.stringify(event.sessions) : null,
            event.documents ? JSON.stringify(event.documents) : null,
            event.category_id,
            event.start_time,
            event.end_time,
            event.created_at,
            event.created_by,
            event.image || '/uploads/events/default-event.png'
          ]
        );
      }
      await connection.query("SELECT setval('events_event_id_seq', (SELECT MAX(event_id) FROM events))");
      importedCounts.events = events.length;
    }

    // Import registrations
    if (registrations && registrations.length > 0) {
      await connection.query("TRUNCATE TABLE registrations CASCADE");
      for (const reg of registrations) {
        await connection.query(
          `INSERT INTO registrations (registration_id, user_id, event_id, registration_date, 
           status, ticket_type) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            reg.registration_id,
            reg.user_id,
            reg.event_id,
            reg.registered_at || reg.registration_time,
            reg.status,
            reg.ticket_type
          ]
        );
      }
      await connection.query("SELECT setval('registrations_registration_id_seq', (SELECT MAX(registration_id) FROM registrations))");
      importedCounts.registrations = registrations.length;
    }

    // Import tickets
    if (tickets && tickets.length > 0) {
      await connection.query("TRUNCATE TABLE tickets CASCADE");
      for (const ticket of tickets) {
        await connection.query(
          `INSERT INTO tickets (ticket_id, registration_id, ticket_number, qr_code, status, created_at) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ticket.ticket_id,
            ticket.registration_id,
            ticket.ticket_code || `TCKT-${ticket.ticket_id}`,
            ticket.qr_code || null,
            ticket.status || 'active',
            ticket.issue_time || ticket.created_at
          ]
        );
      }
      await connection.query("SELECT setval('tickets_ticket_id_seq', (SELECT MAX(ticket_id) FROM tickets))");
      importedCounts.tickets = tickets.length;
    }

    // Import saved_events
    if (saved_events && saved_events.length > 0) {
      await connection.query("TRUNCATE TABLE saved_events CASCADE");
      for (const saved of saved_events) {
        await connection.query(
          "INSERT INTO saved_events (saved_event_id, user_id, event_id, saved_at) VALUES ($1, $2, $3, $4)",
          [saved.saved_id, saved.user_id, saved.event_id, saved.created_at || saved.saved_at]
        );
      }
      await connection.query("SELECT setval('saved_events_saved_event_id_seq', (SELECT MAX(saved_event_id) FROM saved_events))");
      importedCounts.saved_events = saved_events.length;
    }

    // Import chatrooms
    if (chatrooms && chatrooms.length > 0) {
      await connection.query("TRUNCATE TABLE chatrooms CASCADE");
      for (const room of chatrooms) {
        await connection.query(
          "INSERT INTO chatrooms (chatroom_id, event_id, created_at) VALUES ($1, $2, $3)",
          [room.chatroom_id, room.event_id, room.created_at]
        );
      }
      await connection.query("SELECT setval('chatrooms_chatroom_id_seq', (SELECT MAX(chatroom_id) FROM chatrooms))");
      importedCounts.chatrooms = chatrooms.length;
    }

    // Import chat_messages
    if (chat_messages && chat_messages.length > 0) {
      await connection.query("TRUNCATE TABLE chat_messages CASCADE");
      for (const msg of chat_messages) {
        await connection.query(
          "INSERT INTO chat_messages (message_id, chatroom_id, user_id, message, created_at) VALUES ($1, $2, $3, $4, $5)",
          [msg.message_id, msg.chatroom_id, msg.user_id, msg.message, msg.created_at]
        );
      }
      await connection.query("SELECT setval('chat_messages_message_id_seq', (SELECT MAX(message_id) FROM chat_messages))");
      importedCounts.chat_messages = chat_messages.length;
    }

    // Import friends
    if (friends && friends.length > 0) {
      await connection.query("TRUNCATE TABLE friends CASCADE");
      for (const friend of friends) {
        await connection.query(
          "INSERT INTO friends (friendship_id, user_id, friend_id, status, created_at) VALUES ($1, $2, $3, $4, $5)",
          [friend.id, friend.user_id, friend.friend_id, friend.status, friend.created_at]
        );
      }
      await connection.query("SELECT setval('friends_friendship_id_seq', (SELECT MAX(friendship_id) FROM friends))");
      importedCounts.friends = friends.length;
    }

    // Import faqs
    if (faqs && faqs.length > 0) {
      await connection.query("TRUNCATE TABLE faqs CASCADE");
      for (const faq of faqs) {
        await connection.query(
          "INSERT INTO faqs (faq_id, question, answer, created_at) VALUES ($1, $2, $3, $4)",
          [faq.faq_id, faq.question, faq.answer, faq.created_at]
        );
      }
      await connection.query("SELECT setval('faqs_faq_id_seq', (SELECT MAX(faq_id) FROM faqs))");
      importedCounts.faqs = faqs.length;
    }

    // Import draft_events
    if (draft_events && draft_events.length > 0) {
      await connection.query("TRUNCATE TABLE draft_events CASCADE");
      for (const draft of draft_events) {
        await connection.query(
          `INSERT INTO draft_events (draft_id, owner_id, title, description, capacity, locations, sessions, 
           start_time, end_time, category_id, requires_approval, submitted_by, submitted_at, 
           status, attachments, documents) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [draft.draft_id, draft.submitted_by, draft.title, draft.description, draft.capacity,
           JSON.stringify(draft.locations), JSON.stringify(draft.sessions), draft.start_time, draft.end_time,
           draft.category_id, draft.requires_approval, draft.submitted_by, draft.submitted_at,
           draft.status, JSON.stringify(draft.attachments), JSON.stringify(draft.documents)]
        );
      }
      await connection.query("SELECT setval('draft_events_draft_id_seq', (SELECT MAX(draft_id) FROM draft_events))");
      importedCounts.draft_events = draft_events.length;
    }

    await connection.query("COMMIT");
    console.log("✅ All data imported successfully:", importedCounts);

    res.json({
      success: true,
      message: "Successfully imported all data",
      imported: importedCounts
    });

  } catch (error) {
    await connection.query("ROLLBACK");
    console.error("❌ Import all data failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to import data",
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

export default router;
