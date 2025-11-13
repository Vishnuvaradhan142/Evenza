import pg from "pg";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// Detect which database to use
const usePostgres = !!process.env.DATABASE_URL;

let pool;
let dbType;

if (usePostgres) {
  // PostgreSQL for production (Render)
  const { Pool } = pg;
  dbType = 'postgres';
  console.log("🔍 Using PostgreSQL");
  
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Test the connection
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log("✅ PostgreSQL connection works!");
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:", err.message);
  }
} else {
  // MySQL for local development
  dbType = 'mysql';
  console.log("🔍 Using MySQL (local development)");
  
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'evenza',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  // Test the connection
  try {
    const connection = await pool.getConnection();
    await connection.query("SELECT 1");
    connection.release();
    console.log("✅ MySQL connection works!");
  } catch (err) {
    console.error("❌ MySQL connection failed:", err.message);
  }
}

// Create a unified wrapper that works for both MySQL and PostgreSQL
const db = {
  query: async (sql, params) => {
    if (dbType === 'postgres') {
      // Convert MySQL ? placeholders to PostgreSQL $1, $2, etc.
      let paramIndex = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
      const result = await pool.query(pgSql, params);
      return [result.rows, result.fields];
    } else {
      // MySQL - use as is
      return await pool.query(sql, params);
    }
  },
  
  execute: async (sql, params) => {
    if (dbType === 'postgres') {
      let paramIndex = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
      const result = await pool.query(pgSql, params);
      return [result.rows, result.fields];
    } else {
      return await pool.execute(sql, params);
    }
  },
  
  getConnection: async () => {
    if (dbType === 'postgres') {
      const client = await pool.connect();
      return {
        beginTransaction: async () => client.query('BEGIN'),
        commit: async () => client.query('COMMIT'),
        rollback: async () => client.query('ROLLBACK'),
        execute: async (sql, params) => {
          let paramIndex = 1;
          const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
          const result = await client.query(pgSql, params);
          return [result.rows, result.fields];
        },
        query: async (sql, params) => {
          let paramIndex = 1;
          const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
          const result = await client.query(pgSql, params);
          return [result.rows, result.fields];
        },
        release: () => client.release()
      };
    } else {
      // MySQL connection
      const connection = await pool.getConnection();
      return connection;
    }
  }
};

export default db;
