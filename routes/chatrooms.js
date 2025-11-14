// backend/routes/chatrooms.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Helper: parse various possible timestamp formats into a Date or null.
// - Accepts Date, ISO strings, numeric strings, numeric seconds or milliseconds.
// - If value looks like seconds (<= 1e12) treat as seconds and multiply by 1000.
const parsePossibleDate = (val) => {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  // handle numeric-like strings
  if (typeof val === 'string' && /^\d+$/.test(val)) {
    const n = Number(val);
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'number') {
    const ms = val > 1e12 ? val : val * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  // fallback: let Date try to parse (handles ISO, postgres timestamptz, etc.)
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Try to find a value whose key includes 'end' anywhere in the object (recursively).
const findEndValueInRow = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const seen = new Set();
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    for (const k of Object.keys(cur)) {
      try {
        const v = cur[k];
        if (/end/i.test(k) && v) return v;
        // if value is an object, dive in
        if (v && typeof v === 'object') stack.push(v);
        // if value is a JSON string, attempt parse and dive in
        if (typeof v === 'string' && v.trim().startsWith('{')) {
          try { const parsed = JSON.parse(v); if (parsed && typeof parsed === 'object') stack.push(parsed); } catch(e) { }
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
};

/**
 * GET /api/chatrooms
 * Return Global (1), Help (2), then event chatrooms that the user is registered for (status = 'confirmed')
 * BUT only include event chatrooms whose event has NOT completed (end_time > NOW()).
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    // Return fixed rooms (Global & Help) + event chatrooms where the user
    // is registered (confirmed) and the related event is not completed.
    // Implementation note: we avoid relying on specific event column names in SQL
    // by selecting full event rows and doing robust parsing in JS.

    // 1) fixed rooms
    const [fixedRows] = await db.query(
      `SELECT * FROM chatrooms WHERE chatroom_id IN (1,2) ORDER BY chatroom_id`
    );

    // 2) get confirmed registrations for this user
    const [regs] = await db.query(
      `SELECT DISTINCT event_id FROM registrations WHERE user_id = ? AND LOWER(status) = 'confirmed'`,
      [userId]
    );

    const eventChatrooms = [];
    const now = new Date();

    for (const r of regs || []) {
      const evId = r.event_id;
      if (!evId) continue;

      // load event row (SELECT * safe across DBs)
      const [[eventRow]] = await db.query(`SELECT * FROM events WHERE event_id = ? LIMIT 1`, [evId]);
      if (!eventRow) continue;

      // find a sensible end timestamp from the event row
      let endVal = null;
      const possibleEndKeys = Object.keys(eventRow).filter(k => /end/i.test(k));
      for (const k of possibleEndKeys) {
        if (eventRow[k]) { endVal = eventRow[k]; break; }
      }
      // if not found directly, try to probe nested JSON/string fields
      if (!endVal) {
        const nested = findEndValueInRow(eventRow);
        if (nested) endVal = nested;
      }

      // DEBUG: log inspected event end value and parsed date so we can check Render logs
      try {
        const parsed = parsePossibleDate(endVal);
        console.debug && console.debug(`chatrooms: event ${evId} endVal=${String(endVal)} parsed=${parsed ? parsed.toISOString() : 'null'}`);
      } catch (e) {
        console.debug && console.debug(`chatrooms: event ${evId} endVal parsing error`);
      }

      const endDate = parsePossibleDate(endVal);
      // if endDate exists and is <= now, skip (completed)
      if (endDate && endDate <= now) continue;

      // event is upcoming (or end unknown) -> include its chatroom
      const [[chatroomRow]] = await db.query(`SELECT * FROM chatrooms WHERE event_id = ? LIMIT 1`, [evId]);
      if (!chatroomRow) continue;

      // normalize name and type
      const eventTitle = eventRow.title || eventRow.event_name || eventRow.event_title || chatroomRow.name || chatroomRow.chatroom_name;
      const name = eventTitle || chatroomRow.chatroom_name || chatroomRow.room_name || `Chatroom ${chatroomRow.chatroom_id}`;
      const type = chatroomRow.type || (chatroomRow.event_id ? 'event' : 'channel');

      eventChatrooms.push({
        chatroom_id: chatroomRow.chatroom_id,
        name,
        type,
        event_id: chatroomRow.event_id,
        end_time: endVal || null,
      });
    }

    const normalizeRoom = (row) => {
      const eventTitle = row.title || row.event_name || row.event_title || row.name || row.eventName;
      let name = eventTitle || row.chatroom_name || row.room_name || `Chatroom ${row.chatroom_id}`;
      if (row.chatroom_id === 1) name = row.name || 'Global Chat';
      if (row.chatroom_id === 2) name = row.name || 'Help Chat';
      const type = row.type || (row.event_id ? 'event' : 'channel');
      return {
        chatroom_id: row.chatroom_id,
        name,
        type,
        event_id: row.event_id,
        end_time: row.end_time || row.ends_at || row.end || row.event_end || null,
      };
    };

    const fixed = (fixedRows || []).map((r) => normalizeRoom(r));

    res.json([ ...fixed, ...eventChatrooms ]);
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
      `SELECT * FROM chatrooms WHERE chatroom_id IN (1,2) ORDER BY chatroom_id`
    );

    // 2) ensure each owned NOT-COMPLETED event (end_time > NOW()) has a chatroom; create if missing
    const [ownedEvents] = await db.query(
      `SELECT e.* FROM events e WHERE e.created_by = ?`,
      [userId]
    );

    const eventRooms = [];
    for (const ev of ownedEvents || []) {
      // skip events that are already completed (JS check)
      const end = ev.end_time || ev.ends_at || ev.end || null;
      if (end) {
        const parsed = parsePossibleDate(end);
        if (parsed && parsed <= new Date()) continue;
      }
      // find chatroom for this event
      const [[existing]] = await db.query(
        `SELECT * FROM chatrooms WHERE event_id = ? LIMIT 1`,
        [ev.event_id]
      );
      if (existing) {
        eventRooms.push(existing);
      } else {
        // create one - handle both MySQL and PostgreSQL
        const name = ev.title || `Event ${ev.event_id}`;
        let chatroomId;
        if (process.env.DATABASE_URL) {
          // PostgreSQL - use RETURNING (use parameter placeholders supported by db wrapper)
          const [rows] = await db.query(
            `INSERT INTO chatrooms (name, type, event_id) VALUES (?, 'event', ?) RETURNING chatroom_id`,
            [name, ev.event_id]
          );
          chatroomId = rows && rows[0] ? rows[0].chatroom_id : undefined;
        } else {
          // MySQL - use insertId
          const [ins] = await db.query(
            `INSERT INTO chatrooms (name, type, event_id) VALUES (?, 'event', ?)`,
            [name, ev.event_id]
          );
          chatroomId = ins.insertId;
        }
        eventRooms.push({ chatroom_id: chatroomId, name, type: 'event', event_id: ev.event_id });
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
      `SELECT * FROM chatrooms WHERE chatroom_id IN (1,2) ORDER BY chatroom_id`
    );

    // 2) ALL event rooms (but only include upcoming events -> filter completed events)
    const [eventRows] = await db.query(
      `SELECT DISTINCT c.*, e.*
       FROM chatrooms c
       JOIN events e ON e.event_id = c.event_id
       WHERE c.event_id IS NOT NULL
       ORDER BY c.chatroom_id DESC`
    );

    // Normalize and filter out completed events (do in JS to avoid DB column-name assumptions)
    const normalizeRoom = (row) => {
      const eventTitle = row.title || row.event_name || row.name || row.event_title || row.eventName;
      let name = eventTitle || row.chatroom_name || row.room_name || `Chatroom ${row.chatroom_id}`;
      if (row.chatroom_id === 1) name = row.name || 'Global Chat';
      if (row.chatroom_id === 2) name = row.name || 'Help Chat';
      const type = row.type || (row.event_id ? 'event' : 'channel');
      return {
        chatroom_id: row.chatroom_id,
        name,
        type,
        event_id: row.event_id,
        end_time: row.end_time || row.ends_at || row.end || row.event_end || null,
      };
    };

    const fixed = (fixedRows || []).map((r) => normalizeRoom(r));
    const now = new Date();
    const eventFiltered = (eventRows || []).map((r) => normalizeRoom(r)).filter((r) => {
      if (!r.event_id) return false;
      const end = r.end_time;
      if (!end) return true;
      const endDate = parsePossibleDate(end);
      return !endDate ? true : endDate > now;
    });

    res.json([ ...fixed, ...eventFiltered ]);
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
      `SELECT c.chatroom_id, c.event_id, e.*
       FROM chatrooms c
       LEFT JOIN events e ON e.event_id = c.event_id
       WHERE c.chatroom_id = ? LIMIT 1`,
      [chatroomId]
    );

    // Derive a stable `type` field if the DB doesn't have it
    if (chatroom && !chatroom.type) {
      chatroom.type = chatroom.event_id ? 'event' : 'channel';
    }

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
      if (!isOwner && chatroom.end_time) {
        const parsedEnd = parsePossibleDate(chatroom.end_time);
        if (parsedEnd && parsedEnd <= new Date()) {
          return res.status(403).json({ error: "Event has ended; chat is closed" });
        }
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
      `SELECT c.chatroom_id, c.event_id, e.*
       FROM chatrooms c
       LEFT JOIN events e ON e.event_id = c.event_id
       WHERE c.chatroom_id = ? LIMIT 1`,
      [chatroomId]
    );

    if (chatroom && !chatroom.type) {
      chatroom.type = chatroom.event_id ? 'event' : 'channel';
    }

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
      if (!isOwner && chatroom.end_time) {
        const parsedEnd = parsePossibleDate(chatroom.end_time);
        if (parsedEnd && parsedEnd <= new Date()) {
          return res.status(403).json({ error: "Event has ended; chat is closed" });
        }
      }
    }

    // Insert message - handle both MySQL and PostgreSQL
    let messageId;
    if (process.env.DATABASE_URL) {
      // PostgreSQL - use RETURNING
      const [rows] = await db.query(
        "INSERT INTO chat_messages (chatroom_id, user_id, message) VALUES (?, ?, ?) RETURNING message_id",
        [chatroomId, userId, message]
      );
      messageId = rows && rows[0] ? rows[0].message_id : undefined;
    } else {
      // MySQL - use insertId
      const [result] = await db.query(
        "INSERT INTO chat_messages (chatroom_id, user_id, message) VALUES (?, ?, ?)",
        [chatroomId, userId, message]
      );
      messageId = result.insertId;
    }

    const [[inserted]] = await db.query(
      `SELECT m.message_id, m.chatroom_id, m.user_id, m.message, m.created_at, u.username
       FROM chat_messages m
       JOIN users u ON m.user_id = u.user_id
       WHERE m.message_id = ? LIMIT 1`,
      [messageId]
    );

    res.status(201).json(inserted);
  } catch (err) {
    console.error("chatrooms messages POST error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
