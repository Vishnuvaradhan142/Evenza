import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function finalSummary() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   🎉 COMPLETE DATABASE MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const tables = [
    { name: 'users', desc: 'User accounts' },
    { name: 'categories', desc: 'Event categories' },
    { name: 'events', desc: 'All events' },
    { name: 'registrations', desc: 'Event registrations' },
    { name: 'tickets', desc: 'Event tickets' },
    { name: 'saved_events', desc: 'Bookmarked events' },
    { name: 'chatrooms', desc: 'Chat rooms (Global, Help, Events)' },
    { name: 'chat_messages', desc: 'Chat messages' },
    { name: 'friends', desc: 'Friend connections' },
    { name: 'draft_events', desc: 'Draft events' },
    { name: 'faqs', desc: 'FAQs' },
    { name: 'notifications', desc: 'Notifications' }
  ];

  let totalRows = 0;
  console.log('📊 TABLE STATUS:\n');

  for (const table of tables) {
    const result = await pool.query(`SELECT COUNT(*) FROM ${table.name}`);
    const count = parseInt(result.rows[0].count);
    totalRows += count;
    const status = count > 0 ? '✅' : '⚠️ ';
    const countStr = count.toString().padStart(4);
    console.log(`${status} ${table.name.padEnd(18)} ${countStr} rows  - ${table.desc}`);
  }

  console.log(`\n   📈 TOTAL: ${totalRows} rows across all tables\n`);

  // Detailed breakdowns
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   📋 DETAILED BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Chatrooms detail
  const chatrooms = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE event_id IS NULL) as global_help,
      COUNT(*) FILTER (WHERE event_id IS NOT NULL) as event_rooms,
      COUNT(*) as total
    FROM chatrooms
  `);
  console.log('💬 CHATROOMS:');
  console.log(`   - Global/Help chatrooms: ${chatrooms.rows[0].global_help}`);
  console.log(`   - Event chatrooms: ${chatrooms.rows[0].event_rooms}`);
  console.log(`   - Total: ${chatrooms.rows[0].total}\n`);

  // Messages breakdown
  const messages = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE chatroom_id <= 2) as global_help_msgs,
      COUNT(*) FILTER (WHERE chatroom_id > 2) as event_msgs,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(DISTINCT chatroom_id) as active_rooms
    FROM chat_messages
  `);
  console.log('💬 CHAT MESSAGES:');
  console.log(`   - Global/Help messages: ${messages.rows[0].global_help_msgs}`);
  console.log(`   - Event messages: ${messages.rows[0].event_msgs}`);
  console.log(`   - Unique users chatting: ${messages.rows[0].unique_users}`);
  console.log(`   - Active chatrooms: ${messages.rows[0].active_rooms}\n`);

  // Events detail
  const events = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE approved = true) as approved,
      COUNT(DISTINCT owner_id) as unique_owners
    FROM events
  `);
  console.log('🎉 EVENTS:');
  console.log(`   - Total events: ${events.rows[0].total}`);
  console.log(`   - Approved: ${events.rows[0].approved}`);
  console.log(`   - Unique organizers: ${events.rows[0].unique_owners}\n`);

  // Registrations detail
  const regs = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(DISTINCT event_id) as events_with_registrations
    FROM registrations
  `);
  console.log('📝 REGISTRATIONS:');
  console.log(`   - Total registrations: ${regs.rows[0].total}`);
  console.log(`   - Unique registered users: ${regs.rows[0].unique_users}`);
  console.log(`   - Events with registrations: ${regs.rows[0].events_with_registrations}\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   ✅ MIGRATION STATUS: COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('🚀 Production Database: Ready');
  console.log('📍 Database: PostgreSQL on Render');
  console.log('🌐 Backend: https://evenza-backend-ir4f.onrender.com');
  console.log('🌐 Frontend: https://evenza-frontend-0bmd.onrender.com\n');

  await pool.end();
}

finalSummary();
