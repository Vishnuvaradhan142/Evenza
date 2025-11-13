import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function completeAllMigration() {
  const conn = await pool.connect();
  
  try {
    console.log('🔧 Starting complete migration with schema fixes...\n');
    await conn.query('BEGIN');

    // Step 1: Alter chatrooms to allow NULL event_id
    console.log('1️⃣  Altering chatrooms table to allow NULL event_id...');
    await conn.query('ALTER TABLE chatrooms ALTER COLUMN event_id DROP NOT NULL');
    console.log('   ✅ Chatrooms schema updated\n');

    // Step 2: Import ALL chatrooms including Global and Help
    console.log('2️⃣  Importing ALL chatrooms (including Global and Help)...');
    const chatrooms = JSON.parse(fs.readFileSync('../chatrooms-data.json', 'utf8'));
    await conn.query('TRUNCATE TABLE chatrooms CASCADE');
    for (const room of chatrooms) {
      await conn.query(
        'INSERT INTO chatrooms (chatroom_id, event_id, created_at) VALUES ($1, $2, $3)',
        [room.chatroom_id, room.event_id, room.created_at]
      );
    }
    await conn.query("SELECT setval('chatrooms_chatroom_id_seq', (SELECT MAX(chatroom_id) FROM chatrooms))");
    console.log(`   ✅ ${chatrooms.length} chatrooms imported (including Global and Help)\n`);

    // Step 3: Import ALL chat messages
    console.log('3️⃣  Importing ALL chat messages...');
    const chat_messages = JSON.parse(fs.readFileSync('../chat_messages-data.json', 'utf8'));
    await conn.query('TRUNCATE TABLE chat_messages CASCADE');
    for (const msg of chat_messages) {
      await conn.query(
        'INSERT INTO chat_messages (message_id, chatroom_id, user_id, message, created_at) VALUES ($1, $2, $3, $4, $5)',
        [msg.message_id, msg.chatroom_id, msg.user_id, msg.message, msg.created_at]
      );
    }
    await conn.query("SELECT setval('chat_messages_message_id_seq', (SELECT MAX(message_id) FROM chat_messages))");
    console.log(`   ✅ ${chat_messages.length} chat messages imported\n`);

    // Step 4: Check and alter draft_events schema if needed
    console.log('4️⃣  Checking draft_events schema...');
    const draftSchema = await conn.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'draft_events' 
      ORDER BY ordinal_position
    `);
    console.log('   Draft events columns:', draftSchema.rows.map(r => r.column_name).join(', '));
    
    // Import draft_events with mapping to production schema
    console.log('\n5️⃣  Importing draft events...');
    const draft_events = JSON.parse(fs.readFileSync('../draft_events-data.json', 'utf8'));
    await conn.query('TRUNCATE TABLE draft_events CASCADE');
    
    for (const draft of draft_events) {
      // Map MySQL draft schema to PostgreSQL schema
      await conn.query(
        `INSERT INTO draft_events (draft_id, owner_id, event_name, event_date, location, 
         description, category, documents, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          draft.draft_id,
          draft.submitted_by,
          draft.title,
          draft.start_time,
          draft.locations ? JSON.stringify(draft.locations) : 'TBD',
          draft.description,
          draft.category_id ? draft.category_id.toString() : '1',
          draft.documents ? JSON.stringify(draft.documents) : null,
          draft.submitted_at || draft.created_at
        ]
      );
    }
    await conn.query("SELECT setval('draft_events_draft_id_seq', (SELECT MAX(draft_id) FROM draft_events))");
    console.log(`   ✅ ${draft_events.length} draft events imported\n`);

    await conn.query('COMMIT');
    console.log('\n🎉 COMPLETE! All remaining data migrated successfully!');
    console.log('\n📊 Final Summary:');
    console.log(`   - Chatrooms: ${chatrooms.length} (including Global and Help)`);
    console.log(`   - Chat Messages: ${chat_messages.length} (all messages)`);
    console.log(`   - Draft Events: ${draft_events.length}`);

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    conn.release();
    await pool.end();
  }
}

completeAllMigration();
