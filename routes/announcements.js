// routes/announcements.js
import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Utility: check if a column exists on a table (cached after first call)
const schemaCache = {
	tables: new Map(),
	columns: new Map(),
};

async function tableExists(table) {
	const key = `t:${table}`;
	if (schemaCache.tables.has(key)) return schemaCache.tables.get(key);
	try {
		const [rows] = await db.query(
			"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
			[process.env.DB_NAME, table]
		);
		const exists = Array.isArray(rows) && rows.length > 0;
		schemaCache.tables.set(key, exists);
		return exists;
	} catch (e) {
		return false;
	}
}

async function columnExists(table, column) {
	const key = `c:${table}.${column}`;
	if (schemaCache.columns.has(key)) return schemaCache.columns.get(key);
	try {
		const [rows] = await db.query(
			"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
			[process.env.DB_NAME, table, column]
		);
		const exists = Array.isArray(rows) && rows.length > 0;
		schemaCache.columns.set(key, exists);
		return exists;
	} catch (e) {
		return false;
	}
}

function toClientStatus(status) {
	const s = String(status || "").toLowerCase();
	if (s === "scheduled") return "Scheduled";
	if (s === "sent") return "Sent";
	if (s === "draft") return "Draft";
	if (s === "pending") return "Draft"; // notifications.status uses 'pending'
	return "Draft";
}

function toDbStatus(status) {
	const s = String(status || "").toLowerCase();
	if (["draft", "pending"].includes(s)) return "draft"; // store draft in announcements, pending in notifications handled separately
	if (s === "scheduled") return "scheduled";
	if (s === "sent") return "sent";
	return "draft";
}

// GET /api/announcements
// Returns list of announcements suitable for admin UI
// Public read: allow loading announcements without requiring auth
router.get("/", async (req, res) => {
	try {
		// Derive announcements from notifications table (source of truth)
		// Only include in-app notifications with non-null title/message
		const [rows] = await db.query(
			`SELECT 
				 MIN(notification_id) AS announcement_id,
				 event_id,
				 title,
				 message,
				 MAX(CASE WHEN status = 'sent' THEN 2 WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS status_rank,
				 MIN(created_at) AS created_at,
				 MAX(scheduled_at) AS scheduled_at,
				 MAX(sent_at) AS sent_at
			 FROM notifications
			 WHERE type = 'in-app' AND title IS NOT NULL AND message IS NOT NULL
			 GROUP BY event_id, title, message
			 ORDER BY created_at DESC`
		);
		const announcements = (rows || []).map((r) => ({
			announcement_id: r.announcement_id,
			event_id: r.event_id,
			title: r.title,
			message: r.message,
			status: r.status_rank >= 2 ? "Sent" : r.status_rank === 1 ? "Scheduled" : "Draft",
			scheduled_at: r.scheduled_at,
			created_at: r.created_at,
			sent_at: r.sent_at,
		}));
		return res.json({ announcements });
	} catch (err) {
		console.error("[announcements] GET / error:", err);
		res.status(500).json({ message: "Failed to fetch announcements" });
	}
});

// Helper: insert notifications for recipients
async function insertNotifications({ recipients, event_id = null, title, message, status = "pending", scheduled_at = null, creatorUserId }) {
	if (!Array.isArray(recipients) || recipients.length === 0) {
		return { inserted: 0, requested: 0 };
	}

	const hasCreatedBy = await columnExists("notifications", "created_by");
	const now = new Date();
	const normStatus = String(status).toLowerCase();
	const sentAt = normStatus === "sent" ? now : null;

	// Build columns and value tuples based on schema
	const cols = [
		"user_id",
		"event_id",
		...(hasCreatedBy ? ["created_by"] : []),
		"type",
		"title",
		"message",
		"status",
		"is_read",
		"scheduled_at",
		"scheduled_by",
		"attempts",
		"error_message",
		"created_at",
		"sent_at",
	];

	const values = recipients.map((uid) => {
		const row = [
			uid,
			event_id,
			...(hasCreatedBy ? [creatorUserId] : []),
			"in-app",
			title,
			message,
			normStatus === "draft" ? "pending" : normStatus, // notifications uses 'pending' instead of draft
			0,
			scheduled_at ? new Date(scheduled_at) : null,
			creatorUserId,
			0,
			null,
			now,
			sentAt,
		];
		return row;
	});

	const placeholders = values.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
	const flat = values.flat();

	const sql = `INSERT INTO notifications (${cols.join(", ")}) VALUES ${placeholders}`;
	const [result] = await db.query(sql, flat);
	return { inserted: result.affectedRows || 0, requested: recipients.length };
}

// Helper: resolve event id from body (supports event_id or event_title or numeric string)
async function resolveEventId({ event_id, event_title }) {
	if (event_id != null && String(event_id).trim() !== "") {
		const n = Number(event_id);
		if (Number.isFinite(n)) return n;
	}
	if (event_title != null && String(event_title).trim() !== "") {
		const s = String(event_title).trim();
		const maybeNum = Number(s);
		if (Number.isFinite(maybeNum)) return maybeNum;
		const [rows] = await db.query("SELECT event_id FROM events WHERE title = ? LIMIT 1", [s]);
		if (rows && rows[0]) return rows[0].event_id;
	}
	return null;
}

// Helper: get recipients for an event (by registrations)
async function getRecipientsForEvent(eventId) {
	if (!eventId) return [];
	const [rows] = await db.query(
		`SELECT DISTINCT user_id FROM registrations WHERE event_id = ?`,
		[eventId]
	);
	return (rows || []).map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n));
}

// POST /api/announcements
// Create a new announcement (stored in announcements table). If status is 'Sent', immediately dispatch notifications.
router.post("/", verifyToken, async (req, res) => {
	try {
		const creator = req.user?.user_id;
		const { event_id: rawEventId, title, message, status = "Draft", scheduled_at = null, markSent = false } = req.body || {};
		if (!title || !message) return res.status(400).json({ message: "title and message are required" });

		// Announcements table should exist (server ensures), but guard anyway
		const hasAnnouncements = await tableExists("announcements");
		if (!hasAnnouncements) {
			return res.status(500).json({ message: "Announcements table missing" });
		}

		const eventId = await resolveEventId({ event_id: rawEventId });

		const now = new Date();
		const dbStatus = toDbStatus(status);
		const [result] = await db.query(
			`INSERT INTO announcements (event_id, title, message, status, scheduled_at, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[eventId, title, message, dbStatus, scheduled_at ? new Date(scheduled_at) : null, creator, now, now]
		);

		const announcementId = result.insertId;

		// If immediate send requested (status Sent or markSent)
		if (dbStatus === "sent" || markSent) {
			const resolvedEventId = eventId || (await resolveEventId({ event_title: req.body?.event_title }));
			const recipients = await getRecipientsForEvent(resolvedEventId);
			const sent = await insertNotifications({
				recipients,
				event_id: resolvedEventId,
				title,
				message,
				status: "sent",
				scheduled_at: null,
				creatorUserId: creator,
			});
			await db.query(
				`UPDATE announcements SET status = 'sent', sent_at = ?, updated_at = ? WHERE announcement_id = ?`,
				[new Date(), new Date(), announcementId]
			);
			return res.json({ ok: true, announcementId, sent });
		}

		// If scheduled, leave as scheduled; scheduler will handle later
		return res.json({ ok: true, announcementId });
	} catch (err) {
		console.error("[announcements] POST / error:", err);
		res.status(500).json({ message: "Failed to create announcement" });
	}
});

// PATCH /api/announcements/:id
// Update fields on an announcement. If status transitions to 'Sent', dispatch notifications.
router.patch("/:id", verifyToken, async (req, res) => {
	try {
		const { id } = req.params;
		const updater = req.user?.user_id;
		const { title, message, status, scheduled_at, event_id: newEventId } = req.body || {};

		// Fetch existing
			let [rows] = await db.query("SELECT * FROM announcements WHERE announcement_id = ?", [id]);
			let existing = rows && rows[0];

			// If not found in announcements, try to upsert based on a notification-derived id
			if (!existing) {
				const [notifRows] = await db.query("SELECT * FROM notifications WHERE notification_id = ? LIMIT 1", [id]);
				const notif = notifRows && notifRows[0];
				if (!notif) {
					return res.status(404).json({ message: "Announcement not found" });
				}
				const now = new Date();
				const targetStatusFromBody = status !== undefined ? toDbStatus(status) : "draft";
				const eventIdToUse = newEventId != null ? Number(newEventId) || null : (notif.event_id || null);
				const [ins] = await db.query(
					`INSERT INTO announcements (event_id, title, message, status, scheduled_at, created_by, created_at, updated_at, sent_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
					[
						eventIdToUse,
						title !== undefined ? title : notif.title,
						message !== undefined ? message : notif.message,
						targetStatusFromBody,
						scheduled_at ? new Date(scheduled_at) : null,
						updater || 0,
						now,
						now,
						targetStatusFromBody === 'sent' ? now : null,
					]
				);
				existing = { announcement_id: ins.insertId, event_id: eventIdToUse, title: title ?? notif.title, message: message ?? notif.message, status: targetStatusFromBody };
				return res.json({ ok: true, announcementId: ins.insertId });
			}

		const updates = [];
		const params = [];
		if (title !== undefined) { updates.push("title = ?"); params.push(title); }
		if (message !== undefined) { updates.push("message = ?"); params.push(message); }
		if (newEventId !== undefined) { updates.push("event_id = ?"); params.push(newEventId ? Number(newEventId) : null); }
		let targetStatus = existing.status;
		if (status !== undefined) { targetStatus = toDbStatus(status); updates.push("status = ?"); params.push(targetStatus); }
		if (scheduled_at !== undefined) { updates.push("scheduled_at = ?"); params.push(scheduled_at ? new Date(scheduled_at) : null); }
		updates.push("updated_at = ?"); params.push(new Date());

		if (updates.length) {
			params.push(id);
			await db.query(`UPDATE announcements SET ${updates.join(', ')} WHERE announcement_id = ?`, params);
		}

		// If moving to sent, dispatch notifications now
		if (String(targetStatus).toLowerCase() === "sent" && String(existing.status).toLowerCase() !== "sent") {
			const recipients = await getRecipientsForEvent(existing.event_id);
			const sent = await insertNotifications({
				recipients,
				event_id: existing.event_id,
				title: title !== undefined ? title : existing.title,
				message: message !== undefined ? message : existing.message,
				status: "sent",
				scheduled_at: null,
				creatorUserId: updater,
			});
			await db.query("UPDATE announcements SET sent_at = ? WHERE announcement_id = ?", [new Date(), id]);
			return res.json({ ok: true, sent });
		}

		return res.json({ ok: true });
	} catch (err) {
		console.error("[announcements] PATCH /:id error:", err);
		res.status(500).json({ message: "Failed to update announcement" });
	}
});

// POST /api/announcements/send
// Explicit send endpoint used by UI. Accepts event_title or event_id and message fields.
router.post("/send", verifyToken, async (req, res) => {
	try {
		const creator = req.user?.user_id;
		const { event_id: rawEventId, event_title, title, message, type = "in-app", markSent = true } = req.body || {};
		if (!title || !message) return res.status(400).json({ message: "title and message are required" });
		// Resolve event id by id or title (or numeric string)
		const eventId = await resolveEventId({ event_id: rawEventId, event_title });
		const recipients = await getRecipientsForEvent(eventId);
		const sent = await insertNotifications({
			recipients,
			event_id: eventId,
			title,
			message,
			status: markSent ? "sent" : "pending",
			scheduled_at: null,
			creatorUserId: creator,
		});
		return res.json(sent);
	} catch (err) {
		console.error("[announcements] POST /send error:", err);
		res.status(500).json({ message: "Failed to send announcement" });
	}
});

// Scheduler: check announcements table for due scheduled entries and dispatch notifications
let schedulerHandle = null;
function startScheduler(intervalMs = 60 * 1000) {
	if (schedulerHandle) return schedulerHandle;
	schedulerHandle = setInterval(async () => {
		try {
			const hasAnnouncements = await tableExists("announcements");
			if (!hasAnnouncements) return; // nothing to do
			const [due] = await db.query(
				`SELECT announcement_id, event_id, title, message
				 FROM announcements
				 WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`
			);
			for (const a of due || []) {
				try {
					const recipients = await getRecipientsForEvent(a.event_id);
					await insertNotifications({
						recipients,
						event_id: a.event_id,
						title: a.title,
						message: a.message,
						status: "sent",
						scheduled_at: null,
						creatorUserId: 0, // system
					});
					await db.query(
						`UPDATE announcements SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE announcement_id = ?`,
						[a.announcement_id]
					);
				} catch (e) {
					console.error("[announcements.scheduler] failed to send", a.announcement_id, e.message);
				}
			}
		} catch (e) {
			console.error("[announcements.scheduler] error:", e.message);
		}
	}, intervalMs);
	return schedulerHandle;
}

export { startScheduler };
export default router;

// DELETE /api/announcements
// Protected: remove all announcements (does not touch user notifications history)
router.delete("/", verifyToken, async (req, res) => {
	try {
		const [exists] = await db.query(
			"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'announcements'",
			[process.env.DB_NAME]
		);
		if (!Array.isArray(exists) || exists.length === 0) {
			return res.json({ ok: true, deleted: 0, message: "announcements table does not exist" });
		}
		const [result] = await db.query("DELETE FROM announcements");
		try { await db.query("ALTER TABLE announcements AUTO_INCREMENT = 1"); } catch {}
		return res.json({ ok: true, deleted: result.affectedRows || 0 });
	} catch (err) {
		console.error("[announcements] DELETE / error:", err);
		res.status(500).json({ message: "Failed to clear announcements" });
	}
});

