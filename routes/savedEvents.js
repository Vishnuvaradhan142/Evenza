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
      `SELECT s.saved_id, s.event_id, e.title, e.description,
              COALESCE(
                NULLIF(
                  CONCAT_WS(' - ',
                    JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].name')),
                    JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].address'))
                  ), ''
                ),
                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0]')), ''),
                NULL
              ) AS location,
              e.start_time, e.end_time, 
              e.image AS image_path,
              COALESCE(c.name, 'General') AS category
       FROM saved_events s
       JOIN events e ON s.event_id = e.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE s.user_id = ?
       ORDER BY e.start_time ASC`,
      [userId]
    );

    const origin = `${req.protocol}://${req.get("host")}`;
    const normalized = (rows || []).map(r => {
      const raw = r.image_path ? String(r.image_path) : "";
      const webPath = raw.replace(/\\\\/g, "/").replace(/\\/g, "/");
      const abs = webPath.startsWith("http") ? webPath : origin + (webPath.startsWith("/") ? webPath : `/${webPath}`);
      return {
        ...r,
        image: webPath ? abs : origin + "/uploads/events/default-event.png",
      };
    });

    res.json(normalized);
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
