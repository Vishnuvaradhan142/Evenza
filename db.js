import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// Support both individual DB variables and DATABASE_URL
let dbConfig;

if (process.env.DATABASE_URL) {
  // Parse DATABASE_URL if provided (format: mysql://user:pass@host:port/dbname)
  const url = new URL(process.env.DATABASE_URL);
  dbConfig = {
    host: url.hostname,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading slash
    port: parseInt(url.port) || 3306,
  };
  console.log("🔍 Using DATABASE_URL for connection");
} else {
  // Use individual environment variables
  dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 3306,
  };
  console.log("🔍 Using individual DB variables for connection");
}

// Log connection details (without password) for debugging
console.log("🔍 DB Config:", {
  host: dbConfig.host,
  user: dbConfig.user,
  database: dbConfig.database,
  port: dbConfig.port,
  hasPassword: !!dbConfig.password
});

const db = await mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // 60 seconds
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Actually test the connection
try {
  await db.query("SELECT 1");
  console.log("✅ DB connection works!");
} catch (err) {
  console.error("❌ DB connection failed:", err.message);
}

export default db;
