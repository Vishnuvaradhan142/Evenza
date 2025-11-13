import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function importAllData() {
  const conn = await pool.connect();
  
  try {
    console.log('📊 Starting full data migration from MySQL to PostgreSQL...\n');
    await conn.query('BEGIN');

    // Load all data files
    const categories = JSON.parse(fs.readFileSync('../categories-data.json', 'utf8'));
    const events = JSON.parse(fs.readFileSync('../events-data.json', 'utf8'));
    const registrations = JSON.parse(fs.readFileSync('../registrations-data.json', 'utf8'));
    const tickets = JSON.parse(fs.readFileSync('../tickets-data.json', 'utf8'));
    const saved_events = JSON.parse(fs.readFileSync('../saved_events-data.json', 'utf8'));
    const chatrooms = JSON.parse(fs.readFileSync('../chatrooms-data.json', 'utf8'));
    const chat_messages = JSON.parse(fs.readFileSync('../chat_messages-data.json', 'utf8'));
    const friends = JSON.parse(fs.readFileSync('../friends-data.json', 'utf8'));
    const faqs = JSON.parse(fs.readFileSync('../faqs-data.json', 'utf8'));

    // 1. Categories
    console.log('1️⃣  Importing categories...');
    await conn.query('TRUNCATE TABLE categories CASCADE');
    for (const cat of categories) {
      await conn.query(
        'INSERT INTO categories (category_id, name) VALUES ($1, $2)',
        [cat.category_id, cat.name]
      );
    }
    await conn.query("SELECT setval('categories_category_id_seq', (SELECT MAX(category_id) FROM categories))");
    console.log(`   ✅ ${categories.length} categories imported\n`);

    // 2. Events - map to production schema
    console.log('2️⃣  Importing events...');
    await conn.query('TRUNCATE TABLE events CASCADE');
    for (const evt of events) {
      await conn.query(
        `INSERT INTO events (event_id, owner_id, event_name, event_date, location, description, 
         category, image, ticket_price, available_tickets, status, approved, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          evt.event_id,
          evt.created_by || 1,
          evt.title,
          evt.start_time,
          evt.locations ? JSON.stringify(evt.locations) : 'TBD',
          evt.description,
          evt.category_id ? evt.category_id.toString() : '1',
          evt.image || '/uploads/events/default-event.png',
          0,  // ticket_price
          evt.capacity || 100,
          'active',
          true,
          evt.created_at
        ]
      );
    }
    await conn.query("SELECT setval('events_event_id_seq', (SELECT MAX(event_id) FROM events))");
    console.log(`   ✅ ${events.length} events imported\n`);

    // 3. Registrations
    console.log('3️⃣  Importing registrations...');
    await conn.query('TRUNCATE TABLE registrations CASCADE');
    for (const reg of registrations) {
      await conn.query(
        `INSERT INTO registrations (registration_id, user_id, event_id, registration_date, 
         status, ticket_type, tickets_purchased, total_price) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          reg.registration_id,
          reg.user_id,
          reg.event_id,
          reg.registered_at || reg.registration_time,
          reg.status || 'registered',
          reg.ticket_type || 'General',
          1,
          parseFloat(reg.amount || 0)
        ]
      );
    }
    await conn.query("SELECT setval('registrations_registration_id_seq', (SELECT MAX(registration_id) FROM registrations))");
    console.log(`   ✅ ${registrations.length} registrations imported\n`);

    // 4. Tickets
    console.log('4️⃣  Importing tickets...');
    await conn.query('TRUNCATE TABLE tickets CASCADE');
    for (const tkt of tickets) {
      await conn.query(
        `INSERT INTO tickets (ticket_id, registration_id, ticket_number, qr_code, status, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tkt.ticket_id,
          tkt.registration_id,
          tkt.ticket_code,
          tkt.qr_code || null,
          tkt.status || 'active',
          tkt.issue_time || tkt.created_at
        ]
      );
    }
    await conn.query("SELECT setval('tickets_ticket_id_seq', (SELECT MAX(ticket_id) FROM tickets))");
    console.log(`   ✅ ${tickets.length} tickets imported\n`);

    // 5. Saved Events
    console.log('5️⃣  Importing saved events...');
    await conn.query('TRUNCATE TABLE saved_events CASCADE');
    for (const saved of saved_events) {
      await conn.query(
        'INSERT INTO saved_events (saved_event_id, user_id, event_id, saved_at) VALUES ($1, $2, $3, $4)',
        [saved.saved_id, saved.user_id, saved.event_id, saved.created_at]
      );
    }
    await conn.query("SELECT setval('saved_events_saved_event_id_seq', (SELECT MAX(saved_event_id) FROM saved_events))");
    console.log(`   ✅ ${saved_events.length} saved events imported\n`);

    // 6. Chatrooms (skip Global and Help chatrooms that don't have event_id)
    console.log('6️⃣  Importing chatrooms...');
    await conn.query('TRUNCATE TABLE chatrooms CASCADE');
    const validChatrooms = chatrooms.filter(r => r.event_id !== null);
    for (const room of validChatrooms) {
      await conn.query(
        'INSERT INTO chatrooms (chatroom_id, event_id, created_at) VALUES ($1, $2, $3)',
        [room.chatroom_id, room.event_id, room.created_at]
      );
    }
    await conn.query("SELECT setval('chatrooms_chatroom_id_seq', (SELECT MAX(chatroom_id) FROM chatrooms))");
    console.log(`   ✅ ${validChatrooms.length} chatrooms imported (skipped ${chatrooms.length - validChatrooms.length} global/help chatrooms)\n`);

    // 7. Chat Messages (skip messages from global/help chatrooms)
    console.log('7️⃣  Importing chat messages...');
    await conn.query('TRUNCATE TABLE chat_messages CASCADE');
    const validMessages = chat_messages.filter(m => m.chatroom_id > 2);
    for (const msg of validMessages) {
      await conn.query(
        'INSERT INTO chat_messages (message_id, chatroom_id, user_id, message, created_at) VALUES ($1, $2, $3, $4, $5)',
        [msg.message_id, msg.chatroom_id, msg.user_id, msg.message, msg.created_at]
      );
    }
    await conn.query("SELECT setval('chat_messages_message_id_seq', (SELECT MAX(message_id) FROM chat_messages))");
    console.log(`   ✅ ${validMessages.length} chat messages imported (skipped ${chat_messages.length - validMessages.length} global/help messages)\n`);

    // 8. Friends
    console.log('8️⃣  Importing friends...');
    await conn.query('TRUNCATE TABLE friends CASCADE');
    for (const friend of friends) {
      await conn.query(
        'INSERT INTO friends (friendship_id, user_id, friend_id, status, created_at) VALUES ($1, $2, $3, $4, $5)',
        [friend.id, friend.user_id, friend.friend_id, friend.status, friend.created_at]
      );
    }
    await conn.query("SELECT setval('friends_friendship_id_seq', (SELECT MAX(friendship_id) FROM friends))");
    console.log(`   ✅ ${friends.length} friendships imported\n`);

    // 9. FAQs - Skip for now as PostgreSQL requires event_id but MySQL FAQs are general
    console.log('9️⃣  Skipping FAQs (schema mismatch - PostgreSQL requires event_id)...');
    console.log(`   ⏭️  ${faqs.length} FAQs skipped\n`);

    await conn.query('COMMIT');
    console.log('\n🎉 SUCCESS! All data migrated successfully!');
    console.log('\n📊 Summary:');
    console.log(`   - Categories: ${categories.length}`);
    console.log(`   - Events: ${events.length}`);
    console.log(`   - Registrations: ${registrations.length}`);
    console.log(`   - Tickets: ${tickets.length}`);
    console.log(`   - Saved Events: ${saved_events.length}`);
    console.log(`   - Chatrooms: ${chatrooms.length}`);
    console.log(`   - Chat Messages: ${chat_messages.length}`);
    console.log(`   - Friends: ${friends.length}`);
    console.log(`   - FAQs: ${faqs.length}`);

  } catch (error) {
    await conn.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    conn.release();
    await pool.end();
  }
}

importAllData();
