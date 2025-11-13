import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Use DATABASE_URL from environment
const connectionString = process.env.DATABASE_URL;

console.log("🔍 Using PostgreSQL DATABASE_URL for connection");
console.log("🔍 DB Config:", {
  hasConnectionString: !!connectionString
});

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test the connection
try {
  const client = await pool.connect();
  await client.query("SELECT 1");
  client.release();
  console.log("✅ PostgreSQL connection works!");
} catch (err) {
  console.error("❌ DB connection failed:", err.message);
}

// Create a wrapper to make PostgreSQL work like mysql2
const db = {
  query: async (sql, params) => {
    // Convert MySQL ? placeholders to PostgreSQL $1, $2, etc.
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    
    const result = await pool.query(pgSql, params);
    // Return in mysql2 format: [rows, fields]
    return [result.rows, result.fields];
  },
  execute: async (sql, params) => {
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const result = await pool.query(pgSql, params);
    return [result.rows, result.fields];
  }
};

export default db;
