import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testImport() {
  const connection = await pool.connect();
  
  try {
    await connection.query("BEGIN");
    
    const data = JSON.parse(fs.readFileSync('batch1.json', 'utf8'));
    const { categories } = data;

    console.log(`Importing ${categories.length} categories...`);
    
    await connection.query("TRUNCATE TABLE categories CASCADE");
    for (const cat of categories) {
      console.log(`Inserting category: ${cat.category_id} - ${cat.name}`);
      await connection.query(
        "INSERT INTO categories (category_id, category_name, description) VALUES ($1, $2, $3)",
        [cat.category_id, cat.name || cat.category_name, cat.description || null]
      );
    }
    
    await connection.query("SELECT setval('categories_category_id_seq', (SELECT MAX(category_id) FROM categories))");
    await connection.query("COMMIT");
    console.log('✅ Categories imported successfully!');
    
  } catch (error) {
    await connection.query("ROLLBACK");
    console.error('❌ Import failed:', error.message);
    console.error('Full error:', error);
  } finally {
    connection.release();
    await pool.end();
  }
}

testImport();
