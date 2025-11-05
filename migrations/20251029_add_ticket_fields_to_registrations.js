import db from '../db.js';

async function main() {
  try {
    const dbName = process.env.DB_NAME;

    // Check and add ticket_type if missing
    const [t1] = await db.query(
      "SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = ? AND table_name = 'registrations' AND column_name = 'ticket_type'",
      [dbName]
    );
    if (t1[0].cnt === 0) {
      console.log("Adding 'ticket_type' column...");
      await db.query("ALTER TABLE registrations ADD COLUMN ticket_type VARCHAR(100) DEFAULT 'General'");
      console.log("'ticket_type' added");
    } else {
      console.log("'ticket_type' already exists");
    }

    // Check and add amount if missing
    const [t2] = await db.query(
      "SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = ? AND table_name = 'registrations' AND column_name = 'amount'",
      [dbName]
    );
    if (t2[0].cnt === 0) {
      console.log("Adding 'amount' column...");
      await db.query("ALTER TABLE registrations ADD COLUMN amount DECIMAL(10,2) DEFAULT 0.00");
      console.log("'amount' added");
    } else {
      console.log("'amount' already exists");
    }

    // Backfill NULL/empty values to sensible defaults
    console.log("Backfilling NULL/empty values...");
    await db.query("UPDATE registrations SET ticket_type = 'General' WHERE ticket_type IS NULL");
    await db.query("UPDATE registrations SET amount = 0.00 WHERE amount IS NULL OR amount = ''");

    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
