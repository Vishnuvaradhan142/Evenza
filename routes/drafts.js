import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// Multer storage for drafts
const draftsDir = path.join(process.cwd(), "uploads", "drafts");
if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, draftsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });

// Helper to require admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ message: "Admin required" });
  next();
}

/**
 * POST /
 * Create a new draft event (organizer/creator creates draft)
 * Accepts multipart/form-data with optional files under 'files'
 */
router.post("/", verifyToken, upload.array("files", 10), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const {
      title, description, location, start_time, end_time,
      latitude, longitude, category_id
    } = req.body;

    const files = (req.files || []).map(f => path.join("/uploads/drafts", path.basename(f.path)));

    const [result] = await db.execute(
      `INSERT INTO draft_events (title, description, location, start_time, end_time, latitude, longitude, category_id, submitted_by, submitted_at, status, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending', ?)`,
      [title, description, location, start_time || null, end_time || null, latitude || null, longitude || null, category_id || null, userId, JSON.stringify(files)]
    );

    const draftId = result.insertId;
    res.status(201).json({ draftId, message: "Draft created" });
  } catch (err) {
    console.error("Error creating draft:", err.stack || err);
    res.status(500).json({ message: "Error creating draft" });
  }
});

/**
 * GET /
 * List drafts (admin only) - returns pending drafts first
 */
router.get("/", verifyToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT d.*, u.username AS submitted_by_name
       FROM draft_events d
       LEFT JOIN users u ON d.submitted_by = u.user_id
       ORDER BY d.submitted_at DESC`
    );
    // parse attachments
    const parsed = rows.map(r => ({ ...r, attachments: r.attachments ? JSON.parse(r.attachments) : [] }));
    res.json(parsed);
  } catch (err) {
    console.error("Error listing drafts:", err.stack || err);
    res.status(500).json({ message: "Error listing drafts" });
  }
});

/**
 * GET /:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.execute(`SELECT * FROM draft_events WHERE draft_id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const out = { ...rows[0], attachments: rows[0].attachments ? JSON.parse(rows[0].attachments) : [] };
    res.json(out);
  } catch (err) {
    console.error("Error fetching draft:", err.stack || err);
    res.status(500).json({ message: "Error fetching draft" });
  }
});

/**
 * DELETE /:id
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    // allow creator or admin to delete
    const [rows] = await db.execute(`SELECT submitted_by FROM draft_events WHERE draft_id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;
    if (req.user.user_id !== owner && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    // delete attachments files
    const [r2] = await db.execute(`SELECT attachments FROM draft_events WHERE draft_id = ?`, [id]);
    if (r2[0] && r2[0].attachments) {
      const atts = JSON.parse(r2[0].attachments);
      for (const a of atts) {
        const p = path.join(process.cwd(), a.replace(/^\//, ""));
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
      }
    }

    await db.execute(`DELETE FROM draft_events WHERE draft_id = ?`, [id]);
    res.json({ message: "Draft deleted" });
  } catch (err) {
    console.error("Error deleting draft:", err.stack || err);
    res.status(500).json({ message: "Error deleting draft" });
  }
});

/**
 * PUT /:id/approve
 * Approve a draft -> move into events table (admin only)
 */
router.put("/:id/approve", verifyToken, requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = req.params.id;
    const [rows] = await conn.execute(`SELECT * FROM draft_events WHERE draft_id = ? FOR UPDATE`, [id]);
    if (!rows[0]) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: "Draft not found" });
    }
    const d = rows[0];
    // Insert into events
    const [ins] = await conn.execute(
      `INSERT INTO events (title, description, location, start_time, end_time, latitude, longitude, category_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [d.title, d.description, d.location, d.start_time, d.end_time, d.latitude, d.longitude, d.category_id, d.submitted_by]
    );
    const newEventId = ins.insertId;

    // Move attachments from uploads/drafts to uploads/events
    const attachments = d.attachments ? JSON.parse(d.attachments) : [];
    const newPaths = [];
    const eventsDir = path.join(process.cwd(), "uploads", "events");
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
    for (const rel of attachments) {
      const src = path.join(process.cwd(), rel.replace(/^\//, ""));
      const destName = `${Date.now()}-${path.basename(src)}`;
      const dest = path.join(eventsDir, destName);
      try {
        fs.renameSync(src, dest);
        newPaths.push(path.join("/uploads/events", destName));
      } catch (e) { console.warn("move file failed", src, e.message); }
    }

    // Save main image path or attachments to events table if needed (simple example)
    if (newPaths.length > 0) {
      await conn.execute(`UPDATE events SET image_path = ? WHERE event_id = ?`, [newPaths[0], newEventId]);
    }

    // Delete draft row
    await conn.execute(`DELETE FROM draft_events WHERE draft_id = ?`, [id]);

    await conn.commit();
    conn.release();
    res.json({ message: "Draft approved", eventId: newEventId });
  } catch (err) {
    console.error("Error approving draft:", err.stack || err);
    try { await conn.rollback(); } catch (e) {}
    conn.release();
    res.status(500).json({ message: "Error approving draft" });
  }
});

export default router;
