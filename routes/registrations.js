import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Get waitlisted (pending) events for the logged-in user
 * Also returns if notification is already sent for each event
 */
router.get("/my-waitlist", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [rows] = await db.execute(
      `SELECT 
          r.registration_id,
          TRIM(LOWER(r.status)) AS status,
          e.event_id,
          e.title AS eventName,
          e.start_time,
          e.end_time,
          e.location,
          e.description,
          COALESCE(c.name, 'General') AS category,
          CASE 
            WHEN n.notification_id IS NOT NULL THEN 1 
            ELSE 0 
          END AS already_notified
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       LEFT JOIN categories c ON e.category_id = c.category_id
       LEFT JOIN notifications n ON n.user_id = r.user_id 
         AND n.event_id = e.event_id 
         AND n.type = 'in-app'
       WHERE r.user_id = ? 
         AND TRIM(LOWER(r.status)) = 'pending'
       ORDER BY e.start_time ASC`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching waitlisted events:", err);
    res.status(500).json({ message: "Error fetching waitlisted events" });
  }
});

/**
 * Remove (cancel) waitlist entry
 */
router.delete("/cancel/:registrationId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { registrationId } = req.params;

    const [result] = await db.execute(
      `DELETE FROM registrations 
       WHERE registration_id = ? AND user_id = ? AND TRIM(LOWER(status)) = 'pending'`,
      [registrationId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Waitlist entry not found or cannot be removed" });
    }

    res.json({ message: "Successfully removed from waitlist" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Notify Me
 * Prevents duplicate notifications
 */
router.post("/notify/:registrationId", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { registrationId } = req.params;

    // Get event_id from registration
    const [registrations] = await db.execute(
      `SELECT event_id FROM registrations WHERE registration_id = ? AND user_id = ?`,
      [registrationId, userId]
    );

    if (!registrations[0]) {
      return res.status(404).json({ message: "Registration not found" });
    }

    const eventId = registrations[0].event_id;

    // Check if notification already exists
    const [existing] = await db.execute(
      `SELECT notification_id FROM notifications WHERE user_id = ? AND event_id = ? AND type = 'in-app'`,
      [userId, eventId]
    );

    if (existing.length > 0) {
      return res.status(200).json({ message: "Already notified", already_notified: true });
    }

    // Get event title
    const [events] = await db.execute(
      `SELECT title FROM events WHERE event_id = ?`,
      [eventId]
    );

    const eventTitle = events[0].title;

    // Insert notification
    await db.execute(
      `INSERT INTO notifications (user_id, event_id, type, title, message, status, is_read)
       VALUES (?, ?, 'in-app', ?, ?, 'pending', 0)`,
      [userId, eventId, `Waitlist Notification: ${eventTitle}`, `You will be notified when a spot opens for "${eventTitle}".`]
    );

    res.json({ message: "Notification created", already_notified: true });
  } catch (err) {
    console.error("Error creating notification:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Check if user is already registered for an event
router.get("/check/:eventId", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.user_id;

    const [registrations] = await db.query(
      "SELECT * FROM registrations WHERE user_id = ? AND event_id = ?",
      [userId, eventId]
    );

    res.json({
      success: true,
      registered: registrations.length > 0,
      registration: registrations[0] || null,
    });
  } catch (error) {
    console.error("Error checking registration:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check registration status",
    });
  }
});

// Register for an event
router.post("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { event_id, ticket_type, amount, status } = req.body;

    // Check if already registered
    const [existing] = await db.query(
      "SELECT * FROM registrations WHERE user_id = ? AND event_id = ?",
      [userId, event_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "You are already registered for this event",
      });
    }

    // Check event exists
    const [events] = await db.query(
      "SELECT * FROM events WHERE event_id = ?",
      [event_id]
    );

    if (events.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    // Insert registration
    const [result] = await db.query(
      `INSERT INTO registrations 
       (user_id, event_id, ticket_type, amount, status, registered_at, registration_time) 
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [userId, event_id, ticket_type || "Free", amount || 0, status || "confirmed"]
    );

    res.json({
      success: true,
      message: "Successfully registered for the event",
      registration_id: result.insertId,
    });
  } catch (error) {
    console.error("Error creating registration:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register for event",
    });
  }
});

// --- Additional route: registrations for a specific event (only owner can view) ---
// GET /api/registrations/by-event/:eventId
// Returns registrations joined with user info for the given event if the requester is the event owner
router.get('/by-event/:eventId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { eventId } = req.params;

    // Verify that the event belongs to the requesting user
    const [events] = await db.execute(
      `SELECT event_id, title, created_by FROM events WHERE event_id = ?`,
      [eventId]
    );
    if (!events || events.length === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    const ev = events[0];
    if (String(ev.created_by) !== String(userId)) {
      return res.status(403).json({ message: 'Forbidden: not the event owner' });
    }

    // Fetch registrations for the event with user info
    // Select registration row and any linked user row. Include r.* so we can cope with different schemas.
    const [rows] = await db.execute(
      `SELECT r.*, u.*
       FROM registrations r
       LEFT JOIN users u ON r.user_id = u.user_id
       WHERE r.event_id = ?
       ORDER BY r.registered_at ASC`,
      [eventId]
    );

    // Normalize and compute a display name using multiple fallbacks
    const normalized = (rows || []).map((r) => {
      const registrantId = r.user_id ?? r.registrant_id ?? null;
      const username = r.username ?? r.registrant_username ?? null;
      const email = r.email ?? r.registrant_email ?? null;
      // Some systems store name directly on the registration row (guest flow)
      const possibleNameFields = [
        username,
        r.name,
        r.full_name,
        r.registrant_name,
        r.display_name,
        email,
      ];
      const registrant_display_name = possibleNameFields.find((x) => x && String(x).trim()) || (registrantId ? `User ${registrantId}` : null);

      return {
        registration_id: r.registration_id,
        registrant_id: registrantId,
        registrant_username: username,
        registrant_email: email,
        registrant_display_name,
        ticket_type: r.ticket_type ?? 'General',
        amount: r.amount != null ? Number(r.amount) : 0.0,
        status: r.status,
        registered_at: r.registered_at,
        // include raw registration row for debugging in client if needed
        raw: r,
      };
    });

    res.json({ event: { event_id: ev.event_id, title: ev.title }, registrations: normalized });
  } catch (err) {
    console.error('Error fetching registrations by event:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * GET /api/registrations/mine
 * Returns registrations for all events owned by the authenticated user.
 * Response shape: { events: [ { event: {event_id, title}, registrations: [ ... ] } ] }
 */
router.get('/mine', verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    console.log(`registrations: GET /mine called by user ${userId}`);

    // Fetch all registrations for events created by this user
    const [rows] = await db.execute(
      `SELECT r.*, e.event_id AS event_id, e.title AS event_title, u.user_id AS registrant_user_id, u.username, u.email
       FROM registrations r
       JOIN events e ON r.event_id = e.event_id
       LEFT JOIN users u ON r.user_id = u.user_id
       WHERE e.created_by = ?
       ORDER BY e.event_id ASC, r.registered_at ASC`,
      [userId]
    );

    // Group by event
    const eventsMap = new Map();
    for (const r of rows) {
      const evtId = r.event_id;
      if (!eventsMap.has(evtId)) {
        eventsMap.set(evtId, {
          event: { event_id: evtId, title: r.event_title },
          registrations: [],
        });
      }

      const registrant_display_name = r.username || r.name || r.full_name || r.registrant_name || `User ${r.user_id}`;

      eventsMap.get(evtId).registrations.push({
        registration_id: r.registration_id,
        registrant_id: r.user_id,
        registrant_username: r.username,
        registrant_email: r.email,
        registrant_display_name,
        ticket_type: r.ticket_type ?? 'General',
        amount: r.amount != null ? Number(r.amount) : 0.0,
        status: r.status,
        registered_at: r.registered_at,
        raw: r,
      });
    }

    const events = Array.from(eventsMap.values());
    res.json({ events });
  } catch (err) {
    console.error('Error fetching registrations for owner:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Temporary debug endpoints (safe, no auth) to verify route mount and server health
router.get('/_debug/ping', (req, res) => {
  res.json({ ok: true, route: '/api/registrations/_debug/ping' });
});

// ----------------- Update registration status (single) -----------------
// PATCH /api/registrations/status/:registrationId  { status }
router.patch('/status/:registrationId', verifyToken, async (req, res) => {
  try {
    const ownerId = req.user.user_id;
    const role = (req.user.role || '').toString().toLowerCase();
    const isAdmin = role === 'admin';
    const { registrationId } = req.params;
    let { status } = req.body || {};
    console.log(`[registrations] PATCH /status/${registrationId} by owner ${ownerId} body:`, req.body);
    if (!status) return res.status(400).json({ message: 'status is required' });
    status = String(status).trim().toLowerCase();
    const allowed = new Set(['confirmed', 'pending', 'cancelled', 'waitlisted']);
    if (!allowed.has(status)) {
      return res.status(400).json({ message: 'Invalid status', allowed: Array.from(allowed) });
    }

    let result;
    if (isAdmin) {
      [result] = await db.execute(
        `UPDATE registrations SET status = ? WHERE registration_id = ?`,
        [status, registrationId]
      );
    } else {
      [result] = await db.execute(
        `UPDATE registrations r
         JOIN events e ON r.event_id = e.event_id
         SET r.status = ?
         WHERE r.registration_id = ? AND e.created_by = ?`,
        [status, registrationId, ownerId]
      );
    }

    if (result.affectedRows === 0) {
      console.warn(`[registrations] No rows updated for registration ${registrationId}; possibly not owned by ${ownerId}`);
      return res.status(404).json({ message: 'Registration not found or not owned by you' });
    }

    const [rows] = await db.execute(
      `SELECT r.registration_id, r.status FROM registrations r WHERE r.registration_id = ?`,
      [registrationId]
    );
    res.json({ ok: true, updated: rows[0] });
  } catch (err) {
    console.error('Error updating registration status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ----------------- Update registration status (bulk) -----------------
// PATCH /api/registrations/status/bulk  { ids: number[], status: string }
router.patch('/status/bulk', verifyToken, async (req, res) => {
  try {
    const ownerId = req.user.user_id;
    const role = (req.user.role || '').toString().toLowerCase();
    const isAdmin = role === 'admin';
    let { ids, status } = req.body || {};
    console.log(`[registrations] PATCH /status/bulk by owner ${ownerId} body:`, req.body);
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' });
    }
    status = String(status || '').trim().toLowerCase();
    const allowed = new Set(['confirmed', 'pending', 'cancelled', 'waitlisted']);
    if (!allowed.has(status)) {
      return res.status(400).json({ message: 'Invalid status', allowed: Array.from(allowed) });
    }

    // Ensure ids are numeric
    ids = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return res.status(400).json({ message: 'ids must be numbers' });

    let result;
    if (isAdmin) {
      [result] = await db.query(
        `UPDATE registrations SET status = ? WHERE registration_id IN (?)`,
        [status, ids]
      );
    } else {
      [result] = await db.query(
        `UPDATE registrations r
         JOIN events e ON r.event_id = e.event_id
         SET r.status = ?
         WHERE r.registration_id IN (?) AND e.created_by = ?`,
        [status, ids, ownerId]
      );
    }

    // Return which IDs were requested and how many updated
    res.json({ ok: true, requested: ids, affectedRows: result.affectedRows, status });
  } catch (err) {
    console.error('Error bulk-updating registration status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


export default router;
