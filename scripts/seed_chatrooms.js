// Seed Global and Help chatrooms
import db from '../db.js';

async function seedChatrooms() {
  try {
    console.log('Checking for Global and Help chatrooms...');
    
    // Check if Global chatroom exists
    const [[global]] = await db.query('SELECT * FROM chatrooms WHERE chatroom_id = 1');
    
    if (!global) {
      console.log('Creating Global chatroom...');
      await db.query(
        'INSERT INTO chatrooms (chatroom_id, name, type, event_id) VALUES (1, "Global", "global", NULL)'
      );
      console.log('✅ Global chatroom created');
    } else {
      console.log('✅ Global chatroom already exists');
    }
    
    // Check if Help chatroom exists
    const [[help]] = await db.query('SELECT * FROM chatrooms WHERE chatroom_id = 2');
    
    if (!help) {
      console.log('Creating Help chatroom...');
      await db.query(
        'INSERT INTO chatrooms (chatroom_id, name, type, event_id) VALUES (2, "Help", "help", NULL)'
      );
      console.log('✅ Help chatroom created');
    } else {
      console.log('✅ Help chatroom already exists');
    }
    
    // List all chatrooms
    const [allChatrooms] = await db.query('SELECT * FROM chatrooms ORDER BY chatroom_id');
    console.log('\nAll chatrooms:');
    console.table(allChatrooms);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding chatrooms:', error);
    process.exit(1);
  }
}

seedChatrooms();
