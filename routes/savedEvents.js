// routes/savedEvents.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Get all saved events of logged-in user
 */
router.get("/my", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT s.saved_id, s.event_id, e.title, e.description, e.location,
              e.start_time, e.end_time, c.name AS category
       FROM saved_events s
       JOIN events e ON s.event_id = e.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE s.user_id = ?
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching saved events:", err);
    res.status(500).json({ message: "Error fetching saved events" });
  }
});

/**
 * Save an event
 */
router.post("/save", verifyToken, async (req, res) => {
  try {
    const { event_id } = req.body;
    const userId = req.user.user_id;

    // prevent duplicates
    const [existing] = await db.execute(
      `SELECT * FROM saved_events WHERE user_id = ? AND event_id = ?`,
      [userId, event_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: "Event already saved" });
    }

    await db.execute(
      `INSERT INTO saved_events (user_id, event_id) VALUES (?, ?)`,
      [userId, event_id]
    );

    res.json({ message: "Event saved successfully" });
  } catch (err) {
    console.error("Error saving event:", err);
    res.status(500).json({ message: "Error saving event" });
  }
});

/**
 * Remove a saved event
 */
router.delete("/remove/:event_id", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { event_id } = req.params;

    await db.execute(
      `DELETE FROM saved_events WHERE user_id = ? AND event_id = ?`,
      [userId, event_id]
    );

    res.json({ message: "Event removed from saved" });
  } catch (err) {
    console.error("Error removing saved event:", err);
    res.status(500).json({ message: "Error removing saved event" });
  }
});

export default router;
