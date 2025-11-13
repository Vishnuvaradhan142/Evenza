import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addNotificationsAndFAQs() {
  const conn = await pool.connect();
  
  try {
    console.log('🔧 Adding Notifications and FAQs...\n');
    await conn.query('BEGIN');

    // Step 1: Alter FAQs table to allow NULL event_id
    console.log('1️⃣  Altering FAQs table to allow NULL event_id...');
    await conn.query('ALTER TABLE faqs ALTER COLUMN event_id DROP NOT NULL');
    console.log('   ✅ FAQs schema updated\n');

    // Step 2: Import FAQs
    console.log('2️⃣  Importing FAQs...');
    const faqs = JSON.parse(fs.readFileSync('../faqs-data.json', 'utf8'));
    await conn.query('TRUNCATE TABLE faqs CASCADE');
    for (const faq of faqs) {
      await conn.query(
        'INSERT INTO faqs (faq_id, event_id, question, answer, created_at) VALUES ($1, $2, $3, $4, $5)',
        [faq.faq_id, null, faq.question, faq.answer, faq.created_at]
      );
    }
    await conn.query("SELECT setval('faqs_faq_id_seq', (SELECT MAX(faq_id) FROM faqs))");
    console.log(`   ✅ ${faqs.length} FAQs imported\n`);

    // Step 3: Import Notifications - map MySQL schema to PostgreSQL
    console.log('3️⃣  Importing Notifications...');
    const notifications = JSON.parse(fs.readFileSync('../notifications-data.json', 'utf8'));
    await conn.query('TRUNCATE TABLE notifications CASCADE');
    
    // Filter notifications for valid user_ids (only users 1-10 exist)
    const validNotifs = notifications.filter(n => n.user_id >= 1 && n.user_id <= 10);
    
    for (const notif of validNotifs) {
      // Map MySQL notification structure to PostgreSQL:
      // MySQL: notification_id, user_id, event_id, type, title, message, status, is_read, ...
      // PostgreSQL: notification_id, user_id, message, type, related_id, read, created_at
      
      await conn.query(
        `INSERT INTO notifications (notification_id, user_id, message, type, related_id, read, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          notif.notification_id,
          notif.user_id,
          notif.title ? `${notif.title}: ${notif.message}` : notif.message,
          notif.type || 'general',
          notif.event_id,
          notif.is_read === 1,
          notif.created_at
        ]
      );
    }
    await conn.query("SELECT setval('notifications_notification_id_seq', (SELECT MAX(notification_id) FROM notifications))");
    console.log(`   ✅ ${validNotifs.length} notifications imported (filtered ${notifications.length - validNotifs.length} with invalid user_ids)\n`);

    await conn.query('COMMIT');
    console.log('🎉 SUCCESS! Notifications and FAQs added successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - FAQs: ${faqs.length}`);
    console.log(`   - Notifications: ${validNotifs.length}`);

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    conn.release();
    await pool.end();
  }
}

addNotificationsAndFAQs();
