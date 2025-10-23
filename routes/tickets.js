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
      `SELECT 
          t.ticket_id,
          t.ticket_code,
          t.issue_time,
          t.status,
          r.registration_id,
          e.event_id,
          e.title AS eventName,
          e.start_time,
          e.end_time,
          e.location
       FROM tickets t
       JOIN registrations r ON t.registration_id = r.registration_id
       JOIN events e ON r.event_id = e.event_id
       WHERE r.user_id = ?
         AND e.end_time >= NOW()   -- only show tickets for ongoing/upcoming events
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching tickets:", err);
    res.status(500).json({ message: "Error fetching tickets" });
  }
});

export default router;
