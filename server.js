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
import notificationsRoutes from "./routes/notifications.js";
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

dotenv.config();

const app = express();
const server = http.createServer(app); // wrap express server
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000"], // support Vite and CRA
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000"], credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// Test DB connection
try {
  const [rows] = await db.query("SELECT 1");
  console.log("DB connection works ✅");
} catch (err) {
  console.error("DB connection failed ❌:", err.message);
}

// ----------------- Routes -----------------
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/notifications", notificationsRoutes);
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
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/", (req, res) => {
  res.send("Evenza backend running ✅");
});

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
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
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
