import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifyAllData() {
  try {
    console.log('🔍 Verifying all data in PostgreSQL...\n');
    
    const tables = [
      'users',
      'categories', 
      'events', 
      'registrations', 
      'tickets', 
      'saved_events', 
      'chatrooms', 
      'chat_messages', 
      'friends',
      'faqs',
      'draft_events',
      'notifications'
    ];
    
    for (const table of tables) {
      const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
      const count = parseInt(result.rows[0].count);
      const status = count > 0 ? '✅' : '❌';
      console.log(`${status} ${table.padEnd(20)} ${count} rows`);
    }
    
    console.log('\n📊 Sample Data Check:');
    
    // Check categories
    const cats = await pool.query('SELECT category_id, name FROM categories ORDER BY category_id');
    console.log('\nCategories:');
    cats.rows.forEach(c => console.log(`  ${c.category_id}. ${c.name}`));
    
    // Check events
    const events = await pool.query('SELECT event_id, event_name FROM events ORDER BY event_id LIMIT 5');
    console.log('\nFirst 5 Events:');
    events.rows.forEach(e => console.log(`  ${e.event_id}. ${e.event_name}`));
    
    // Check registrations
    const regs = await pool.query('SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as users, COUNT(DISTINCT event_id) as events FROM registrations');
    console.log('\nRegistrations:');
    console.log(`  Total: ${regs.rows[0].total}, Unique Users: ${regs.rows[0].users}, Unique Events: ${regs.rows[0].events}`);
    
    // Check chatrooms
    const rooms = await pool.query('SELECT chatroom_id, event_id FROM chatrooms ORDER BY chatroom_id LIMIT 5');
    console.log('\nFirst 5 Chatrooms:');
    rooms.rows.forEach(r => console.log(`  Chatroom ${r.chatroom_id} -> Event ${r.event_id}`));
    
    // Check chat messages
    const msgs = await pool.query('SELECT COUNT(*) as total, COUNT(DISTINCT chatroom_id) as rooms, COUNT(DISTINCT user_id) as users FROM chat_messages');
    console.log('\nChat Messages:');
    console.log(`  Total: ${msgs.rows[0].total}, Chatrooms: ${msgs.rows[0].rooms}, Users: ${msgs.rows[0].users}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

verifyAllData();
