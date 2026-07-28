// hashPasswords.js  (PostgreSQL version)

const bcrypt = require('bcrypt');
const pool = require('./db'); // Assuming db.js is in the same folder and uses the "pg" package

const defaultPassword = 'pass123'; // This will be the new password for ALL users
const saltRounds = 10;

async function hashAndUpdatePasswords() {
    console.log('Starting password hashing...');
    try {
        // 1. Create the hash for the default password
        const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
        console.log('New hash created.');

        // 2. Update all users in the database with this new hash
        // We only update users who still have the 'hashed_password' placeholder
        // NOTE: pg uses $1, $2... placeholders (not ?), and pool.query (not pool.execute)
        const result = await pool.query(
            'UPDATE "users" SET password_hash = $1 WHERE password_hash = $2',
            [hashedPassword, 'hashed_password']
        );

        console.log('--------------------------------------------------');
        console.log(`✅ Success! ${result.rowCount} users have been updated.`);
        console.log(`All updated users now have the password: ${defaultPassword}`);
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('❌ Error updating passwords:', error);
    } finally {
        await pool.end(); // Close the database connection
    }
}

// Run the function
hashAndUpdatePasswords();