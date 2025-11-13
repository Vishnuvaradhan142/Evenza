import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkGlobalHelp() {
  const res = await pool.query(`
    SELECT chatroom_id, event_id, 
    (SELECT COUNT(*) FROM chat_messages WHERE chat_messages.chatroom_id = chatrooms.chatroom_id) as msg_count 
    FROM chatrooms 
    WHERE chatroom_id IN (1, 2) 
    ORDER BY chatroom_id
  `);
  console.log('Global and Help Chatrooms:');
  res.rows.forEach(r => {
    const type = r.chatroom_id === 1 ? 'Global' : 'Help';
    console.log(`  ${type} (ID ${r.chatroom_id}): event_id=${r.event_id}, messages=${r.msg_count}`);
  });
  await pool.end();
}

checkGlobalHelp();
