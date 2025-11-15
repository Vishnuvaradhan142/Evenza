// routes/tickets.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Get tickets for a specific event
 * Public endpoint used by the frontend event details modal
 */
router.get("/event/:event_id", async (req, res) => {
  try {
    const { event_id } = req.params;
    const [rows] = await db.execute(
      `SELECT t.* FROM tickets t WHERE t.event_id = ?`,
      [event_id]
    );

    const out = (rows || []).map((r) => ({
      ticket_id: r.ticket_id,
      ticket_type: r.ticket_type || r.type || "General",
      price: r.price ?? r.amount ?? 0,
      description: r.description || r.ticket_description || null,
      quantity_total: r.quantity_total ?? r.total_quantity ?? null,
      quantity_available: r.quantity_available ?? r.available ?? null,
      event_id: r.event_id,
    }));

    res.json(out);
  } catch (err) {
    // If the tickets table/schema doesn't match (e.g. migrated DB without tickets/event_id),
    // don't fail the browse/event flow — return an empty tickets array and warn.
    console.warn("Warning: tickets query failed for event; returning empty list.", err && err.code ? err.code : err);
    // If it's a field/column error, return an empty array so the frontend can continue.
    if (err && (err.code === 'ER_BAD_FIELD_ERROR' || (err.sqlMessage && err.sqlMessage.includes('Unknown column')))) {
      return res.json([]);
    }

    // For other errors, log and return empty list to avoid breaking the UI.
    console.error("Error fetching tickets for event:", err);
    return res.json([]);
  }
});

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
