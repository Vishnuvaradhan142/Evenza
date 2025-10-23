import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Get waitlisted (pending) events for the logged-in user
 * Also returns if notification is already sent for each event
 */
router.get("/my-waitlist", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT 
          r.registration_id,
          TRIM(LOWER(r.status)) AS status,
          e.event_id,
          e.title AS eventName,
          e.start_time,
          e.end_time,
          e.location,
          e.description,
          COALESCE(c.name, 'General') AS category,
          CASE 
            WHEN n.notification_id IS NOT NULL THEN 1 
            ELSE 0 
          END AS already_notified
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       LEFT JOIN notifications n ON n.user_id = r.user_id 
         AND n.event_id = e.event_id 
         AND n.type = 'in-app'
       WHERE r.user_id = ? 
         AND TRIM(LOWER(r.status)) = 'pending'
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching waitlisted events:", err);
    res.status(500).json({ message: "Error fetching waitlisted events" });
  }
});

/**
 * Remove (cancel) waitlist entry
 */
router.delete("/cancel/:registrationId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { registrationId } = req.params;

    const [result] = await db.execute(
      `DELETE FROM registrations 
       WHERE registration_id = ? AND user_id = ? AND TRIM(LOWER(status)) = 'pending'`,
      [registrationId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Waitlist entry not found or cannot be removed" });
    }

    res.json({ message: "Successfully removed from waitlist" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Notify Me
 * Prevents duplicate notifications
 */
router.post("/notify/:registrationId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { registrationId } = req.params;

    // Get event_id from registration
    const [registrations] = await db.execute(
      `SELECT event_id FROM registrations WHERE registration_id = ? AND user_id = ?`,
      [registrationId, userId]
    );

    if (!registrations[0]) {
      return res.status(404).json({ message: "Registration not found" });
    }

    const eventId = registrations[0].event_id;

    // Check if notification already exists
    const [existing] = await db.execute(
      `SELECT notification_id FROM notifications WHERE user_id = ? AND event_id = ? AND type = 'in-app'`,
      [userId, eventId]
    );

    if (existing.length > 0) {
      return res.status(200).json({ message: "Already notified", already_notified: true });
    }

    // Get event title
    const [events] = await db.execute(
      `SELECT title FROM events WHERE event_id = ?`,
      [eventId]
    );

    const eventTitle = events[0].title;

    // Insert notification
    await db.execute(
      `INSERT INTO notifications (user_id, event_id, type, title, message, status, is_read)
       VALUES (?, ?, 'in-app', ?, ?, 'pending', 0)`,
      [userId, eventId, `Waitlist Notification: ${eventTitle}`, `You will be notified when a spot opens for "${eventTitle}".`]
    );

    res.json({ message: "Notification created", already_notified: true });
  } catch (err) {
    console.error("Error creating notification:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
