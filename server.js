// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";
import http from "http";
import { Server } from "socket.io";
import db from "./db.js";
import path from "path";

// Routes
import authRoutes from "./routes/auth.js";
import eventRoutes from "./routes/events.js";
import userCompatRoutes from "./routes/userCompat.js";
import notificationsRoutes from "./routes/notifications.js";
import announcementsRoutes, { startScheduler as startAnnouncementsScheduler } from "./routes/announcements.js";
import ticketRoutes from "./routes/tickets.js";
import registrationRoutes from "./routes/registrations.js";
import savedEventsRoutes from "./routes/savedEvents.js";
import faqsRoutes from "./routes/faqs.js";
import friendsRoutes from "./routes/friends.js";
import chatroomRoutes from "./routes/chatrooms.js";
import reviewsRoutes from "./routes/reviews.js";
import achievementsRoutes from "./routes/achievements.js";
import profileRoutes from "./routes/profile.js";
import draftsRoutes from "./routes/drafts.js";
import migrationRoutes from "./routes/migration.js";

dotenv.config();

const app = express();
const server = http.createServer(app); // wrap express server
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL 
      : ["http://localhost:5173", "http://localhost:3000"], // support Vite and CRA
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;

app.use(cors({ 
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : ["http://localhost:5173", "http://localhost:3000"], 
  credentials: true 
}));
app.use(express.json());
app.use(morgan("dev"));

// Test DB connection
try {
  const [rows] = await db.query("SELECT 1");
  console.log("DB connection works ✅");
} catch (err) {
  console.error("DB connection failed ❌:", err.message);
}

// Ensure required schema pieces exist (idempotent)
async function ensureSchema() {
  try {
    // Ensure draft_events.documents column exists (PostgreSQL)
    const [cols] = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'draft_events' AND column_name = 'documents'",
      []
    );
    if (!Array.isArray(cols) || cols.length === 0) {
      try {
        await db.query("ALTER TABLE draft_events ADD COLUMN documents JSONB NULL");
        console.log("✅ Added JSONB column 'documents' to draft_events");
      } catch (e) {
        console.warn("Adding JSONB column failed:", e.message);
      }
    }
  } catch (e) {
    console.warn("Schema check failed:", e.message);
  }

  // Ensure announcements table exists (PostgreSQL)
  try {
    const [annCols] = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'announcements'",
      []
    );
    if (!Array.isArray(annCols) || annCols.length === 0) {
      console.log("Creating 'announcements' table (PostgreSQL)...");
      await db.query(`
        CREATE TABLE IF NOT EXISTS announcements (
          announcement_id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'Draft',
          scheduled_at TIMESTAMPTZ NULL,
          created_by INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_at TIMESTAMPTZ NULL
        )
      `);
      console.log("✅ Created 'announcements' table");
    }
  } catch (e) {
    console.warn("Could not ensure announcements table:", e.message);
  }

    // Ensure ratings_reviews table exists (for storing user reviews)
    try {
      const [rr] = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ratings_reviews'",
        []
      );
      if (!Array.isArray(rr) || rr.length === 0) {
        console.log("Creating 'ratings_reviews' table...");
        if (process.env.DATABASE_URL) {
          // PostgreSQL
          await db.query(`
            CREATE TABLE IF NOT EXISTS ratings_reviews (
              review_id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL,
              event_id INTEGER NOT NULL,
              rating SMALLINT,
              review TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (user_id, event_id)
            )
          `, []);
        } else {
          // MySQL
          await db.query(`
            CREATE TABLE IF NOT EXISTS ratings_reviews (
              review_id INT AUTO_INCREMENT PRIMARY KEY,
              user_id INT NOT NULL,
              event_id INT NOT NULL,
              rating TINYINT,
              review TEXT,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uq_user_event (user_id, event_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
          `, []);
        }
        console.log("✅ Created 'ratings_reviews' table");
      }
    } catch (e) {
      console.warn('Could not ensure ratings_reviews table:', e.message);
    }
}
await ensureSchema();

// ----------------- Routes -----------------
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
// Compatibility: support older frontend paths like /api/user/joined -> mapped handlers
app.use("/api/user", userCompatRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/saved-events", savedEventsRoutes);
app.use("/api/faqs", faqsRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/chatrooms", chatroomRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/achievements", achievementsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/drafts", draftsRoutes);
app.use("/api/migration", migrationRoutes); // One-time migration endpoint
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Serve a default event image even if the physical file is missing
app.get("/uploads/events/default-event.png", (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="480">
    <rect width="100%" height="100%" fill="#f3f4f6"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#9ca3af">
      Event Image
    </text>
  </svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(svg);
});

app.get("/", (req, res) => {
  res.send("Evenza backend running ✅");
});

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack || err);
  if (res.headersSent) {
    // Delegate to default Express error handler if headers already sent
    return next(err);
  }
  res.status(500).json({ message: "Internal Server Error" });
});

// ----------------- Socket.IO -----------------
const onlineUsers = new Map();

// Helper to update DB user status
async function updateUserStatus(userId, status) {
  try {
    if (status === "Offline") {
      await db.query(
        "UPDATE users SET status = ?, last_seen = NOW() WHERE user_id = ?",
        [status, userId]
      );
    } else {
      await db.query("UPDATE users SET status = ? WHERE user_id = ?", [
        status,
        userId,
      ]);
    }
  } catch (err) {
    console.error("DB update error:", err.message);
  }
}

io.on("connection", (socket) => {
  console.log("🔗 A user connected:", socket.id);

  // When user goes online
  socket.on("user_online", async (userId) => {
    onlineUsers.set(userId, socket.id);
    await updateUserStatus(userId, "Online");

    io.emit("update_status", { userId, status: "Online" });
    console.log(`✅ User ${userId} is online`);
  });

  // When user logs out
  socket.on("logout", async (userId) => {
    onlineUsers.delete(userId);
    await updateUserStatus(userId, "Offline");

    io.emit("update_status", {
      userId,
      status: "Offline",
      last_seen: new Date(),
    });
    console.log(`🚪 User ${userId} logged out`);
  });

  // When user disconnects (closes tab/browser)
  socket.on("disconnect", async () => {
    let disconnectedUserId = null;

    for (let [userId, sockId] of onlineUsers.entries()) {
      if (sockId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUserId) {
      await updateUserStatus(disconnectedUserId, "Offline");

      io.emit("update_status", {
        userId: disconnectedUserId,
        status: "Offline",
        last_seen: new Date(),
      });
      console.log(`❌ User ${disconnectedUserId} disconnected`);
    }
  });
});

// ----------------- Start Server -----------------
// Add a friendly error handler to avoid an uncaught exception when the port is in use
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another process is listening on this port.`);
    console.error('Identify and stop the process using the port, or set a different PORT environment variable.');
    process.exit(1);
  }
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Start announcements scheduler (runs every minute)
try {
  if (typeof startAnnouncementsScheduler === 'function') {
    startAnnouncementsScheduler();
    console.log('Announcements scheduler started.');
  }
} catch (e) {
  console.warn('Failed to start announcements scheduler:', e.message);
}
