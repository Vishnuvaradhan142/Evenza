// routes/tickets.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Get all **upcoming / active tickets** for the logged-in user
 * (filters out tickets where event is already completed)
 */
router.get("/my-tickets", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id; // from JWT payload

    const [rows] = await db.execute(
      `SELECT t.*, r.*, e.*
       FROM tickets t
       JOIN registrations r ON t.registration_id = r.registration_id
       JOIN events e ON r.event_id = e.event_id
       WHERE r.user_id = ?`,
      [userId]
    );

    // Filter out completed events (do in JS to avoid SQL errors if end_time missing)
    const out = (rows || []).filter((row) => {
      const end = row.end_time || row.ends_at || row.end || row.event_end || null;
      if (!end) return true; // keep if no end information
      const endDate = new Date(end);
      return isNaN(endDate.getTime()) ? true : endDate >= new Date();
    }).map((row) => ({
      ticket_id: row.ticket_id,
      ticket_code: row.ticket_code,
      issue_time: row.issue_time,
      status: row.status,
      registration_id: row.registration_id,
      event_id: row.event_id,
      eventName: row.title || row.eventName || row.name || null,
      start_time: row.start_time || row.start || row.starts_at || null,
      end_time: row.end_time || row.end || row.ends_at || null,
      location: row.location || row.location_name || null,
    }));

    // Sort by start_time asc
    out.sort((a, b) => {
      const aStart = new Date(a.start_time || 0).getTime();
      const bStart = new Date(b.start_time || 0).getTime();
      return aStart - bStart;
    });

    res.json(out);
  } catch (err) {
    console.error("Error fetching tickets:", err);
    res.status(500).json({ message: "Error fetching tickets" });
  }
});

export default router;
