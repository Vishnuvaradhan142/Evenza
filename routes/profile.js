import express from "express";
import db from "../db.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// Ensure avatar folder exists
const avatarDir = path.join(process.cwd(), "uploads/avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

// Multer setup for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${req.params.id}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) cb(new Error("Only image files are allowed"), false);
    else cb(null, true);
  },
});

// Get profile by user_id
router.get("/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const [users] = await db.query(
      `SELECT user_id, username, email, role, bio, avatar,
              contact_phone, status, last_seen, created_at
       FROM users WHERE user_id = ?`,
      [userId]
    );
    if (users.length === 0) return res.status(404).json({ error: "User not found" });

    const [badges] = await db.query(
      `SELECT ub.badge_id, b.key, b.title, b.description 
       FROM user_badges ub 
       JOIN badges b ON ub.badge_id = b.badge_id 
       WHERE ub.user_id = ?`,
      [userId]
    );

    const [eventsAttended] = await db.query(
      "SELECT COUNT(*) AS count FROM registrations WHERE user_id = ?",
      [userId]
    );

    const [reviews] = await db.query(
      "SELECT COUNT(*) AS count FROM ratings_reviews WHERE user_id = ?",
      [userId]
    );

    // Full URL for avatar
    const avatarFullURL = users[0].avatar
      ? `${req.protocol}://${req.get("host")}${users[0].avatar}?t=${Date.now()}`
      : null;

    res.json({
      ...users[0],
      avatar: avatarFullURL,
      badges,
      stats: {
        eventsAttended: eventsAttended[0].count,
        reviewsWritten: reviews[0].count,
      },
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Update bio
router.put("/:id/bio", async (req, res) => {
  try {
    await db.query("UPDATE users SET bio = ? WHERE user_id = ?", [req.body.bio, req.params.id]);
    res.json({ success: true, message: "Bio updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update bio" });
  }
});

// Update contact
router.put("/:id/contact", async (req, res) => {
  try {
    await db.query("UPDATE users SET contact_phone = ? WHERE user_id = ?", [req.body.contact_phone, req.params.id]);
    res.json({ success: true, message: "Contact updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// Update password
router.put("/:id/password", async (req, res) => {
  try {
    const [user] = await db.query("SELECT password FROM users WHERE user_id = ?", [req.params.id]);
    if (user.length === 0) return res.status(404).json({ error: "User not found" });

    const validPass = await bcrypt.compare(req.body.oldPassword, user[0].password);
    if (!validPass) return res.status(400).json({ error: "Old password is incorrect" });

    const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(req.body.newPassword))
      return res.status(400).json({
        error: "Password must be at least 8 characters, include 1 uppercase letter and 1 symbol",
      });

    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE user_id = ?", [hashedPassword, req.params.id]);
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password" });
  }
});

// Update avatar
router.put("/:id/avatar", upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const avatarPath = `/uploads/avatars/${req.file.filename}`;
    await db.query("UPDATE users SET avatar = ? WHERE user_id = ?", [avatarPath, req.params.id]);
    const avatarFullURL = `${req.protocol}://${req.get("host")}${avatarPath}?t=${Date.now()}`;
    res.json({ success: true, message: "Avatar updated successfully", avatar: avatarFullURL });
  } catch (err) {
    console.error("Error updating avatar:", err);
    res.status(500).json({ error: "Failed to update avatar" });
  }
});

export default router;
