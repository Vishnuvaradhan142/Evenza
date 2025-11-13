import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkChatroomsSchema() {
  const res = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'chatrooms' 
    ORDER BY ordinal_position
  `);
  console.log('Chatrooms schema:');
  res.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`));
  await pool.end();
}

checkChatroomsSchema();
