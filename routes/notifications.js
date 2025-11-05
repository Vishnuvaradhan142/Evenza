// routes/notifications.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get notifications for logged in user (only from notifications table)
router.get("/user", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(400).json({ message: "User ID missing" });
    }

    const [rows] = await db.execute(
      `SELECT notification_id, user_id, event_id, type, title, message, status, is_read, created_at, sent_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

// Get notifications for events created by the authenticated owner (owner view)
// Optional query param: event_id to filter a single event
router.get("/owner", verifyToken, async (req, res) => {
  try {
    const ownerId = req.user?.user_id;
    if (!ownerId) return res.status(401).json({ message: "Unauthorized" });

    const { event_id } = req.query || {};
    const params = [ownerId];
    let sql = `
      SELECT 
        notification_id,
        user_id,
        event_id,
        type,
        title,
        message,
        status,
        is_read,
        scheduled_at,
        scheduled_by,
        attempts,
        error_message,
        created_at,
        sent_at
      FROM notifications
      WHERE scheduled_by = ?
    `;

    if (event_id) {
      sql += ` AND event_id = ?`;
      params.push(event_id);
    }

    sql += ` ORDER BY created_at DESC`;

    const [rows] = await db.execute(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error("Error fetching owner notifications:", err);
    res.status(500).json({ message: "Error fetching owner notifications" });
  }
});

// Create notifications (bulk) - only notifications table
router.post("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { recipients, event_id = null, title, message, status = "pending", scheduled_at = null } = req.body || {};
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: "recipients (array of user_id) is required" });
    }
    if (!title || !message) {
      return res.status(400).json({ message: "title and message are required" });
    }
    const allowed = ["pending", "scheduled", "sent"]; // use lowercase internally
    const normStatus = String(status).toLowerCase();
    if (!allowed.includes(normStatus)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowed.join(", ")}` });
    }

    let scheduledAt = null;
    if (normStatus === "scheduled") {
      if (!scheduled_at) return res.status(400).json({ message: "scheduled_at is required when status is scheduled" });
      const dt = new Date(scheduled_at);
      if (isNaN(dt.getTime())) return res.status(400).json({ message: "scheduled_at must be a valid datetime" });
      scheduledAt = dt;
    }

    const now = new Date();
    const sentAt = normStatus === "sent" ? now : null;

    const values = recipients.map(uid => [
      uid,            // user_id
      event_id,       // event_id (nullable)
      "in-app",      // type
      title,
      message,
      normStatus,     // status
      0,              // is_read
      scheduledAt,    // scheduled_at
      userId,         // scheduled_by (creator)
      0,              // attempts
      null,           // error_message
      now,            // created_at
      sentAt          // sent_at
    ]);

    const [result] = await db.query(
      `INSERT INTO notifications (
        user_id, event_id, type, title, message, status, is_read,
        scheduled_at, scheduled_by, attempts, error_message,
        created_at, sent_at
      ) VALUES ?`,
      [values]
    );

    return res.json({ ok: true, inserted: result.affectedRows, requested: recipients.length });
  } catch (err) {
    console.error("Error creating notifications:", err);
    return res.status(500).json({ message: "Error creating notifications" });
  }
});

// Update a notification (owner/creator only via scheduled_by)
router.patch("/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { id } = req.params;
    const { title, message, status, scheduled_at } = req.body || {};

    const [rows] = await db.execute("SELECT * FROM notifications WHERE notification_id = ? AND scheduled_by = ?", [id, userId]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Notification not found or not owned by you" });

    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push("title = ?"); params.push(title); }
    if (message !== undefined) { updates.push("message = ?"); params.push(message); }
    if (status !== undefined) { updates.push("status = ?"); params.push(String(status).toLowerCase()); }
    if (scheduled_at !== undefined) { updates.push("scheduled_at = ?"); params.push(scheduled_at ? new Date(scheduled_at) : null); }
    if (status && String(status).toLowerCase() === "sent") { updates.push("sent_at = ?"); params.push(new Date()); }
    if (updates.length === 0) return res.json({ ok: true });

    params.push(id, userId);
    await db.execute(`UPDATE notifications SET ${updates.join(', ')} WHERE notification_id = ? AND scheduled_by = ?`, params);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error updating notification:", err);
    return res.status(500).json({ message: "Error updating notification" });
  }
});

// Send (mark as sent) a notification (owner/creator only)
router.post("/:id/send", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { id } = req.params;
    const [rows] = await db.execute("SELECT notification_id FROM notifications WHERE notification_id = ? AND scheduled_by = ?", [id, userId]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Notification not found or not owned by you" });
    await db.execute("UPDATE notifications SET status = 'sent', sent_at = ? WHERE notification_id = ? AND scheduled_by = ?", [new Date(), id, userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Error sending notification:", err);
    return res.status(500).json({ message: "Error sending notification" });
  }
});

// Scheduler: mark due scheduled notifications as sent
let schedulerInterval = null;
function startScheduler(intervalMs = 60 * 1000) {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(async () => {
    try {
      const [rows] = await db.execute("SELECT notification_id FROM notifications WHERE status = 'scheduled' AND scheduled_at <= ?", [new Date()]);
      for (const r of rows || []) {
        try {
          await db.execute("UPDATE notifications SET status = 'sent', sent_at = ? WHERE notification_id = ?", [new Date(), r.notification_id]);
        } catch (e) {
          console.error('[notifications.scheduler] failed to send', r.notification_id, e.message);
        }
      }
    } catch (e) {
      console.error('[notifications.scheduler] error', e.message);
    }
  }, intervalMs);
}

export { startScheduler };

// Mark a notification as read
router.put("/:id/read", verifyToken, async (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user?.user_id;

  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!notificationId) return res.status(400).json({ message: "Notification id required" });

  try {
    // Ensure that notification belongs to this user (optional but safer)
    const [rows] = await db.execute(
      `SELECT notification_id, is_read, user_id FROM notifications WHERE notification_id = ?`,
      [notificationId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const notif = rows[0];
    if (Number(notif.user_id) !== Number(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Only update if currently unread (optional optimization)
    if (!Number(notif.is_read)) {
      await db.execute(
        `UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
        [notificationId, userId]
      );
    }

    return res.json({ success: true, notification_id: notificationId });
  } catch (err) {
    console.error("Error marking notification read:", err);
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
});

export default router;

