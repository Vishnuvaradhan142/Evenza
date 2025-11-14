// backend/routes/events.js (reconstructed clean version)
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();
const isPostgres = !!process.env.DATABASE_URL;

// Build DB-specific location extraction.
// Resolve at runtime whether the events table has a JSON `locations` column or a simple `location` column.
let _cachedLocationSQL = null;
async function getLocationSQL() {
  if (_cachedLocationSQL !== null) return _cachedLocationSQL;

  try {
    // Check information_schema for 'locations' column on 'events'
    const [cols] = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'locations'",
      []
    );
    const hasLocations = Array.isArray(cols) && cols.length > 0;

    if (hasLocations) {
      if (isPostgres) {
        _cachedLocationSQL = `COALESCE(NULLIF(CONCAT_WS(' - ', e.locations->0->>'name', e.locations->0->>'address'), ''), e.locations->0::text, NULL) AS location`;
      } else {
        _cachedLocationSQL = `COALESCE(NULLIF(CONCAT_WS(' -', JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].name')), JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0].address'))), ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.locations, '$[0]')), ''), NULL) AS location`;
      }
    } else {
      // Fallback to a simple 'location' column
      _cachedLocationSQL = `COALESCE(NULLIF(e.location, ''), NULL) AS location`;
    }
  } catch (err) {
    console.warn('Could not determine locations column presence, defaulting to e.location:', err && err.message);
    _cachedLocationSQL = `COALESCE(NULLIF(e.location, ''), NULL) AS location`;
  }

  return _cachedLocationSQL;
}

// Small helper to normalize image URLs consistently
function normalizeImagePath(row, origin) {
  const raw = row.image_path ? String(row.image_path) : row.image ? String(row.image) : "";
  const webPath = raw.replace(/\\\\/g, "/").replace(/\\/g, "/");
  let abs = origin + "/uploads/events/default-event.png";
  if (webPath.startsWith("http")) abs = webPath;
  else if (webPath.startsWith("/uploads/")) abs = origin + webPath;
  else if (webPath) abs = origin + "/uploads/events/" + webPath;
  return { image_path: abs, image: abs };
}

// GET /mine - events created by owner
router.get("/mine", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locSql = await getLocationSQL();
    const [rows] = await db.execute(
      `SELECT e.event_id, e.title, e.start_time, e.end_time, ${locSql}, e.image AS image_path
       FROM events e WHERE e.created_by = ? ORDER BY e.start_time DESC`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    const out = (rows || []).map(r => ({
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    }));
    res.json(out);
  } catch (err) {
    console.error("Error fetching owner events:", err.stack || err);
    res.status(500).json({ message: "Error fetching owner events" });
  }
});

// GET /all - all events (no filters), admin/owner views
router.get("/all", async (req, res) => {
  try {
    const locSql = await getLocationSQL();
    const sql = `SELECT e.*, ${locSql} FROM events e ORDER BY e.created_at DESC`;
    const [rows] = await db.execute(sql);
    const origin = `${req.protocol}://${req.get("host")}`;
    const out = (rows || []).map(r => ({
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    }));
    res.json(out);
  } catch (err) {
    console.error("Error fetching all events:", err.stack || err);
    res.status(500).json({ message: "Error fetching all events" });
  }
});

// GET / - public/current events; supports optional q filter (applied in JS to avoid schema diffs)
router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const locSql = await getLocationSQL();
    const [rows] = await db.execute(
      `SELECT e.*, ${locSql} FROM events e WHERE e.end_time >= NOW() ORDER BY e.start_time ASC`
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    let out = (rows || []).map(r => ({
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    }));
    if (q) {
      out = out.filter(ev => (
        (ev.title || ev.name || "").toLowerCase().includes(q) ||
        (ev.description || ev.details || "").toLowerCase().includes(q) ||
        (ev.category || "").toLowerCase().includes(q)
      ));
    }
    res.json(out);
  } catch (err) {
    console.error("Error fetching events:", err.stack || err);
    res.status(500).json({ message: "Error fetching events" });
  }
});

// GET /:id - single event
router.get("/:id", async (req, res) => {
  try {
    const eventId = req.params.id;
    const locSql = await getLocationSQL();
    const [rows] = await db.execute(
      `SELECT e.*, ${locSql} FROM events e WHERE e.event_id = ?`,
      [eventId]
    );
    if (!rows || !rows[0]) return res.status(404).json({ message: "Event not found" });
    const origin = `${req.protocol}://${req.get("host")}`;
    const r = rows[0];
    const norm = {
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    };
    res.json(norm);
  } catch (err) {
    console.error("Error fetching event:", err.stack || err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /user/joined - user's joined events
router.get("/user/joined", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locSql = await getLocationSQL();
    const [rows] = await db.execute(
      `SELECT e.*, ${locSql}, r.registered_at AS registration_date, r.status AS registration_status
       FROM events e JOIN registrations r ON e.event_id = r.event_id
       WHERE r.user_id = ? ORDER BY e.start_time ASC`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    const out = (rows || []).map(r => ({
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    }));
    res.json(out);
  } catch (err) {
    console.error("Error fetching joined events:", err.stack || err);
    res.status(500).json({ message: "Error fetching joined events" });
  }
});

// GET /user/upcoming - user's upcoming events
router.get("/user/upcoming", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const locSql = await getLocationSQL();
    const [rows] = await db.execute(
      `SELECT e.*, ${locSql}, r.registered_at AS registration_date, r.status AS registration_status
       FROM events e JOIN registrations r ON e.event_id = r.event_id
       WHERE r.user_id = ? AND e.start_time >= NOW()
       ORDER BY e.start_time ASC`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    const out = (rows || []).map(r => ({
      ...r,
      ...normalizeImagePath(r, origin),
      category: r.category || r.category_name || "General",
    }));
    res.json(out);
  } catch (err) {
    console.error("Error fetching upcoming events:", err.stack || err);
    res.status(500).json({ message: "Error fetching upcoming events" });
  }
});

// GET /stats/joined - joined count
router.get("/stats/joined", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS joinedCount FROM registrations WHERE user_id = ?`,
      [userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching joined count:", err.stack || err);
    res.status(500).json({ message: "Error fetching joined count" });
  }
});

// GET /stats/upcoming - upcoming count
router.get("/stats/upcoming", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS upcomingCount
       FROM registrations r JOIN events e ON r.event_id = e.event_id
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