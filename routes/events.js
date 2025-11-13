// backend/routes/events.js
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
        CONCAT_WS(' -',
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
 * GET /mine
 * Get events created by the authenticated user (owner)
 */
router.get("/mine", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.execute(
      `SELECT 
         e.event_id,
         e.title,
         e.start_time,
         e.end_time,
         ${getLocationSQL()},
         e.image AS image_path
       FROM events e
       WHERE e.created_by = ?
       ORDER BY e.start_time DESC`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
      const normalized = (rows || []).map(r => {
        const raw = r.image_path ? String(r.image_path) : "";
        const webPath = raw.replace(/\\/g, "/").replace(/\\/g, "/");
        let abs = origin + "/uploads/events/default-event.png";
        if (webPath.startsWith("http")) {
          abs = webPath;
        } else if (webPath.startsWith("/uploads/")) {
          abs = origin + webPath;
        } else if (webPath) {
          abs = origin + "/uploads/events/" + webPath;
        }
        return {
          ...r,
          image_path: webPath ? abs : origin + "/uploads/events/default-event.png",
        };
      });
    res.json(normalized);
  } catch (err) {
    console.error("Error fetching owner events:", err.stack || err);
    res.status(500).json({ message: "Error fetching owner events" });
  }
});

/**
 * GET /all
 * Get ALL events for owner (no filters)
 */
router.get("/all", async (req, res) => {
  try {
    const sql = `
      SELECT
        e.event_id,
        e.title,
        e.description,
        e.capacity,
        ${getLocationSQL()},
        e.start_time,
        e.end_time,
        e.image AS image_path,
        e.created_at,
        e.created_by,
        COALESCE(c.name, 'General') AS category
      FROM events e
      LEFT JOIN categories c ON e.category_id = c.category_id
      ORDER BY e.created_at DESC
    `;

    const [rows] = await db.execute(sql);
    const origin = `${req.protocol}://${req.get("host")}`;
      const normalized = (rows || []).map(r => {
        const raw = r.image_path ? String(r.image_path) : "";
        const webPath = raw.replace(/\\/g, "/").replace(/\\/g, "/");
        let abs = origin + "/uploads/events/default-event.png";
        if (webPath.startsWith("http")) {
          abs = webPath;
        } else if (webPath.startsWith("/uploads/")) {
          abs = origin + webPath;
        } else if (webPath) {
          abs = origin + "/uploads/events/" + webPath;
        }
        return {
          ...r,
          image_path: webPath ? abs : origin + "/uploads/events/default-event.png",
        };
      });
    res.json(normalized);
  } catch (err) {
    console.error("Error fetching all events:", err.stack || err);
    res.status(500).json({ message: "Error fetching all events" });
  }
});

/**
 * GET /
 * Get all not-completed events (end_time >= NOW()).
 * Optional query param: q (search title/description)
 */
router.get("/", async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : null;

    // Build WHERE clause: only not completed events (portable across MySQL/PostgreSQL)
    let sql = `
      SELECT
        e.event_id,
        e.title,
        e.description,
        ${getLocationSQL()},
        e.start_time,
        e.end_time,
        e.image AS image_path,
        COALESCE(e.category, 'General') AS category,
        e.created_by
      FROM events e
      WHERE e.end_time >= NOW()
    `;

    const params = [];
    if (q) {
      // Use LOWER(...) LIKE LOWER(?) for cross-DB case-insensitive search
      sql += ` AND (LOWER(e.title) LIKE LOWER(?) OR LOWER(e.description) LIKE LOWER(?))`;
      params.push(q, q);
    }

    // Order results
    sql += ` ORDER BY e.start_time ASC`;

    const [rows] = await db.execute(sql, params);
    const origin = `${req.protocol}://${req.get("host")}`;
    const normalized = (rows || []).map(r => {
      const raw = r.image_path ? String(r.image_path) : "";
      const webPath = raw.replace(/\\/g, "/").replace(/\\/g, "/");
      let abs = origin + "/uploads/events/default-event.png";
      if (webPath.startsWith("http")) {
        abs = webPath;
      } else if (webPath.startsWith("/uploads/")) {
        abs = origin + webPath;
      } else if (webPath) {
        abs = origin + "/uploads/events/" + webPath;
      }
      return {
        ...r,
        image_path: webPath ? abs : origin + "/uploads/events/default-event.png",
      };
    });
    res.json(normalized);
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
         COALESCE(e.category, 'General') AS category,
         e.image AS image_path,
         ${getLocationSQL()},
         u.username AS creator_name,
         u.email AS creator_email
       FROM events e
       LEFT JOIN users u ON e.created_by = u.user_id
       WHERE e.event_id = ?`,
      [eventId]
    );

    if (!rows[0]) return res.status(404).json({ message: "Event not found" });
    const origin = `${req.protocol}://${req.get("host")}`;
    const row = rows[0];
    const raw = row.image_path ? String(row.image_path) : "";
    const webPath = raw.replace(/\\\\/g, "/").replace(/\\/g, "/");
      if (webPath.startsWith("http")) {
        row.image_path = webPath;
      } else if (webPath.startsWith("/uploads/")) {
        row.image_path = origin + webPath;
      } else if (webPath) {
        row.image_path = origin + "/uploads/events/" + webPath;
      } else {
        row.image_path = origin + "/uploads/events/default-event.png";
      }
    res.json(row);
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
      `SELECT e.event_id, e.title, e.description,
              ${getLocationSQL()},
              e.start_time, e.end_time, 
              e.image AS image_path,
              COALESCE(e.category, 'General') AS category,
              r.registered_at AS registration_date,
              r.status AS registration_status
       FROM events e
       JOIN registrations r ON e.event_id = r.event_id
       WHERE r.user_id = ?
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
      `SELECT e.event_id, e.title, e.description,
              ${getLocationSQL()},
              e.start_time, e.end_time, 
              e.image AS image_path,
              COALESCE(e.category, 'General') AS category,
              r.registered_at AS registration_date,
              r.status AS registration_status
       FROM events e
       JOIN registrations r ON e.event_id = r.event_id
       WHERE r.user_id = ? AND e.start_time >= NOW()
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