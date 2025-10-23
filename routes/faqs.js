// routes/faqs.js
import express from "express";
import db from "../db.js";

const router = express.Router();

// Get all FAQs
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT faq_id, question, answer FROM faqs ORDER BY created_at ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching FAQs:", err);
    res.status(500).json({ message: "Error fetching FAQs" });
  }
});

// Add a new FAQ (optional for admin)
router.post("/", async (req, res) => {
  try {
    const { question, answer } = req.body;
    await db.execute(
      "INSERT INTO faqs (question, answer) VALUES (?, ?)",
      [question, answer]
    );
    res.json({ message: "FAQ added successfully" });
  } catch (err) {
    console.error("Error adding FAQ:", err);
    res.status(500).json({ message: "Error adding FAQ" });
  }
});

export default router;
