// routes/reviews.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/reviews
 * Returns: list of events that:
 *  - the logged-in user registered for (registrations table)
 *  - AND event.end_time <= NOW()  (completed events)
 * Also LEFT JOIN user's rating/review (if exists)
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    // Make sure your verifyToken sets req.user.user_id
    const userId = req.user?.user_id || req.user?.id;
    if (!userId) return res.status(400).json({ message: "User id missing from token" });

    const sql = `
      SELECT e.event_id,
             e.title,
             e.location,
             e.start_time,
             e.end_time,
             r.rating,
             r.review,
             r.created_at AS reviewed_at
      FROM events e
      INNER JOIN registrations reg ON reg.event_id = e.event_id
      LEFT JOIN ratings_reviews r ON r.event_id = e.event_id AND r.user_id = ?
      WHERE reg.user_id = ? AND e.end_time <= NOW()
      ORDER BY e.end_time DESC
    `;
    const [rows] = await db.query(sql, [userId, userId]);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/reviews error:", err);
    res.status(500).json({ message: "Failed to fetch completed events for review", error: err.message });
  }
});

/**
 * POST /api/reviews
 * Body: { event_id, rating, review }
 * Inserts or updates user's rating & review for an event
 */
router.post("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id || req.user?.id;
    if (!userId) return res.status(400).json({ message: "User id missing from token" });

    const { event_id, rating, review } = req.body;
    if (!event_id || !rating) {
      return res.status(400).json({ message: "event_id and rating are required" });
    }
    // Optionally: validate that user registered and event ended:
    const [[regCheck]] = await db.query(
      `SELECT 1 FROM registrations r
       JOIN events e ON e.event_id = r.event_id
       WHERE r.user_id = ? AND r.event_id = ? AND e.end_time <= NOW() LIMIT 1`,
      [userId, event_id]
    );
    if (!regCheck) {
      return res.status(403).json({ message: "You did not register for this event or it hasn't completed yet" });
    }

    // Upsert (Insert or update existing)
    // MySQL: use INSERT ... ON DUPLICATE KEY UPDATE (we created unique key on user_id,event_id)
    const insertSql = `
      INSERT INTO ratings_reviews (user_id, event_id, rating, review)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), created_at = CURRENT_TIMESTAMP
    `;
    await db.query(insertSql, [userId, event_id, rating, review || null]);

    res.json({ message: "Rating submitted" });
  } catch (err) {
    console.error("POST /api/reviews error:", err);
    res.status(500).json({ message: "Failed to submit rating", error: err.message });
  }
});

export default router;
