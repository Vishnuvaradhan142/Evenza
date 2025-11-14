import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Simple image normalization helper
function normalizeImage(row, origin) {
  const raw = row.image_path ? String(row.image_path) : row.image ? String(row.image) : "";
  const webPath = raw.replace(/\\\\/g, "/").replace(/\\/g, "/");
  let abs = origin + "/uploads/events/default-event.jpg";
  if (webPath.startsWith("http")) abs = webPath;
  else if (webPath.startsWith("/uploads/")) abs = origin + webPath;
  else if (webPath) abs = origin + "/uploads/events/" + webPath;
  return { image_path: abs, image: abs };
}

// GET /joined -> compatible with older frontend expecting /api/user/joined
router.get("/joined", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.execute(
      `SELECT e.*, r.* FROM events e JOIN registrations r ON e.event_id = r.event_id WHERE r.user_id = ?`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    const out = (rows || []).map((row) => ({
      ...row,
      ...normalizeImage(row, origin),
      registration_date: row.registered_at || row.registration_time || row.created_at || null,
      registration_status: row.status || row.registration_status || null,
    }));
    res.json(out);
  } catch (err) {
    console.error("userCompat: error fetching joined:", err.stack || err);
    res.status(500).json({ message: "Error fetching joined events" });
  }
});

// GET /upcoming -> compatible with older frontend expecting /api/user/upcoming
router.get("/upcoming", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [rows] = await db.execute(
      `SELECT e.*, r.* FROM registrations r JOIN events e ON r.event_id = e.event_id WHERE r.user_id = ?`,
      [userId]
    );
    const origin = `${req.protocol}://${req.get("host")}`;
    let out = (rows || []).map((row) => ({
      ...row,
      ...normalizeImage(row, origin),
      registration_date: row.registered_at || row.registration_time || row.created_at || null,
      registration_status: row.status || row.registration_status || null,
    }));

    const now = new Date();
    out = out.filter((ev) => {
      const start = ev.start_time || ev.start || ev.event_date || ev.eventDate || ev.date || ev.startDate;
      if (!start) return false;
      const s = new Date(start);
      return !isNaN(s.getTime()) && s >= now;
    });

    // sort by start
    out.sort((a, b) => {
      const aStart = new Date(a.start_time || a.start || a.event_date || a.eventDate || a.startDate || 0).getTime();
      const bStart = new Date(b.start_time || b.start || b.event_date || b.eventDate || b.startDate || 0).getTime();
      return aStart - bStart;
    });

    res.json(out);
  } catch (err) {
    console.error("userCompat: error fetching upcoming:", err.stack || err);
    res.status(500).json({ message: "Error fetching upcoming events" });
  }
});

export default router;
