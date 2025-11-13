import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchemas() {
  const notif = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'notifications' 
    ORDER BY ordinal_position
  `);
  console.log('NOTIFICATIONS schema:');
  notif.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`));
  
  const faq = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'faqs' 
    ORDER BY ordinal_position
  `);
  console.log('\nFAQS schema:');
  faq.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`));
  
  await pool.end();
}

checkSchemas();
