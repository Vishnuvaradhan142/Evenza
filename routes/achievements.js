// routes/achievements.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/achievements/badges
 * - returns all badges
 * - computes user's review_count and participated_event_count
 * - sets unlocked = true/false and awarded_at if already awarded
 * - auto-awards any newly unlocked badges (inserts into user_badges)
 */
router.get("/badges", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    // 1) get counts: reviews and confirmed registrations (participated)
    const [[reviewCountRow]] = await db.query(
      "SELECT COUNT(*) AS review_count FROM ratings_reviews WHERE user_id = ?",
      [userId]
    );
    const reviewCount = Number(reviewCountRow?.review_count || 0);

    const [[eventCountRow]] = await db.query(
      "SELECT COUNT(*) AS event_count FROM registrations r WHERE r.user_id = ? AND LOWER(r.status) IN ('confirmed','confirmed')",
      [userId]
    );
    const eventCount = Number(eventCountRow?.event_count || 0);

    // 2) fetch all badges
    const [badges] = await db.query("SELECT * FROM badges ORDER BY badge_id ASC");

    // 3) fetch user's already awarded badges
    const [awardedRows] = await db.query(
      "SELECT badge_id, awarded_at FROM user_badges WHERE user_id = ?",
      [userId]
    );
    const awardedMap = {};
    for (const a of awardedRows) awardedMap[a.badge_id] = a.awarded_at;

    // 4) build response list and auto-award newly unlocked badges
    const toInsert = [];
    const out = [];

    for (const b of badges) {
      const criteria = b.criteria_type;
      const threshold = Number(b.threshold);
      const unlocked = criteria === "reviews" ? reviewCount >= threshold : eventCount >= threshold;
      const awarded_at = awardedMap[b.badge_id] || null;

      if (unlocked && !awarded_at) {
        // auto-award: queue insert
        toInsert.push([userId, b.badge_id]);
      }

      out.push({
        badge_id: b.badge_id,
        key: b.key,
        title: b.title,
        description: b.description,
        criteria_type: b.criteria_type,
        threshold: b.threshold,
        xp: b.xp,
        unlocked,
        awarded_at: awarded_at ? new Date(awarded_at) : null
      });
    }

    // perform inserts for newly earned badges (if any)
    if (toInsert.length > 0) {
      // Use bulk insert with ignore to handle race conditions (if another process awarded simultaneously)
      const insertQuery = "INSERT IGNORE INTO user_badges (user_id, badge_id) VALUES ?";
      await db.query(insertQuery, [toInsert]);

      // re-fetch awarded times for those inserted to populate response
      const [newAwards] = await db.query(
        "SELECT badge_id, awarded_at FROM user_badges WHERE user_id = ?",
        [userId]
      );
      const newMap = {};
      for (const a of newAwards) newMap[a.badge_id] = a.awarded_at;
      // update out[]
      for (const o of out) {
        if (newMap[o.badge_id]) {
          o.awarded_at = new Date(newMap[o.badge_id]);
        }
      }
    }

    // Lastly, include the computed counts for UI convenience
    res.json({
      reviewCount,
      eventCount,
      badges: out
    });
  } catch (err) {
    console.error("Achievements /badges error:", err);
    res.status(500).json({ error: "Failed to get badges" });
  }
});

/**
 * GET /api/achievements/certificates
 * - returns events user participated in (confirmed) that are completed (end_time <= NOW())
 * - left join user_certificates to indicate if a certificate was already issued
 */
router.get("/certificates", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.query(
      `SELECT e.*, uc.cert_id, uc.issued_at, uc.file_path, r.*
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       LEFT JOIN user_certificates uc ON uc.user_id = r.user_id AND uc.event_id = r.event_id
       WHERE r.user_id = ? AND LOWER(r.status) = 'confirmed'`,
      [userId]
    );

    const now = new Date();
    const filtered = (rows || []).filter((r) => {
      const end = r.end_time || r.ends_at || r.end || null;
      if (!end) return false;
      const endDate = new Date(end);
      return !isNaN(endDate.getTime()) && endDate <= now;
    }).map((r) => ({
      event_id: r.event_id,
      title: r.title,
      location: r.location,
      start_time: r.start_time,
      end_time: r.end_time,
      certificate: r.cert_id ? { cert_id: r.cert_id, issued_at: r.issued_at, file_path: r.file_path } : null
    }));

    // Sort by end_time desc
    filtered.sort((a, b) => {
      const aEnd = new Date(a.end_time || 0).getTime();
      const bEnd = new Date(b.end_time || 0).getTime();
      return bEnd - aEnd;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Achievements /certificates GET error:", err);
    res.status(500).json({ error: "Failed to fetch certificates" });
  }
});

/**
 * POST /api/achievements/certificates/:event_id/issue
 * - issues/creates a certificate record for user+event (if eligible)
 * - returns the created certificate record
 */
router.post("/certificates/:event_id/issue", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const eventId = Number(req.params.event_id);

    // 1) verify user was registered + confirmed for the event and event completed
    const [regRows] = await db.query(
      `SELECT r.*, e.end_time FROM registrations r JOIN events e ON r.event_id = e.event_id
       WHERE r.user_id = ? AND r.event_id = ? AND LOWER(r.status) = 'confirmed' LIMIT 1`,
      [userId, eventId]
    );
    const reg = regRows && regRows[0];
    if (!reg) return res.status(403).json({ error: "Not eligible to receive a certificate for this event" });
    const endTime = reg.end_time || reg.ends_at || reg.end || null;
    if (!endTime || isNaN(new Date(endTime).getTime()) || new Date(endTime) > new Date()) {
      return res.status(403).json({ error: "Not eligible to receive a certificate for this event" });
    }

    // 2) check if certificate already exists
    const [exists] = await db.query(
      "SELECT cert_id, issued_at, file_path FROM user_certificates WHERE user_id = ? AND event_id = ? LIMIT 1",
      [userId, eventId]
    );
    if (exists && exists.length > 0) {
      return res.status(200).json({ message: "Certificate already issued", certificate: exists[0] });
    }

    // 3) insert certificate row (file generation to be handled separately)
    let certId;
    if (process.env.DATABASE_URL) {
      // PostgreSQL - use RETURNING
      const [rows] = await db.query(
        "INSERT INTO user_certificates (user_id, event_id) VALUES (?, ?) RETURNING cert_id",
        [userId, eventId]
      );
      certId = rows && rows[0] ? rows[0].cert_id : undefined;
    } else {
      // MySQL - use insertId
      const [result] = await db.query(
        "INSERT INTO user_certificates (user_id, event_id) VALUES (?, ?)",
        [userId, eventId]
      );
      certId = result.insertId;
    }

    const [[inserted]] = await db.query(
      "SELECT cert_id, user_id, event_id, issued_at, file_path FROM user_certificates WHERE cert_id = ? LIMIT 1",
      [certId]
    );

    res.status(201).json({ message: "Certificate issued", certificate: inserted });
  } catch (err) {
    console.error("Achievements /certificates POST error:", err);
    res.status(500).json({ error: "Failed to issue certificate" });
  }
});

export default router;
