// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// ---------------- Signup ----------------
router.post("/signup", async (req, res) => {
  const { username, email, password, role } = req.body;

  try {
    if (!username || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const validRoles = ["user", "admin", "owner"];
    if (!validRoles.includes(role)) {
      return res
        .status(400)
        .json({ message: "Invalid role. Must be one of: user, admin, owner" });
    }

    const [userByUsername] = await db.query(
      "SELECT user_id FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    if (userByUsername.length > 0) {
      return res.status(409).json({ message: "username_exists" });
    }

    const [userByEmail] = await db.query(
      "SELECT user_id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (userByEmail.length > 0) {
      return res.status(409).json({ message: "email_exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      [username, email, hashedPassword, role]
    );

    const token = jwt.sign(
      { user_id: result.insertId, username, role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      message: "User created successfully",
      username,
      role,
      user_id: result.insertId,
      token,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      if (err.sqlMessage.includes("username"))
        return res.status(409).json({ message: "username_exists" });
      if (err.sqlMessage.includes("email"))
        return res.status(409).json({ message: "email_exists" });
    }
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Server error during signup" });
  }
});

// ---------------- Login ----------------
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    const [rows] = await db.query(
      "SELECT user_id, username, email, role, password FROM users WHERE username = ? LIMIT 1",
      [username]
    );

    if (rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ message: "Invalid username or password" });

    // Mark Online
    await db.query("UPDATE users SET status = 'Online' WHERE user_id = ?", [
      user.user_id,
    ]);

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      message: "Login successful",
      username: user.username,
      role: user.role,
      user_id: user.user_id,
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------------- Get Current User ----------------
router.get("/me", verifyToken, async (req, res) => {
  try {
    if (!req.user || !req.user.user_id) {
      return res.status(400).json({ message: "User ID missing in token" });
    }

    const userId = req.user.user_id;
    const [rows] = await db.query(
      "SELECT user_id, username, email, role, status, last_seen FROM users WHERE user_id = ?",
      [userId]
    );

    if (rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    return res.json(rows[0]);
  } catch (err) {
    console.error("Fetch /me error:", err);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
});

// ---------------- Logout ----------------
router.post("/logout", verifyToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    // Mark Offline and update last_seen
    await db.query(
      "UPDATE users SET status = 'Offline', last_seen = NOW() WHERE user_id = ?",
      [userId]
    );

    return res.json({ message: "Logout successful" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Server error during logout" });
  }
});

export default router;
