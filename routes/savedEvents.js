// routes/savedEvents.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();
const isPostgres = !!process.env.DATABASE_URL;

// Helper function to get location SQL based on database type
const getLocationSQL = () => {
  if (isPostgres) {
    return `COALESCE(
      NULLIF(
        CONCAT_WS(' - ',
          e.locations->0->>'name',
          e.locations->0->>'address'
        ), ''
      ),
      e.locations->0::text,
      NULL
    ) AS location`;
  } else {
    return `COALESCE(
      NULLIF(
        CONCAT_WS(' - ',
          JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].name')),
          JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].address'))
        ), ''
      ),
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0]')), ''),
      NULL
    ) AS location`;
  }
};

/**
 * Get all saved events of logged-in user
 */
router.get("/my", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT s.*, e.* FROM saved_events s
       JOIN events e ON s.event_id = e.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       WHERE s.user_id = ?`,
      [userId]
    );

    const origin = `${req.protocol}://${req.get("host")}`;
    const normalized = (rows || []).map((r) => {
      const raw = r.image || r.image_path || "";
      const webPath = String(raw).replace(/\\\\/g, "/").replace(/\\/g, "/");
      const abs = webPath.startsWith("http") ? webPath : origin + (webPath.startsWith("/") ? webPath : `/${webPath}`);
      return {
        saved_id: r.saved_id,
        event_id: r.event_id,
        title: r.title,
        description: r.description,
        location: r.location || (r.locations ? JSON.stringify(r.locations) : null),
        start_time: r.start_time || r.start || r.starts_at || null,
        end_time: r.end_time || r.end || r.ends_at || null,
        image: webPath ? abs : origin + "/uploads/events/default-event.png",
        category: r.category || r.category_name || 'General',
      };
    });

    // Sort by start_time if available
    normalized.sort((a, b) => {
      const aStart = new Date(a.start_time || 0).getTime();
      const bStart = new Date(b.start_time || 0).getTime();
      return aStart - bStart;
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
