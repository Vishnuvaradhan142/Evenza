// backend/routes/events.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /
 * Get all not-completed events (end_time >= NOW()).
 * Optional query param: q (search title/description)
 */
router.get("/", async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : null;

    // Build WHERE clause: only not completed events
    let sql = `
      SELECT
        e.event_id,
        e.title,
        e.description,
        e.location,
        e.start_time,
        e.end_time,
        e.latitude,
        e.longitude,
        COALESCE(c.name, 'General') AS category,
        e.created_by
      FROM events e
      LEFT JOIN categories c ON e.category_id = c.category_id
      WHERE e.end_time >= NOW()
    `;

    const params = [];
    if (q) {
      sql += ` AND (e.title LIKE ? OR e.description LIKE ?)`;
      params.push(q, q);
    }

    // REMOVED LIMIT to get all events
    sql += ` ORDER BY e.start_time ASC`;

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching events:", err.stack || err);
    res.status(500).json({ message: "Error fetching events" });
  }
});

/**
 * GET /:id
 * Get single event details (returns even if completed)
 */
router.get("/:id", async (req, res) => {
  try {
    const eventId = req.params.id;
    const [rows] = await db.execute(
      `SELECT
         e.*,
         COALESCE(c.name, 'General') AS category
       FROM events e
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE e.event_id = ?`,
      [eventId]
    );

    if (!rows[0]) return res.status(404).json({ message: "Event not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching event:", err.stack || err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * User's joined events
 */
router.get("/user/joined", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT e.event_id, e.title, e.description, e.location,
              e.start_time, e.end_time, c.name AS category,
              r.registered_at AS registration_date,
              r.status AS registration_status
       FROM events e
       JOIN registrations r ON e.event_id = r.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE r.user_id = ?
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching user joined events:", err.stack || err);
    res.status(500).json({ message: "Error fetching joined events" });
  }
});

/**
 * User's upcoming events
 */
router.get("/user/upcoming", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT e.event_id, e.title, e.description, e.location,
              e.start_time, e.end_time, c.name AS category,
              r.registered_at AS registration_date,
              r.status AS registration_status
       FROM events e
       JOIN registrations r ON e.event_id = r.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE r.user_id = ? AND e.start_time >= NOW()
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching upcoming events:", err.stack || err);
    res.status(500).json({ message: "Error fetching upcoming events" });
  }
});

/**
 * Joined count
 */
router.get("/stats/joined", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT COUNT(*) AS joinedCount
       FROM registrations
       WHERE user_id = ?`,
      [userId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching joined count:", err.stack || err);
    res.status(500).json({ message: "Error fetching joined count" });
  }
});

/**
 * Upcoming count
 */
router.get("/stats/upcoming", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT COUNT(*) AS upcomingCount
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       WHERE r.user_id = ? AND e.start_time >= NOW()`,
      [userId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching upcoming count:", err.stack || err);
    res.status(500).json({ message: "Error fetching upcoming count" });
  }
});

export default router;