// deleteUsers.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function deleteAllUsers() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME, // make sure it's "evenza"
    });

    // Disable foreign key checks temporarily
    await connection.query("SET FOREIGN_KEY_CHECKS = 0;");

    // Delete all users
    const [result] = await connection.query("DELETE FROM users;");
    console.log(`Deleted ${result.affectedRows} users.`);

    // Enable foreign key checks again
    await connection.query("SET FOREIGN_KEY_CHECKS = 1;");

    await connection.end();
    console.log("All users deleted successfully!");
  } catch (err) {
    console.error("Error deleting users:", err);
  }
}

deleteAllUsers();
