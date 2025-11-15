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

    // Select registrations/events and filter completed events in JS to avoid SQL column-missing errors
    const sql = `
      SELECT e.*, r.rating, r.review, r.created_at AS reviewed_at, reg.*
      FROM events e
      INNER JOIN registrations reg ON reg.event_id = e.event_id
      LEFT JOIN ratings_reviews r ON r.event_id = e.event_id AND r.user_id = ?
      WHERE reg.user_id = ?
    `;
    const [rows] = await db.query(sql, [userId, userId]);

    const now = new Date();
    const filtered = (rows || []).filter((row) => {
      const end = row.end_time || row.ends_at || row.end || null;
      if (!end) return false; // if we can't determine end, exclude from completed
      const endDate = new Date(end);
      return !isNaN(endDate.getTime()) && endDate <= now;
    }).map((row) => ({
      event_id: row.event_id,
      title: row.title,
      location: row.location || null,
      start_time: row.start_time || null,
      end_time: row.end_time || null,
      rating: row.rating || null,
      review: row.review || null,
      reviewed_at: row.reviewed_at || null,
    }));

    // Sort by end_time desc
    filtered.sort((a, b) => {
      const aEnd = new Date(a.end_time || 0).getTime();
      const bEnd = new Date(b.end_time || 0).getTime();
      return bEnd - aEnd;
    });

    res.json(filtered);
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
    // Verify registration exists and that event has completed using JS-safe checks
    const [regRows] = await db.query(
      `SELECT r.*, e.end_time FROM registrations r JOIN events e ON e.event_id = r.event_id WHERE r.user_id = ? AND r.event_id = ? LIMIT 1`,
      [userId, event_id]
    );
    const regCheck = regRows && regRows[0];
    if (!regCheck) {
      return res.status(403).json({ message: "You did not register for this event" });
    }
    const endTime = regCheck.end_time || regCheck.ends_at || regCheck.end || null;
    if (!endTime || isNaN(new Date(endTime).getTime()) || new Date(endTime) > new Date()) {
      return res.status(403).json({ message: "Event has not completed yet" });
    }

    // Upsert (Insert or update existing)
    // Support both MySQL (ON DUPLICATE KEY) and PostgreSQL (ON CONFLICT)
    if (process.env.DATABASE_URL) {
      // PostgreSQL
      const pgUpsert = `
        INSERT INTO ratings_reviews (user_id, event_id, rating, review, created_at)
        VALUES (?, ?, ?, ?, NOW())
        ON CONFLICT (user_id, event_id) DO UPDATE SET rating = EXCLUDED.rating, review = EXCLUDED.review, created_at = NOW()
      `;
      await db.query(pgUpsert, [userId, event_id, rating, review || null]);
    } else {
      // MySQL
      const myUpsert = `
        INSERT INTO ratings_reviews (user_id, event_id, rating, review)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), created_at = CURRENT_TIMESTAMP
      `;
      await db.query(myUpsert, [userId, event_id, rating, review || null]);
    }

    res.json({ message: "Rating submitted" });
  } catch (err) {
    console.error("POST /api/reviews error:", err);
    res.status(500).json({ message: "Failed to submit rating", error: err.message });
  }
});

// ---------------- Admin: list reviews for admin's events ----------------
// GET /api/reviews/admin - Owner can see all reviews
router.get("/admin", async (req, res) => {
  try {
    const { event_id } = req.query || {};

    let sql = `
      SELECT 
        rr.review_id,
        rr.user_id,
        rr.event_id,
        rr.rating,
        rr.review,
        rr.created_at,
        e.title AS event_title,
        COALESCE(u.username, CONCAT('User ', rr.user_id)) AS user_display_name
      FROM ratings_reviews rr
      JOIN events e ON e.event_id = rr.event_id
      LEFT JOIN users u ON u.user_id = rr.user_id
    `;
    
    const params = [];
    if (event_id) {
      sql += ` WHERE rr.event_id = ?`;
      params.push(event_id);
    }
    sql += ` ORDER BY rr.created_at DESC`;

    const [rows] = await db.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error('GET /api/reviews/admin error:', err);
    res.status(500).json({ message: 'Failed to fetch reviews', error: err.message });
  }
});

/**
 * DELETE /api/reviews/:event_id
 * Deletes the logged-in user's review for the given event
 */
router.delete("/:event_id", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.user_id || req.user?.id;
    if (!userId) return res.status(400).json({ message: "User id missing from token" });

    const eventId = req.params.event_id;
    if (!eventId) return res.status(400).json({ message: "event_id is required" });

    // Delete only if the review belongs to the user
    console.debug('DELETE /api/reviews request', { userId, eventId });
    const deleteSql = `DELETE FROM ratings_reviews WHERE user_id = ? AND event_id = ?`;
    const result = await db.query(deleteSql, [userId, eventId]);
    console.debug('DELETE /api/reviews db result:', result);

    // Informative response for debugging: if nothing deleted, still return 200 but include info
    res.json({ message: 'Review deleted', debug: { dbResult: Array.isArray(result) ? result[0] : result } });
  } catch (err) {
    console.error('DELETE /api/reviews/:event_id error:', err);
    res.status(500).json({ message: 'Failed to delete review', error: err.message });
  }
});

export default router;
