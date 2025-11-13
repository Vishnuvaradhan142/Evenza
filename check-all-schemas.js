import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkAllSchemas() {
  const tables = ['events', 'registrations', 'tickets', 'saved_events', 'chatrooms', 'chat_messages', 'friends', 'faqs', 'draft_events'];
  
  for (const table of tables) {
    try {
      const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      console.log(`\n${table.toUpperCase()}:`);
      res.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    } catch (error) {
      console.error(`Error checking ${table}:`, error.message);
    }
  }
  
  await pool.end();
}

checkAllSchemas();
