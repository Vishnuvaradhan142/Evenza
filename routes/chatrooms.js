// backend/routes/chatrooms.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/chatrooms
 * Return Global (1), Help (2), then event chatrooms that the user is registered for (status = 'confirmed')
 * BUT only include event chatrooms whose event has NOT completed (end_time > NOW()).
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    // 1) fixed rooms: Global (1) and Help (2)
    const [fixedRows] = await db.query(
      `SELECT chatroom_id, name, type, event_id
       FROM chatrooms
       WHERE chatroom_id IN (1,2)
       ORDER BY FIELD(chatroom_id, 1, 2)`
    );

    // 2) event rooms where the user has a confirmed registration AND event is NOT completed
    const [eventRows] = await db.query(
      `SELECT DISTINCT c.chatroom_id, c.name, c.type, c.event_id
       FROM chatrooms c
       JOIN events e ON e.event_id = c.event_id
       JOIN registrations r ON r.event_id = c.event_id
       WHERE c.type = 'event'
         AND r.user_id = ?
         AND LOWER(r.status) = 'confirmed'
         AND e.end_time > NOW()
       ORDER BY c.chatroom_id ASC`,
      [userId]
    );

    res.json([...fixedRows, ...eventRows]);
  } catch (err) {
    console.error("chatrooms GET error:", err);
    res.status(500).json({ error: "Failed to fetch chatrooms" });
  }
});

/**
 * GET /api/chatrooms/admin/mine
 * Returns event chatrooms for events CREATED by the logged-in user (admin),
 * only for events that have NOT completed (end_time > NOW()).
 */
router.get("/admin/mine", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    // 1) fixed rooms for admins too: Global (1) and Help (2)
    const [fixedRows] = await db.query(
      `SELECT chatroom_id, name, type, event_id
       FROM chatrooms
       WHERE chatroom_id IN (1,2)
       ORDER BY FIELD(chatroom_id, 1, 2)`
    );

    // 2) ensure each owned NOT-COMPLETED event (end_time > NOW()) has a chatroom; create if missing
    const [ownedEvents] = await db.query(
      `SELECT e.event_id, e.title, e.start_time, e.end_time
       FROM events e
       WHERE e.created_by = ?
         AND e.end_time > NOW()
       ORDER BY e.start_time DESC, e.event_id DESC`,
      [userId]
    );

    const eventRooms = [];
    for (const ev of ownedEvents || []) {
      // find chatroom for this event
      const [[existing]] = await db.query(
        `SELECT chatroom_id, name, type, event_id FROM chatrooms WHERE event_id = ? LIMIT 1`,
        [ev.event_id]
      );
      if (existing) {
        eventRooms.push(existing);
      } else {
        // create one
        const name = ev.title || `Event ${ev.event_id}`;
        const [ins] = await db.query(
          `INSERT INTO chatrooms (name, type, event_id) VALUES (?, 'event', ?)`,
          [name, ev.event_id]
        );
        eventRooms.push({ chatroom_id: ins.insertId, name, type: 'event', event_id: ev.event_id });
      }
    }

    res.json([...(fixedRows || []), ...eventRooms]);
  } catch (err) {
    console.error("chatrooms admin/mine GET error:", err);
    res.status(500).json({ error: "Failed to fetch admin chatrooms" });
  }
});

/**
 * GET /api/chatrooms/owner/all
 * Returns ALL event chatrooms for owner to monitor/participate
 * Includes Global, Help, and all event chatrooms
 */
router.get("/owner/all", verifyToken, async (req, res) => {
  try {
    // 1) fixed rooms: Global (1) and Help (2)
    const [fixedRows] = await db.query(
      `SELECT chatroom_id, name, type, event_id
       FROM chatrooms
       WHERE chatroom_id IN (1,2)
       ORDER BY FIELD(chatroom_id, 1, 2)`
    );

    // 2) ALL event rooms (not just owned by owner)
    const [eventRows] = await db.query(
      `SELECT c.chatroom_id, c.name, c.type, c.event_id
       FROM chatrooms c
       WHERE c.type = 'event'
       ORDER BY c.chatroom_id DESC`
    );

    res.json([...(fixedRows || []), ...(eventRows || [])]);
  } catch (err) {
    console.error("chatrooms owner/all GET error:", err);
    res.status(500).json({ error: "Failed to fetch owner chatrooms" });
  }
});

/**
 * GET /api/chatrooms/:chatroom_id/messages
 * Returns messages for chatroom. If room is event-type, ensure:
 *  - user is registered (confirmed) OR user is owner
 *  - event has NOT completed (end_time > NOW())
 */
router.get("/:chatroom_id/messages", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role; // assuming role is in JWT
    const chatroomId = Number(req.params.chatroom_id);

    // fetch chatroom and related event end_time (if any)
    const [[chatroom]] = await db.query(
      `SELECT c.chatroom_id, c.type, c.event_id, e.end_time, e.created_by
       FROM chatrooms c
       LEFT JOIN events e ON e.event_id = c.event_id
       WHERE c.chatroom_id = ? LIMIT 1`,
      [chatroomId]
    );

    if (!chatroom) return res.status(404).json({ error: "Chatroom not found" });

    if (chatroom.type === "event") {
      const isOwner = userRole === 'owner';
      const isCreator = chatroom.created_by && Number(chatroom.created_by) === Number(userId);

      // Owner can access all chatrooms, creator can access their own, others need registration
      if (!isOwner && !isCreator) {
        const [regs] = await db.query(
          `SELECT 1
           FROM registrations
           WHERE user_id = ? AND event_id = ? AND LOWER(status) = 'confirmed'
           LIMIT 1`,
          [userId, chatroom.event_id]
        );
        if (!regs || regs.length === 0) {
          return res.status(403).json({ error: "You are not registered for this event" });
        }
      }

      // ensure event not completed (skip check for owner to allow monitoring)
      if (!isOwner && chatroom.end_time && new Date(chatroom.end_time) <= new Date()) {
        return res.status(403).json({ error: "Event has ended; chat is closed" });
      }
    }

    const [messages] = await db.query(
      `SELECT m.message_id, m.chatroom_id, m.user_id, m.message, m.created_at, u.username
       FROM chat_messages m
       JOIN users u ON m.user_id = u.user_id
       WHERE m.chatroom_id = ?
       ORDER BY m.created_at ASC`,
      [chatroomId]
    );

    res.json(messages);
  } catch (err) {
    console.error("chatrooms messages GET error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * POST /api/chatrooms/:chatroom_id/messages
 * Insert a new message. For event rooms, require registration or owner/creator access, and event not completed.
 */
router.post("/:chatroom_id/messages", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    const chatroomId = Number(req.params.chatroom_id);
    const { message } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const [[chatroom]] = await db.query(
      `SELECT c.chatroom_id, c.type, c.event_id, e.end_time, e.created_by
       FROM chatrooms c
       LEFT JOIN events e ON e.event_id = c.event_id
       WHERE c.chatroom_id = ? LIMIT 1`,
      [chatroomId]
    );

    if (!chatroom) return res.status(404).json({ error: "Chatroom not found" });

    if (chatroom.type === "event") {
      const isOwner = userRole === 'owner';
      const isCreator = chatroom.created_by && Number(chatroom.created_by) === Number(userId);

      // Owner can post to all chatrooms, creator can post to their own, others need registration
      if (!isOwner && !isCreator) {
        const [regs] = await db.query(
          `SELECT 1
           FROM registrations
           WHERE user_id = ? AND event_id = ? AND LOWER(status) = 'confirmed'
           LIMIT 1`,
          [userId, chatroom.event_id]
        );
        if (!regs || regs.length === 0) {
          return res.status(403).json({ error: "You are not registered for this event" });
        }
      }

      // ensure event not completed (skip check for owner)
      if (!isOwner && chatroom.end_time && new Date(chatroom.end_time) <= new Date()) {
        return res.status(403).json({ error: "Event has ended; chat is closed" });
      }
    }

    const [result] = await db.query(
      "INSERT INTO chat_messages (chatroom_id, user_id, message) VALUES (?, ?, ?)",
      [chatroomId, userId, message]
    );

    const [[inserted]] = await db.query(
      `SELECT m.message_id, m.chatroom_id, m.user_id, m.message, m.created_at, u.username
       FROM chat_messages m
       JOIN users u ON m.user_id = u.user_id
       WHERE m.message_id = ? LIMIT 1`,
      [result.insertId]
    );

    res.status(201).json(inserted);
  } catch (err) {
    console.error("chatrooms messages POST error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
