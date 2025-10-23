import express from "express";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get all friends for the logged-in user
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [friends] = await db.query(
      `SELECT u.user_id, u.username, u.status, u.last_seen
       FROM friends f
       JOIN users u ON u.user_id = f.friend_id
       WHERE f.user_id = ? AND f.status = 'accepted'`,
      [userId]
    );

    res.json(friends);
  } catch (err) {
    console.error("Fetch friends error:", err);
    res.status(500).json({ message: "Server error fetching friends" });
  }
});

// Get chat messages with a friend
router.get("/:friendId/messages", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const friendId = req.params.friendId;

    const [messages] = await db.query(
      `SELECT sender_id, receiver_id, message, created_at
       FROM fmessages
       WHERE (sender_id = ? AND receiver_id = ?) 
          OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC`,
      [userId, friendId, friendId, userId]
    );

    res.json(messages);
  } catch (err) {
    console.error("Fetch messages error:", err);
    res.status(500).json({ message: "Server error fetching messages" });
  }
});

// Send message to friend
router.post("/:friendId/messages", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const friendId = req.params.friendId;
    const { message } = req.body;

    if (!message) return res.status(400).json({ message: "Message cannot be empty" });

    const [result] = await db.query(
      `INSERT INTO fmessages (sender_id, receiver_id, message)
       VALUES (?, ?, ?)`,
      [userId, friendId, message]
    );

    res.json({ 
      message_id: result.insertId,
      sender_id: userId,
      receiver_id: friendId,
      message,
      created_at: new Date() 
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ message: "Server error sending message" });
  }
});

export default router;
