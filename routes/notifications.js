// routes/notifications.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get notifications for logged in user
router.get("/user", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(400).json({ message: "User ID missing" });
    }

    const [rows] = await db.execute(
      `SELECT n.notification_id, n.title, n.message, n.status, n.is_read,
              n.created_at, e.title AS event_title
       FROM notifications n
       LEFT JOIN events e ON n.event_id = e.event_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

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

