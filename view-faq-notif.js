import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function viewContent() {
  const faqs = await pool.query('SELECT faq_id, question, answer FROM faqs ORDER BY faq_id');
  console.log('📋 FAQs in PostgreSQL:\n');
  faqs.rows.forEach(f => {
    console.log(`${f.faq_id}. Q: ${f.question}`);
    console.log(`   A: ${f.answer}\n`);
  });
  
  const notifs = await pool.query('SELECT notification_id, user_id, message, type, read FROM notifications');
  console.log('🔔 Notifications:\n');
  notifs.rows.forEach(n => {
    console.log(`  ID ${n.notification_id}: User ${n.user_id} - [${n.type}] ${n.message} (read: ${n.read})`);
  });
  
  await pool.end();
}

viewContent();
