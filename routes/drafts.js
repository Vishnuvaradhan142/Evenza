import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// === Multer storage setup for drafts ===
const draftsDir = path.join(process.cwd(), "uploads", "drafts");
if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });

// Separate directory for draft documents (pdf, docx, etc.)
const draftDocsDir = path.join(process.cwd(), "uploads", "draft-documents");
if (!fs.existsSync(draftDocsDir)) fs.mkdirSync(draftDocsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, draftsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });

// Storage for documents
const storageDocs = multer.diskStorage({
  destination: (req, file, cb) => cb(null, draftDocsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});
const uploadDocs = multer({ storage: storageDocs });

// Normalize and parse attachments stored in DB (handle JSON, arrays, plain strings, and Windows paths)
function normalizeWebPath(p) {
  if (!p) return p;
  let s = String(p).replace(/\\\\/g, "/").replace(/\\/g, "/");
  // ensure leading slash for web path
  if (!s.startsWith("/")) s = "/" + s.replace(/^\/+/, "");
  return s;
}

function parseAttachments(val) {
  try {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(normalizeWebPath);
    if (typeof val === "object") return [normalizeWebPath(val.path || String(val))];
    if (typeof val === "string") {
      const s = val.trim();
      // Only try JSON if it looks like JSON (starts with [ or {)
      if (s.startsWith("[") || s.startsWith("{")) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed.map(normalizeWebPath);
          if (parsed) return [normalizeWebPath(String(parsed))];
          return [];
        } catch {
          // Fallback: treat as single path string
          return [normalizeWebPath(val)];
        }
      }
      // Plain string path (Windows or posix)
      return [normalizeWebPath(val)];
    }
    return [];
  } catch {
    return [];
  }
}

// Documents can be stored as array of strings (paths) or array of objects { path, name }
function parseDocuments(val) {
  try {
    if (!val) return [];
    let arr = val;
    if (typeof val === "string") {
      const s = val.trim();
      if (s.startsWith("[") || s.startsWith("{")) {
        try { arr = JSON.parse(s); } catch { arr = [s]; }
      } else arr = [s];
    }
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map((item) => {
      if (item && typeof item === 'object') {
        const p = normalizeWebPath(item.path || "");
        const name = item.name || (p ? path.basename(p) : "");
        return p ? { path: p, name } : null;
      }
      const p = normalizeWebPath(String(item));
      return p ? { path: p, name: path.basename(p) } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// === Helper to ensure only admins can perform certain actions ===
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin")
    return res.status(403).json({ message: "Admin required" });
  next();
}

/**
 * POST /
 * Create a new draft event
 */
router.post("/", verifyToken, upload.array("files", 10), async (req, res) => {
  try {
    const userId = req.user.user_id;
    const {
      title,
      description,
      capacity,
      locations,
      sessions,
      start_time,
      end_time,
      category_id,
      requiresApproval,
    } = req.body;

    const files = (req.files || []).map((f) =>
      path.posix.join("/uploads/drafts", path.basename(f.path))
    );

    // Parse JSON string fields coming from multipart
    let locationsJson = [];
    let sessionsJson = [];
    try {
      if (locations)
        locationsJson =
          typeof locations === "string" ? JSON.parse(locations) : locations;
    } catch {}
    try {
      if (sessions)
        sessionsJson =
          typeof sessions === "string" ? JSON.parse(sessions) : sessions;
    } catch {}

    const cap = Number(capacity ?? 0) || 0;
    const needApproval = String(requiresApproval).toLowerCase() === "true";

    const [insDraftRows] = await db.execute(
      `INSERT INTO draft_events (title, description, capacity, locations, sessions, start_time, end_time, category_id, requires_approval, submitted_by, submitted_at, status, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'draft', ?) RETURNING draft_id`,
      [
        title,
        description,
        cap,
        JSON.stringify(locationsJson),
        JSON.stringify(sessionsJson),
        start_time || null,
        end_time || null,
        category_id || null,
        needApproval ? 1 : 0,
        userId,
        JSON.stringify(files),
      ]
    );

    const draftId = insDraftRows && insDraftRows[0] ? insDraftRows[0].draft_id : undefined;

    // Auto-approve path (no admin approval required)
    if (!needApproval) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
          `SELECT * FROM draft_events WHERE draft_id = ? FOR UPDATE`,
          [draftId]
        );
        if (!rows[0]) {
          await conn.rollback();
          conn.release();
          return res
            .status(404)
            .json({ message: "Draft not found after creation" });
        }
        const d = rows[0];

        // Derive a single location string for events table
        let locationStr = null;
        try {
          const locs = d.locations ? JSON.parse(d.locations) : [];
          if (Array.isArray(locs) && locs.length > 0) {
            const first = locs[0] || {};
            locationStr =
              [first.name, first.address].filter(Boolean).join(" - ") || null;
          }
        } catch {}

        const [ins] = await conn.execute(
          `INSERT INTO events (title, description, location, start_time, end_time, latitude, longitude, category_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING event_id`,
          [
            d.title,
            d.description,
            locationStr,
            d.start_time,
            d.end_time,
            null,
            null,
            d.category_id,
            d.submitted_by,
          ]
        );
        const newEventId = ins && ins[0] ? ins[0].event_id : undefined;

        // Move attachments
  const attachments = parseAttachments(d.attachments);
        const newPaths = [];
        const eventsDir = path.join(process.cwd(), "uploads", "events");
        if (!fs.existsSync(eventsDir))
          fs.mkdirSync(eventsDir, { recursive: true });

        for (const rel of attachments) {
          const src = path.join(process.cwd(), rel.replace(/^\//, ""));
          const destName = `${Date.now()}-${path.basename(src)}`;
          const dest = path.join(eventsDir, destName);
          try {
            fs.renameSync(src, dest);
            // Store web URL path using POSIX separators
            newPaths.push(path.posix.join("/uploads/events", destName));
          } catch (e) {
            console.warn("move file failed", src, e.message);
          }
        }

        if (newPaths.length > 0) {
          await conn.execute(
            `UPDATE events SET image = ? WHERE event_id = ?`,
            [newPaths[0], newEventId]
          );
        }

        await conn.execute(`DELETE FROM draft_events WHERE draft_id = ?`, [
          draftId,
        ]);
        await conn.commit();
        conn.release();
        return res
          .status(201)
          .json({ message: "Event created (auto-approved)", eventId: newEventId });
      } catch (err) {
        console.error("Auto-approve failed:", err.stack || err);
        try {
          await conn.rollback();
        } catch (e) {}
        conn.release();
        return res.status(500).json({ message: "Auto-approve failed" });
      }
    }

  // Default: saved as draft
  res.status(201).json({ draftId, message: "Draft saved" });
  } catch (err) {
    console.error("Error creating draft:", err.stack || err);
    res.status(500).json({ message: "Error creating draft" });
  }
});

/**
 * ✅ FIXED GET /
 * List drafts (owner can see all drafts)
 */
router.get("/", verifyToken, async (req, res) => {
  try {
    let limitVal = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limitVal) || limitVal < 0) limitVal = 0;
    limitVal = Math.min(limitVal, 100);

    const status = req.query.status;
    const params = [];

    let sql = `
      SELECT d.*, u.username AS submitted_by_name
      FROM draft_events d
      LEFT JOIN users u ON d.submitted_by = u.user_id
    `;

    if (status) {
      sql += ` WHERE d.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY d.submitted_at DESC`;

    if (limitVal > 0) {
      sql += ` LIMIT ?`;
      params.push(limitVal);
    }

    // ✅ FIX: Use db.query(sql, params) directly (no mysql.format)
    const [rows] = await db.query(sql, params);

    const parsed = rows.map((r) => ({
      ...r,
      attachments: parseAttachments(r.attachments),
      documents: parseDocuments(r.documents),
    }));

    res.json(parsed);
  } catch (err) {
    console.error("Error listing drafts:", err.stack || err);
    res.status(500).json({ message: "Error listing drafts" });
  }
});

/**
 * GET /mine - list drafts by logged-in user
 */
router.get("/mine", verifyToken, async (req, res) => {
  try {
    const uid = req.user.user_id;
    let limitVal = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limitVal)) limitVal = 10;
    limitVal = Math.min(Math.max(limitVal, 1), 50);
    const status = req.query.status;

    let sql = `SELECT * FROM draft_events WHERE submitted_by = ?`;
    const params = [uid];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY submitted_at DESC LIMIT ?`;
    params.push(limitVal);

    const [rows] = await db.query(sql, params);
    const parsed = rows.map((r) => ({
      ...r,
      attachments: parseAttachments(r.attachments),
      documents: parseDocuments(r.documents),
    }));
    res.json(parsed);
  } catch (err) {
    console.error("Error listing user's drafts:", err.stack || err);
    res.status(500).json({ message: "Error listing drafts" });
  }
});

/**
 * GET /:id - fetch one draft
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.execute(
      `SELECT * FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const out = {
      ...rows[0],
      attachments: parseAttachments(rows[0].attachments),
      documents: parseDocuments(rows[0].documents),
    };
    res.json(out);
  } catch (err) {
    console.error("Error fetching draft:", err.stack || err);
    res.status(500).json({ message: "Error fetching draft" });
  }
});

/**
 * DELETE /:id - delete draft
 */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.execute(
      `SELECT submitted_by FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;

    if (req.user.user_id !== owner && req.user.role !== "admin")
      return res.status(403).json({ message: "Forbidden" });

    const [r2] = await db.execute(
      `SELECT attachments, documents FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    if (r2[0] && r2[0].attachments) {
      const atts = parseAttachments(r2[0].attachments);
      for (const a of atts) {
        const p = path.join(process.cwd(), a.replace(/^\//, ""));
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {}
      }
    }
    if (r2[0] && r2[0].documents) {
      const docs = parseAttachments(r2[0].documents);
      for (const d of docs) {
        const p = path.join(process.cwd(), d.replace(/^\//, ""));
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (e) {}
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
 * PUT /:id
 * Update a draft (owner or admin). Accepts JSON body.
 */
// Accept JSON or multipart (optional files) for updates
router.put("/:id", verifyToken, upload.array("files", 10), async (req, res) => {
  try {
    const id = req.params.id;
    // Check ownership
    const [rows] = await db.execute(
      `SELECT submitted_by, attachments FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;
    if (req.user.user_id !== owner && req.user.role !== "admin")
      return res.status(403).json({ message: "Forbidden" });

    const {
      title,
      description,
      capacity,
      locations,
      sessions,
      start_time,
      end_time,
      category_id,
      requiresApproval,
    } = req.body || {};
    const removeBanner = (req.body && (req.body.removeBanner ?? req.body.remove_banner)) || false;

    const updates = [];
    const params = [];

    if (typeof title === "string") { updates.push("title = ?"); params.push(title); }
    if (typeof description === "string") { updates.push("description = ?"); params.push(description); }
    if (capacity !== undefined) { updates.push("capacity = ?"); params.push(Number(capacity) || 0); }
    if (locations !== undefined) {
      let locVal = locations;
      if (typeof locations !== "string") locVal = JSON.stringify(locations || []);
      updates.push("locations = ?"); params.push(locVal);
    }
    if (sessions !== undefined) {
      let sesVal = sessions;
      if (typeof sessions !== "string") sesVal = JSON.stringify(sessions || []);
      updates.push("sessions = ?"); params.push(sesVal);
    }
    if (start_time !== undefined) { updates.push("start_time = ?"); params.push(start_time || null); }
    if (end_time !== undefined) { updates.push("end_time = ?"); params.push(end_time || null); }
    if (category_id !== undefined) { updates.push("category_id = ?"); params.push(category_id || null); }
    if (requiresApproval !== undefined) {
      const needApproval = String(requiresApproval).toLowerCase() === "true";
      updates.push("requires_approval = ?"); params.push(needApproval ? 1 : 0);
    }

    // If flagged to remove banner, delete all attachments and clear field
    const removeBannerFlag = String(removeBanner).toLowerCase() === "true" || String(removeBanner) === "1";
    if (removeBannerFlag) {
      const current = parseAttachments(rows[0].attachments);
      for (const pth of current) {
        try {
          const oldAbs = path.join(process.cwd(), pth.replace(/^\//, ""));
          if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
        } catch (e) {}
      }
      updates.push("attachments = ?");
      params.push(JSON.stringify([]));
    }

    // If new files uploaded, replace attachments with the new banner only
    const uploadedFiles = (req.files || []).map((f) =>
      path.posix.join("/uploads/drafts", path.basename(f.path))
    );
    if (!removeBannerFlag && uploadedFiles.length > 0) {
      const current = parseAttachments(rows[0].attachments);
      const newBanner = uploadedFiles[0];
      // Delete ALL old attachments from disk
      for (const pth of current) {
        try {
          const oldAbs = path.join(process.cwd(), pth.replace(/^\//, ""));
          if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
        } catch (e) {}
      }
      const next = [newBanner];
      updates.push("attachments = ?");
      params.push(JSON.stringify(next));
    }

    if (updates.length === 0) return res.status(400).json({ message: "No updatable fields provided" });

    const sql = `UPDATE draft_events SET ${updates.join(", ")} WHERE draft_id = ?`;
    params.push(id);
    await db.execute(sql, params);
    // Return the updated draft row
    const [after] = await db.execute(
      `SELECT * FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    const updated = after && after[0] ? { ...after[0], attachments: parseAttachments(after[0].attachments), documents: parseAttachments(after[0].documents) } : null;
    res.json({ message: "Draft updated", draft: updated });
  } catch (err) {
    console.error("Error updating draft:", err.stack || err);
    res.status(500).json({ message: "Error updating draft" });
  }
});

/**
 * PUT /:id/approve - approve draft (owner/admin)
 */
router.put("/:id/approve", verifyToken, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = req.params.id;
    const [rows] = await conn.execute(
      `SELECT * FROM draft_events WHERE draft_id = ? FOR UPDATE`,
      [id]
    );
    if (!rows[0]) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: "Draft not found" });
    }

    const d = rows[0];
    
    // Update draft status to approved
    await conn.execute(
      `UPDATE draft_events SET status = 'approved' WHERE draft_id = ?`,
      [id]
    );

    // Insert into events table with all required fields
    const [ins] = await conn.execute(
      `INSERT INTO events (title, description, capacity, locations, sessions, documents, category_id, start_time, end_time, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()) RETURNING event_id`,
      [
        d.title,
        d.description,
        d.capacity,
        d.locations,  // JSON field
        d.sessions,   // JSON field
        d.documents,  // JSON field
        d.category_id,
        d.start_time,
        d.end_time,
        d.submitted_by,
      ]
    );
    const newEventId = ins && ins[0] ? ins[0].event_id : undefined;

    // Handle image from attachments
    const attachments = parseAttachments(d.attachments);
    const newPaths = [];
    const eventsDir = path.join(process.cwd(), "uploads", "events");
    if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });

    for (const rel of attachments) {
      const src = path.join(process.cwd(), rel.replace(/^\//, ""));
      const destName = `${Date.now()}-${path.basename(src)}`;
      const dest = path.join(eventsDir, destName);
      try {
        fs.renameSync(src, dest);
        // Store web URL path using POSIX separators
        newPaths.push(path.posix.join("/uploads/events", destName));
      } catch (e) {
        console.warn("move file failed", src, e.message);
      }
    }

    if (newPaths.length > 0) {
      await conn.execute(`UPDATE events SET image = ? WHERE event_id = ?`, [
        newPaths[0],
        newEventId,
      ]);
    }

    await conn.commit();
    conn.release();
    res.json({ message: "Draft approved", eventId: newEventId });
  } catch (err) {
    console.error("Error approving draft:", err.stack || err);
    try {
      await conn.rollback();
    } catch (e) {}
    conn.release();
    res.status(500).json({ message: "Error approving draft" });
  }
});

/**
 * PUT /:id/reject - reject draft (owner/admin)
 */
router.put("/:id/reject", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { review_notes } = req.body;
    
    if (!review_notes || !review_notes.trim()) {
      return res.status(400).json({ message: "Review notes are required for rejection" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM draft_events WHERE draft_id = ?`,
      [id]
    );
    
    if (!rows[0]) {
      return res.status(404).json({ message: "Draft not found" });
    }

    await db.execute(
      `UPDATE draft_events SET status = 'rejected', review_notes = ? WHERE draft_id = ?`,
      [review_notes.trim(), id]
    );

    res.json({ message: "Draft rejected" });
  } catch (err) {
    console.error("Error rejecting draft:", err.stack || err);
    res.status(500).json({ message: "Error rejecting draft" });
  }
});

/**
 * POST /:id/documents - upload one or more documents to a draft (owner or admin)
 */
router.post("/:id/documents", verifyToken, uploadDocs.array("files", 20), async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await db.execute(`SELECT submitted_by, documents FROM draft_events WHERE draft_id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;
    if (req.user.user_id !== owner && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    // Optional names provided alongside files
    // names can be a string or array aligned to files; fallback: originalname
    let names = req.body?.names;
    if (names && !Array.isArray(names)) names = [names];

    const uploaded = (req.files || []).map((f, idx) => {
      const p = path.posix.join("/uploads/draft-documents", path.basename(f.path));
      const nm = (Array.isArray(names) && names[idx]) ? String(names[idx]) : (f.originalname || path.basename(p));
      return { path: p, name: nm };
    });
    const current = parseDocuments(rows[0].documents);
    const next = [...current, ...uploaded];
    await db.execute(`UPDATE draft_events SET documents = ? WHERE draft_id = ?`, [JSON.stringify(next), id]);
    res.status(201).json({ message: "Documents uploaded", documents: next });
  } catch (err) {
    console.error("Error uploading documents:", err.stack || err);
    res.status(500).json({ message: "Error uploading documents" });
  }
});

/**
 * DELETE /:id/documents - remove a document by path (owner or admin)
 * Body: { path: "/uploads/draft-documents/filename.ext" }
 */
router.delete("/:id/documents", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const docPath = req.body?.path || req.query?.path;
    if (!docPath) return res.status(400).json({ message: "Document path is required" });

    const [rows] = await db.execute(`SELECT submitted_by, documents FROM draft_events WHERE draft_id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;
    if (req.user.user_id !== owner && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    const current = parseDocuments(rows[0].documents);
    const next = current.filter((obj) => String(obj.path) !== String(docPath));
    if (next.length === current.length) return res.status(404).json({ message: "Document not found on draft" });

    // Delete file from disk
    try {
      const abs = path.join(process.cwd(), String(docPath).replace(/^\//, ""));
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e) {}

    await db.execute(`UPDATE draft_events SET documents = ? WHERE draft_id = ?`, [JSON.stringify(next), id]);
    res.json({ message: "Document removed", documents: next });
  } catch (err) {
    console.error("Error deleting document:", err.stack || err);
    res.status(500).json({ message: "Error deleting document" });
  }
});

/**
 * PUT /:id/documents - rename a document
 * Body: { path: "/uploads/draft-documents/xyz", name: "New name" }
 */
router.put("/:id/documents", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { path: docPath, name } = req.body || {};
    if (!docPath || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: "path and name are required" });
    }
    const [rows] = await db.execute(`SELECT submitted_by, documents FROM draft_events WHERE draft_id = ?`, [id]);
    if (!rows[0]) return res.status(404).json({ message: "Draft not found" });
    const owner = rows[0].submitted_by;
    if (req.user.user_id !== owner && req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    const current = parseDocuments(rows[0].documents);
    let found = false;
    const next = current.map((obj) => {
      if (String(obj.path) === String(docPath)) { found = true; return { ...obj, name }; }
      return obj;
    });
    if (!found) return res.status(404).json({ message: "Document not found on draft" });
    await db.execute(`UPDATE draft_events SET documents = ? WHERE draft_id = ?`, [JSON.stringify(next), id]);
    res.json({ message: "Document renamed", documents: next });
  } catch (err) {
    console.error("Error renaming document:", err.stack || err);
    res.status(500).json({ message: "Error renaming document" });
  }
});

export default router;
