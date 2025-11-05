// scripts/clear_announcements.js
import db from "../db.js";

async function clear() {
  try {
    const [exists] = await db.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'announcements'",
      [process.env.DB_NAME]
    );
    if (!Array.isArray(exists) || exists.length === 0) {
      console.log("announcements table does not exist. Nothing to clear.");
      process.exit(0);
    }

    const [result] = await db.query("DELETE FROM announcements");
    try {
      await db.query("ALTER TABLE announcements AUTO_INCREMENT = 1");
    } catch (e) {
      console.warn("Could not reset AUTO_INCREMENT:", e.message);
    }
    console.log(`Deleted ${result.affectedRows || 0} announcements.`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to clear announcements:", err.message);
    process.exit(1);
  }
}

clear();
