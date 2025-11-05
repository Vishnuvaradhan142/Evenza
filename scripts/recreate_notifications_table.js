// scripts/recreate_notifications_table.js
import db from "../db.js";

function shouldProceed() {
  const argYes = process.argv.includes("--yes") || process.argv.includes("-y");
  const envYes = ["1", "true", "yes"].includes(String(process.env.CONFIRM_RESET || "").toLowerCase());
  return argYes || envYes;
}

async function recreate() {
  if (!shouldProceed()) {
    console.error("Refusing to drop notifications table without confirmation.\n" +
      "Run with --yes or set CONFIRM_RESET=1 to proceed.");
    process.exit(1);
  }

  console.log("Recreating notifications table...\nThis will DROP and CREATE the table.");

  const sql = `
    DROP TABLE IF EXISTS notifications;
    CREATE TABLE notifications (
      notification_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      event_id INT NULL,
      created_by INT NOT NULL,
      type VARCHAR(32) NOT NULL DEFAULT 'in-app',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      scheduled_at DATETIME NULL,
      scheduled_by INT NULL,
      attempts INT NOT NULL DEFAULT 0,
      error_message VARCHAR(255) NULL,
      created_at DATETIME NOT NULL,
      sent_at DATETIME NULL,
      INDEX idx_user_id (user_id),
      INDEX idx_event_id (event_id),
      INDEX idx_owner (created_by),
      INDEX idx_user_read (user_id, is_read),
      INDEX idx_status_sched (status, scheduled_at),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  try {
    // run multi statements sequentially
    for (const stmt of sql.split(";\n").map(s => s.trim()).filter(Boolean)) {
      await db.query(stmt);
    }
    console.log("✅ notifications table recreated successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to recreate notifications table:", err.message);
    process.exit(2);
  }
}

recreate();
