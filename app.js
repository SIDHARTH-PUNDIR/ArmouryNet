// backend/app.js

const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session"); // user sessions
const path = require("path");               // managing file paths
const pool = require("./db");               // database connection
const bcrypt = require('bcrypt');
const saltRounds = 10; // How much processing to use



const { URL } = require('url');



const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static("public"));

// Setup session management
app.use(session({
    secret: 'your_secret_key_12345', // CHANGE THIS to a long, random string
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 } // Session expires in 1 hour
}));

// ===================================
//  MIDDLEWARE (Access Control)
// ===================================

/**
 * Checks if a user is authenticated.
 * If not, redirects to the login page.
 */
const checkAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    next();
};

/**
 * Checks if the authenticated user has one of the allowed roles.
 * @param {string[]} allowedRoles - An array of roles that are allowed.
 */
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.session.user.role)) {
            // User is logged in, but doesn't have the right role
            return res.status(403).send('Access Denied: You do not have permission to view this page.');
        }
        next();
    };
};


/**
 * Prevents the browser from caching a page.
 * This stops the "back button" problem after logout.
 */
const setNoCache = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
};

// ===================================
//  PUBLIC ROUTES (No Login Needed)
// ===================================

// Serves the public homepage
app.get("/", function(req, res) {
    res.render("home");
});

// Serves the public about page
app.get("/about", function(req, res) {
    res.render("about");
});

// Serves the login page
// Serves the login page
app.get("/login", function(req, res) {
    res.render("login", { 
        error: req.query.error || null,   
        success: req.query.success || null  
    }); 
});
// ===================================
//  AUTHENTICATION ROUTES
// ===================================

// Handles the login form submission
// backend/app.js

// Handles the login form submission
app.post("/login", async function(req, res) {
    const { username, password } = req.body;

    try {
        // --- THIS IS THE FIX ---
        // 1. Find the user and explicitly select all the fields we need.
        const [rows] = await pool.execute(
            `SELECT 
                s.soldier_id, s.name, s.\`rank\`, s.company_id, 
                u.role, u.password_hash 
             FROM Users u 
             JOIN Soldiers s ON u.soldier_id = s.soldier_id 
             WHERE u.username = ?`,
            [username]
        );

        if (rows.length === 0) {
            return res.redirect("/login?error=Invalid username or password.");
        }

        const user = rows[0];
        const hashedPassword = user.password_hash; // This will now work

        // 2. Check if the user has a password set
        if (!hashedPassword) {
            console.error(`User ${username} has a NULL password in the database.`);
            return res.redirect("/login?error=Account is not properly configured. Contact admin.");
        }
        // --- END OF FIX ---

        // 3. Securely compare
        const isMatch = await bcrypt.compare(password, hashedPassword);

        if (!isMatch) {
            return res.redirect("/login?error=Invalid username or password.");
        }

        // 4. --- Login Successful ---
        req.session.user = {
            id: user.soldier_id,
            name: user.name,
            rank: user.rank,
            role: user.role,
            company_id: user.company_id 
        };
        
        // 5. ... (Your switch statement for redirecting) ...
        switch (user.role) {
            case 'CO': res.redirect('/co'); break;
            case 'Adjutant':
                res.redirect('/adjutant'); break;
            case 'CompanyCommander':
                res.redirect('/cc-dashboard'); break;
            case 'QM': res.redirect('/qm'); break;
            case 'Soldier': res.redirect('/soldier'); break;
            case 'MT_JCO':
            case 'MTO': res.redirect('/mto'); break;
            case 'Company_Weapon_Incharge':
                res.redirect('/kote'); break;
            case 'Battalion_Ammo_Incharge':
                res.redirect('/operator'); break;
            case 'Company_Ration_Incharge':
                res.redirect('/ration'); break;
            default:
                res.redirect('/soldier');
        }

    } catch (error) {
        console.error("Database error during login:", error);
        res.redirect("/login?error=A server error occurred.");
    }
});
// Handles logout
app.get("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) {
            // Handle error, but still try to redirect
            return res.redirect("/");
        }
        res.clearCookie('connect.sid'); // Clears the session cookie
        res.redirect("/login");
    });
});
// GET: Show the form
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { error: null });
});

// POST: Handle the logic
app.post('/forgot-password', async (req, res) => {
    const { soldier_id, rank, dob, new_password } = req.body;

    try {
        // 1. Check if a soldier matches ALL these details
        // We format the DOB in SQL to match the input string format (YYYY-MM-DD)
        const [rows] = await pool.execute(
            "SELECT soldier_id FROM Soldiers WHERE soldier_id = ? AND `rank` = ? AND dob = ?",
            [soldier_id, rank, dob]
        );

        if (rows.length === 0) {
            // No match found
            return res.render('forgot-password', { error: 'Verification failed. Details do not match our records.' });
        }

        // 2. Soldier found! Hash the new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // 3. Update the Users table
        // Note: This assumes a User entry already exists for this soldier.
        await pool.execute(
            'UPDATE Users SET password_hash = ? WHERE soldier_id = ?',
            [hashedPassword, soldier_id]
        );

        // 4. Success! Redirect to login
        res.redirect('/login?success=Password reset successfully. Please login.');

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.render('forgot-password', { error: 'Server error during verification.' });
    }
});

// ===================================
//  PROTECTED DASHBOARD ROUTES
// ===================================

// All routes below require the user to be logged in (checkAuth)
// and have the correct role (checkRole)


// CO Dashboard Route
app.get("/co", checkAuth, setNoCache, checkRole(['CO']), async function(req, res) {
    try {
        // 1. Personnel Stats (from view_BattalionPersonnelOverview)
        const [personnelStats] = await pool.query(
            'SELECT SUM(total_strength) AS total_strength, SUM(officers) AS total_officers, SUM(jcos) AS total_jcos, SUM(other_ranks) AS total_ors FROM view_BattalionPersonnelOverview'
        );

        // 2. Leave Stats
        const [leaveStats] = await pool.query(
            "SELECT COUNT(*) AS on_leave FROM Leave_Records WHERE `status` = 'Approved' AND CURDATE() BETWEEN start_date AND end_date"
        );

        // 3. Weapon Stats (from view_BattalionMasterInventory)
        const [weaponStats] = await pool.query(
            "SELECT total_items, serviceable_count FROM view_BattalionMasterInventory WHERE category = 'Weapons'"
        );

        // 4. Vehicle Stats
        const [vehicleStats] = await pool.query(
            "SELECT total_items, serviceable_count FROM view_BattalionMasterInventory WHERE category = 'Vehicles'"
        );
        
        // 5. Ammo Stats (Total Quantity)
        const [ammoStats] = await pool.query(
            "SELECT SUM(quantity) AS total_ammo FROM Ammunition"
        );

        // 6. Ration Stats (Total Quantity in Battalion Store)
        const [rationStats] = await pool.query(
            "SELECT SUM(quantity_kg) AS total_rations FROM BattalionStock"
        );

        // 7. All Active Alerts (High Priority)
        const [allAlerts] = await pool.query(
            "SELECT * FROM view_ActiveAlerts ORDER BY alert_date_formatted DESC LIMIT 20"
        );

        // 8. Company-wise Strength (for the Personnel section)
        const [companyStrength] = await pool.query(
            "SELECT * FROM view_BattalionPersonnelOverview"
        );

        // 9. Readiness Data (for Reports section)
        const [readiness] = await pool.query(`
            SELECT 
            c.company_name, 
            -- Count distinct soldiers who have at least one weapon assigned
            COUNT(DISTINCT swa.soldier_id) as issued_weapons 
            FROM Companies c 
            LEFT JOIN Soldiers s ON c.company_id = s.company_id AND s.status = 'Active'
            LEFT JOIN Soldier_Weapon_Assignments swa ON s.soldier_id = swa.soldier_id
            GROUP BY c.company_id, c.company_name
        `);

        // 10. List of all Companies (for dropdowns, etc.)
            const [allCompanies] = await pool.query("SELECT company_id, company_name FROM Companies");

        const [approvalQueue] = await pool.query(`
            SELECT 
                lr.leave_id, 
                s.name, 
                s.rank, 
                c.company_name, 
                lr.leave_type, 
                DATE_FORMAT(lr.start_date, '%d-%m-%Y') as start,
                DATE_FORMAT(lr.end_date, '%d-%m-%Y') as end,
                lr.reason
            FROM Leave_Records lr
            JOIN Soldiers s ON lr.soldier_id = s.soldier_id
            JOIN Companies c ON s.company_id = c.company_id
            WHERE lr.status = 'Pending'
            ORDER BY lr.start_date ASC
            LIMIT 10
        `);

        res.render("co", {
            user: req.session.user,
            stats: {
                strength: personnelStats[0],
                onLeave: leaveStats[0].on_leave,
                weapons: weaponStats[0] || { total_items: 0, serviceable_count: 0 },
                vehicles: vehicleStats[0] || { total_items: 0, serviceable_count: 0 },
                ammo: ammoStats[0].total_ammo || 0,
                rations: rationStats[0].total_rations || 0
            },
            alerts: allAlerts,
            companyStrength: companyStrength,
            readiness: readiness,
            allCompanies: allCompanies,
            approvalQueue: approvalQueue,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("CO dashboard error:", error);
        res.status(500).send("Server Error");
    }
});
// API: Get list of all system users
app.get('/api/admin/users', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;

        const [users] = await pool.execute(
            `SELECT u.user_id, u.username, u.role, s.name, s.\`rank\` 
             FROM Users u 
             JOIN Soldiers s ON u.soldier_id = s.soldier_id
             WHERE u.username LIKE ? OR s.name LIKE ? OR u.role LIKE ?
             ORDER BY u.role, s.name`,
            [searchPattern, searchPattern, searchPattern]
        );
        res.json(users);
    } catch (error) {
        console.error("Admin User Search Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// POST: Reset a user's password to default ('pass123')
app.post('/admin/reset-password/:user_id', checkAuth, checkRole(['CO']), async (req, res) => {
    const { user_id } = req.params;
    
    // Hash for 'pass123' (You can generate a fresh one or use a constant)
    // For simplicity in this demo, we use a known hash for 'pass123'
    // In production, generate this dynamically using bcrypt.hash('pass123', 10)
    const defaultHash = '$2b$10$YourKnownHashStringHere...'; // Replace if you have the specific string, or let's compute it live:
    
    try {
        const hash = await bcrypt.hash('pass123', 10); // Live generation
        
        await pool.execute(
            'UPDATE Users SET password_hash = ? WHERE user_id = ?',
            [hash, user_id]
        );
        res.redirect('/co?success=User password reset to default (pass123).');
    } catch (error) {
        console.error("Password Reset Error:", error);
        res.redirect('/co?error=Could not reset password.');
    }
});
// 1. API: Get list of soldiers who DO NOT have a user account yet
app.get('/api/admin/unregistered-soldiers', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        const [soldiers] = await pool.query(
            `SELECT soldier_id, name, \`rank\` 
             FROM Soldiers 
             WHERE soldier_id NOT IN (SELECT soldier_id FROM Users)
             AND \`status\` = 'Active'`
        );
        res.json(soldiers);
    } catch (error) {
        console.error("Error fetching unregistered soldiers:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// 2. API: Get single user details for editing
app.get('/api/admin/user/:id', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT user_id, username, role FROM Users WHERE user_id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

// 3. POST: Add a new user
app.post('/admin/add-user', checkAuth, checkRole(['CO']), async (req, res) => {
    const { soldier_id, username, password, role } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.execute(
            'INSERT INTO Users (soldier_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
            [soldier_id, username, hashedPassword, role]
        );
        res.redirect('/co?success=User account created successfully!');
    } catch (error) {
        console.error("Error adding user:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// 4. POST: Update a user (Role/Username)
app.post('/admin/update-user/:id', checkAuth, checkRole(['CO']), async (req, res) => {
    const { id } = req.params;
    const { username, role } = req.body;

    try {
        await pool.execute(
            'UPDATE Users SET username = ?, role = ? WHERE user_id = ?',
            [username, role, id]
        );
        res.redirect('/co?success=User updated successfully!');
    } catch (error) {
        console.error("Error updating user:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// 5. GET: Delete a user
app.get('/admin/delete-user/:id', checkAuth, checkRole(['CO']), async (req, res) => {
    const { id } = req.params;
    // Prevent CO from deleting themselves
    if (id == req.session.user.user_id) { // Assuming user_id is in session, or check username
         return res.redirect('/co?error=You cannot delete your own account.');
    }

    try {
        await pool.execute('DELETE FROM Users WHERE user_id = ?', [id]);
        res.redirect('/co?success=User access revoked.');
    } catch (error) {
        res.redirect('/co?error=Could not delete user.');
    }
});
// POST /admin/run-daily-checks - Manually triggers the daily maintenance procedure
app.post('/admin/run-daily-checks', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        // Call the stored procedure we created earlier
        await pool.execute('CALL sp_RunDailyChecks()');
        
        res.redirect('/co?success=Daily diagnostics run successfully. Alerts have been updated.');
    } catch (error) {
        console.error("Error running daily checks:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.sqlMessage || 'Server error during diagnostics.'));
    }
});
// POST /admin/reset-yearly-leaves - Manually triggers the yearly reset
app.post('/admin/reset-yearly-leaves', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        await pool.execute('CALL sp_ResetYearlyLeaves()');
        res.redirect('/co?success=Yearly leave quotas have been reset for all soldiers.');
    } catch (error) {
        console.error("Error resetting leaves:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.sqlMessage || 'Server error.'));
    }
});







































// API route to search personnel by name, rank, or company
app.get("/api/search-personnel", checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`; // The search term with wildcards

        // The SQL query now checks the term against name, rank, AND company_name
        const [rows] = await pool.execute(
            `SELECT soldier_id, name, \`rank\`, company_name 
             FROM view_SoldierPersonalDashboard 
             WHERE name LIKE ? OR \`rank\` LIKE ? OR company_name LIKE ?`,
            [searchPattern, searchPattern, searchPattern] // Pass the term for each '?'
        );
        
        res.json(rows);

    } catch (error) {
        console.error("Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});


// API endpoint to get a single soldier's data for the edit form
app.get('/api/personnel/:id', checkAuth, checkRole(['Adjutant', 'CO']), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Fetch the existing data for this soldier from the base table
        const [soldierRows] = await pool.execute('SELECT * FROM Soldiers WHERE soldier_id = ?', [id]);
        
        if (soldierRows.length === 0) {
            return res.status(404).json({ message: 'Soldier not found' });
        }
        
        // Send the soldier's data back to the frontend as JSON
        res.json(soldierRows[0]);

    } catch (error) {
        console.error("API Error fetching soldier:", error);
        res.status(500).json({ message: 'Server error' });
    }
});


// GET /personnel/set-status/:id/:status - Marks a soldier as Discharged
app.get('/personnel/set-status/:id/:status', checkAuth, checkRole(['Adjutant', 'CO']), async (req, res) => {
    const { id, status } = req.params;
    
    const newStatus = (status === 'Discharged') ? 'Discharged' : 'Active';

    try {
        await pool.execute(
            'UPDATE Soldiers SET `status` = ? WHERE soldier_id = ?',
            [newStatus, id]
        );
        res.redirect('/adjutant?success=Soldier status updated!');
    } catch (error) {
        console.error("Error updating status:", error);
        res.redirect('/adjutant?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// API route to search leave records by soldier name, rank, or company
app.get("/api/search-leave", checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchStatus = req.query.status || 'all'; // Get the status ('all' or 'Pending')
        const searchPattern = `%${searchTerm}%`;

        // Start building the query
        let sql = `SELECT * FROM view_AllLeaveRecords 
                   WHERE (soldier_name LIKE ? OR \`rank\` LIKE ? OR company_name LIKE ?)`;
        
        let params = [searchPattern, searchPattern, searchPattern];

        // If a specific status is requested, add it to the query
        if (searchStatus !== 'all') {
            sql += ' AND `status` = ?';
            params.push(searchStatus);
        }

        sql += ' ORDER BY start_date DESC';

        const [rows] = await pool.execute(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Search Leave API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});



// API route to get full details for a single leave request
app.get('/api/leave-details/:id', checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Get the current leave's details
        const [leaveRows] = await pool.execute(
            'SELECT * FROM view_AllLeaveRecords WHERE leave_id = ?',
            [id]
        );
        
        if (leaveRows.length === 0) {
            return res.status(404).json({ message: 'Leave record not found' });
        }
        
        const leaveData = leaveRows[0];
        
        // 2. Find the last approved leave for this soldier
        const [lastLeaveRows] = await pool.execute(
            `SELECT DATE_FORMAT(end_date, '%d-%m-%Y') AS last_leave_end_date 
             FROM Leave_Records 
             WHERE soldier_id = ? AND \`status\` = 'Approved' AND start_date < ?
             ORDER BY start_date DESC LIMIT 1`,
            [leaveData.soldier_id, leaveData.start_date] // start_date from the DB, not formatted
        );
        
        const lastLeave = lastLeaveRows.length > 0 ? lastLeaveRows[0].last_leave_end_date : 'N/A';
        
        // 3. Send all data as a single JSON object
        res.json({
            leave: leaveData,
            lastLeaveEndDate: lastLeave
        });

    } catch (error) {
        console.error("API Error fetching leave details:", error);
        res.status(500).json({ message: 'Server error' });
    }
});


// GET /leave/approve/:id - Approves a leave request
app.get('/leave/approve/:id', checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    // Get the page the user came from (e.g., /cc-dashboard)
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const referer = req.get('Referer') || '/';
    const refererUrl = new URL(referer, baseUrl);

    try {
        const { id } = req.params;
        const approverId = req.session.user.id;

        // Run the UPDATE query. The trigger will handle leave balance.
        await pool.execute(
            'UPDATE Leave_Records SET `status` = ?, approved_by_id = ? WHERE leave_id = ? AND `status` = ?',
            ['Approved', approverId, id, 'Pending']
        );
        
        // Add a success message to the URL
        refererUrl.searchParams.set('success', 'Leave approved!');
        res.redirect(refererUrl.pathname + refererUrl.search);

    } catch (error) {
        console.error("Error approving leave:", error);
        refererUrl.searchParams.set('error', 'Error approving leave.');
        res.redirect(refererUrl.pathname + refererUrl.search);
    }
});

app.get('/leave/reject/:id', checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const referer = req.get('Referer') || '/';
    const refererUrl = new URL(referer, baseUrl);

    try {
        const { id } = req.params;
        const approverId = req.session.user.id;

        // Run the UPDATE query to mark as 'Rejected'
        await pool.execute(
            'UPDATE Leave_Records SET `status` = ?, approved_by_id = ? WHERE leave_id = ? AND `status` = ?',
            ['Rejected', approverId, id, 'Pending']
        );
        
        // Add a success message to the URL
        refererUrl.searchParams.set('success', 'Leave rejected.');
        res.redirect(refererUrl.pathname + refererUrl.search);

    } catch (error) {
        console.error("Error rejecting leave:", error);
        refererUrl.searchParams.set('error', 'Error rejecting leave.');
        res.redirect(refererUrl.pathname + refererUrl.search);
    }
});

app.get('/api/report/roll-call', checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const { company_id } = req.query; // Get the company ID from the dropdown

        let sql = 'SELECT * FROM view_RollCallReport';
        let params = [];

        // If a specific company is selected (and not 'all'), add a WHERE clause
        if (company_id && company_id !== 'all') {
            sql += ' WHERE company_id = ?';
            params.push(company_id);
        }
        
        sql += ' ORDER BY company_name, \`rank\`, name';
        
        const [rows] = await pool.execute(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Roll Call API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// Adjutant Dashboard Route
app.get("/adjutant", checkAuth, checkRole(['Adjutant', 'CO',]), setNoCache, async function(req, res) {
    
    try {
        // Fetch all the data the Adjutant needs
        const [personnelList] = await pool.query(
            'SELECT soldier_id, name, `rank`, company_name FROM view_SoldierPersonalDashboard'
        );

        const [allLeaves] = await pool.query(
            'SELECT * FROM view_AllLeaveRecords ORDER BY start_date DESC'
        );
        
        const [pendingLeaves] = await pool.query(
            'SELECT * FROM view_AllPendingLeaveRequests'
        );

        const [personnelStats] = await pool.query(
            'SELECT SUM(total_strength) AS total_strength FROM view_BattalionPersonnelOverview'
        );
        
        const [soldiersOnLeave] = await pool.query(
            "SELECT COUNT(*) AS on_leave_count FROM Leave_Records WHERE `status` = 'Approved' AND CURDATE() BETWEEN start_date AND end_date"
        );

        const [companyList] = await pool.query(
            'SELECT company_id, company_name FROM Companies'
        );

        // Render the page, passing in all the fetched data
        res.render("adjutant", {
            user: req.session.user,
            personnel: personnelList,
            leaves: pendingLeaves,
            allLeaveRecords: allLeaves,
            companies: companyList,
            stats: {
                totalStrength: personnelStats[0].total_strength,
                onLeave: soldiersOnLeave[0].on_leave_count,
                pendingLeaves: pendingLeaves.length
            },
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("Adjutant dashboard error:", error);
        res.status(500).send("Server Error");
    }
});



// POST /personnel/add - Handles the "Add Soldier" form
app.post('/personnel/add', checkAuth, checkRole(['Adjutant', 'CO']), async (req, res) => {
    const { name, rank, dob, contact, company_id, username, password } = req.body;
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the saltRounds
    
    try {
        // Use the stored procedure you already created
        await pool.execute(
            'CALL sp_RegisterNewSoldier(?, ?, ?, ?, ?, ?, ?)',
            [name, rank, dob, contact, company_id, username, hashedPassword]
        );
        res.redirect('/adjutant?success=Soldier added successfully!');
    } catch (error) {
        console.error("Error adding soldier:", error);
        res.redirect('/adjutant?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// POST /personnel/update/:id - Handles the "Update Soldier" form
app.post('/personnel/update/:id', checkAuth, checkRole(['Adjutant', 'CO']), async (req, res) => {
    const { name, rank, contact, company_id } = req.body;
    const { id } = req.params;

    try {
        await pool.execute(
            'UPDATE Soldiers SET name = ?, `rank` = ?, contact = ?, company_id = ? WHERE soldier_id = ?',
            [name, rank, contact, company_id, id]
        );
        // On success, redirect to the adjutant page with a success message
        res.redirect('/adjutant?success=Record updated successfully!');
    } catch (error) {
        console.error("Error updating soldier:", error);
        
        // FIX: On failure, redirect back to the adjutant page with the error
        res.redirect('/adjutant?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});













































// MTO Dashboard Route
app.get("/mto", checkAuth, setNoCache, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    
    try {
        // Fetch all data the MTO needs
        const [vehicles] = await pool.query('SELECT * FROM view_MTO_Dashboard');
        
        const [fuelStock] = await pool.query('SELECT * FROM Fuel_Lubricants');
        
        const [alerts] = await pool.query(
            "SELECT * FROM view_ActiveAlerts WHERE related_entity_type = 'Military_Transport' OR related_entity_type = 'Fuel_Lubricants'"
        );

        // Fetch drivers (Soldiers from HQ company)
        const [drivers] = await pool.query(
            "SELECT s.soldier_id, s.name, s.`rank` FROM Soldiers s JOIN Companies c ON s.company_id = c.company_id WHERE c.company_name = 'Headquarter Company' AND s.`status` = 'Active'"
        );

        // Calculate overview stats
        const stats = {
            totalVehicles: vehicles.length,
            operational: vehicles.filter(v => v.status === 'Operational').length,
            inRepair: vehicles.filter(v => v.status ==='In-Repair').length
        };

        const [fuelLogs] = await pool.query(`
            SELECT 
                fl.log_id,
                DATE_FORMAT(fl.date_drawn, '%d-%m-%Y %H:%i') AS log_date,
                mt.vehicle_number,
                f.fuel_type,
                fl.quantity_drawn,
                fl.odometer_reading
            FROM MT_Fuel_Log fl
            JOIN Military_Transport mt ON fl.mt_id = mt.mt_id
            JOIN Fuel_Lubricants f ON fl.fuel_id = f.fuel_id
            ORDER BY fl.date_drawn DESC
            LIMIT 15
        `);
        
        res.render("mto", {
            user: req.session.user,
            vehicles: vehicles,
            fuelStock: fuelStock,
            alerts: alerts,
            drivers: drivers,
            stats: stats,
            fuelLogs: fuelLogs,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("MTO dashboard error:", error);
        res.status(500).send("Server Error");
    }
});



// API route to search vehicles by vehicle number, model, or driver name
app.get('/api/search-vehicles', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const context = req.query.context; // This is our new filter
        const searchPattern = `%${searchTerm}%`;

        // Start with the base query
        let sql = `SELECT * FROM view_MTO_Dashboard 
                   WHERE (vehicle_number LIKE ? OR model LIKE ? OR driver_name LIKE ?)`;
        let params = [searchPattern, searchPattern, searchPattern];

        // If the "Maintenance" section is calling, add its specific filter
        if (context === 'maintenance') {
            sql += ' AND next_maintenance_date IS NOT NULL';
        }

        const [rows] = await pool.execute(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Search Vehicles API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});
// API route to get data for a single vehicle (for the modals)
app.get('/api/vehicle/:id', checkAuth, checkRole(['MTO', 'MT_JCO', 'QM', 'CO']), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute(
            'SELECT *, DATE_FORMAT(last_maintenance, "%Y-%m-%d") AS html_last_maint, DATE_FORMAT(next_maintenance, "%Y-%m-%d") AS html_next_maint FROM Military_Transport WHERE mt_id = ?',
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("API Error fetching vehicle:", error);
        res.status(500).json({ message: 'Server error' });
    }
});


app.get('/api/search-fuel-logs', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;

        const [rows] = await pool.query(
            `SELECT 
                fl.log_id,
                DATE_FORMAT(fl.date_drawn, '%d-%m-%Y %H:%i') AS log_date,
                mt.vehicle_number,
                f.fuel_type,
                fl.quantity_drawn,
                fl.odometer_reading
            FROM MT_Fuel_Log fl
            JOIN Military_Transport mt ON fl.mt_id = mt.mt_id
            JOIN Fuel_Lubricants f ON fl.fuel_id = f.fuel_id
            WHERE 
                (mt.vehicle_number LIKE ? OR 
                 f.fuel_type LIKE ? OR 
                 fl.odometer_reading LIKE ?)
            ORDER BY fl.date_drawn DESC
            LIMIT 50`,
            [searchPattern, searchPattern, searchPattern]
        );
        
        res.json(rows);

    } catch (error) {
        console.error("Search Fuel Log API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /mto/delete-fuel-log/:id - Reverses a fuel log transaction
app.get('/mto/delete-fuel-log/:id', checkAuth, checkRole(['MTO', 'CO']), async (req, res) => {
    const { id } = req.params;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get the log entry we are about to delete
        const [logRows] = await connection.execute(
            'SELECT * FROM MT_Fuel_Log WHERE log_id = ? FOR UPDATE',
            [id]
        );

        if (logRows.length === 0) {
            await connection.rollback();
            return res.redirect('/mto?error=Log entry not found.');
        }

        const log = logRows[0];
        const qtyToReturn = log.quantity_drawn;
        const vehicleId = log.mt_id;

        // 2. Add the fuel quantity back to the main Fuel_Lubricants stock
        await connection.execute(
            'UPDATE Fuel_Lubricants SET quantity_liters = quantity_liters + ? WHERE fuel_id = ?',
            [qtyToReturn, log.fuel_id]
        );

        // 3. Delete the log entry
        await connection.execute(
            'DELETE FROM MT_Fuel_Log WHERE log_id = ?',
            [id]
        );

        // 4. (CRITICAL) We must also fix the vehicle's master odometer reading.
        // Find the *new* latest log entry for this vehicle.
        const [latestLogs] = await connection.execute(
            'SELECT odometer_reading FROM MT_Fuel_Log WHERE mt_id = ? ORDER BY date_drawn DESC LIMIT 1',
            [vehicleId]
        );

        let newOdometer = 0; // Default to 0 if no logs are left
        if (latestLogs.length > 0) {
            newOdometer = latestLogs[0].odometer_reading;
        }

        // 5. Update the Military_Transport table with the correct (previous) odometer reading
        await connection.execute(
            'UPDATE Military_Transport SET odometer_reading = ? WHERE mt_id = ?',
            [newOdometer, vehicleId]
        );

        // 6. If all steps succeed, commit the changes
        await connection.commit();
        res.redirect('/mto?success=Fuel log successfully reversed!');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error reversing fuel log:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    } finally {
        if (connection) connection.release();
    }
});




// API route to get data for a single vehicle
app.post('/mto/update-maintenance/:id', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    const { id } = req.params;
    // 1. Get the new 'status' field from the form
    const { last_maintenance, next_maintenance, odometer_reading, status } = req.body;

    try {
        // 2. Add the `status` = ? to the SQL query
        await pool.execute(
            'UPDATE Military_Transport SET last_maintenance = ?, next_maintenance = ?, odometer_reading = ?, `status` = ? WHERE mt_id = ?',
            [last_maintenance || null, next_maintenance || null, odometer_reading, status, id]
        );
        res.redirect('/mto?success=Vehicle condition updated successfully!');
    } catch (error) {
        console.error("Error updating maintenance:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});


// POST /mto/log-fuel - Logs fuel drawn for a vehicle
app.post('/mto/log-fuel', checkAuth, checkRole(['MTO', 'MT_JCO', 'Fuel_NCO', 'CO']), async (req, res) => {
    const { mt_id, fuel_id, quantity_drawn, odometer_reading } = req.body;
    const qty = parseFloat(quantity_drawn);
    const odometer = parseInt(odometer_reading, 10) || 0;

    if (qty <= 0) {
        return res.redirect('/mto?error=Quantity must be greater than zero.');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get current vehicle and fuel data
        const [fuelRows] = await connection.execute('SELECT quantity_liters FROM Fuel_Lubricants WHERE fuel_id = ? FOR UPDATE', [fuel_id]);
        const [vehicleRows] = await connection.execute('SELECT odometer_reading FROM Military_Transport WHERE mt_id = ? FOR UPDATE', [mt_id]);

        // 2. Check for sufficient fuel
        if (fuelRows.length === 0 || fuelRows[0].quantity_liters < qty) {
            await connection.rollback();
            return res.redirect('/mto?error=Not enough fuel in stock.');
        }

        // 3. Check if new odometer reading is valid
        if (odometer > 0 && odometer < vehicleRows[0].odometer_reading) {
            await connection.rollback();
            return res.redirect('/mto?error=Odometer reading must be higher than the previous one.');
        }

        // 4. Subtract from the main fuel stock
        await connection.execute(
            'UPDATE Fuel_Lubricants SET quantity_liters = quantity_liters - ? WHERE fuel_id = ?',
            [qty, fuel_id]
        );

        // 5. Log the transaction in MT_Fuel_Log
        await connection.execute(
            'INSERT INTO MT_Fuel_Log (mt_id, fuel_id, quantity_drawn, odometer_reading) VALUES (?, ?, ?, ?)',
            [mt_id, fuel_id, qty, odometer]
        );
        
        // 6. --- NEW STEP ---
        // Update the vehicle's master odometer reading
        if (odometer > 0) {
            await connection.execute(
                'UPDATE Military_Transport SET odometer_reading = ? WHERE mt_id = ?',
                [odometer, mt_id]
            );
        }

        await connection.commit();
        res.redirect('/mto?success=Fuel log added successfully!');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error logging fuel:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    } finally {
        if (connection) connection.release();
    }
});

app.get('/api/mto-report', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    try {
        const { type } = req.query; // Get the report type from the dropdown

        if (type === 'vehicle_status') {
            // Logic for Vehicle Status Report
            const [reportData] = await pool.query(
                'SELECT * FROM view_MTO_Dashboard ORDER BY `status`, vehicle_number'
            );
            res.json({ reportType: 'vehicle_status', data: reportData });

        } else if (type === 'fuel_log') {
            // Logic for Fuel Log Report
            const [reportData] = await pool.query(`
                SELECT 
                    DATE_FORMAT(fl.date_drawn, '%d-%m-%Y %H:%i') AS log_date,
                    mt.vehicle_number, mt.model,
                    f.fuel_type, fl.quantity_drawn, fl.odometer_reading
                FROM MT_Fuel_Log fl
                JOIN Military_Transport mt ON fl.mt_id = mt.mt_id
                JOIN Fuel_Lubricants f ON fl.fuel_id = f.fuel_id
                ORDER BY fl.date_drawn DESC
            `);
            res.json({ reportType: 'fuel_log', data: reportData });

        } else {
            res.status(400).json({ message: 'Invalid report type' });
        }
    } catch (error) {
        console.error("MTO Report API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});
// POST /mto/assign-driver/:id - Specific route for assigning/unassigning drivers
app.post('/mto/assign-driver/:id', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { driver_id } = req.body; // This form only sends driver_id

    try {
        // Only update the driver_id column
        await pool.execute(
            'UPDATE Military_Transport SET driver_id = ? WHERE mt_id = ?',
            [driver_id || null, id] // Handle empty string as NULL
        );
        
        // Redirect back to the MTO dashboard
        res.redirect('/mto?success=Driver assignment updated successfully!');

    } catch (error) {
        console.error("Error assigning driver:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.sqlMessage || 'Server Error'));
    }
});













































// QM Dashboard Route

app.get("/qm", checkAuth, setNoCache, checkRole(['QM', 'CO']), async function(req, res) {
    try {
        // Fetch all the data the QM needs
        const [weapons] = await pool.query(
            'SELECT asset_id, serial_number, model, `status`, assigned_to FROM view_QMMasterLogisticsLedger WHERE asset_category = "Weapon"'
        );
        
        const [ammo] = await pool.query(
            "SELECT ammo_id,ammo_type, quantity, lot_number, DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f FROM Ammunition"
        );
        
        const [vehicles] = await pool.query(
            'SELECT * FROM view_MTO_Dashboard'
        );

        const [alerts] = await pool.query(
            "SELECT * FROM view_ActiveAlerts WHERE alert_type IN ('Low Stock', 'Expiry','Maintenance Due')"
        );

        const [companies] = await pool.query(
            "SELECT * FROM Companies"
        );
        
        const [fuel] = await pool.query(
            "SELECT fuel_id,fuel_type, quantity_liters, low_stock_threshold FROM Fuel_Lubricants"
        );
        
        // --- RATION LOGIC ---
        const [battalionRations] = await pool.query(
            "SELECT *, DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f FROM BattalionStock"
        );
        const [companyRations] = await pool.query(
            "SELECT r.ration_id, r.item_name, r.lot_number, c.company_name, r.quantity_kg, r.assigned_company_id, DATE_FORMAT(r.expiry_date, '%d-%m-%Y') AS expiry_date_f FROM Rations r JOIN Companies c ON r.assigned_company_id = c.company_id"
        );

        const [rationLogs] = await pool.query(`
        SELECT 
            DATE_FORMAT(rl.transaction_date, '%d-%m-%Y %H:%i') AS date_f,
            r.item_name,
            r.lot_number,
            c.company_name,
            rl.quantity_change,
            rl.transaction_type
        FROM Ration_Log rl
        JOIN Rations r ON rl.ration_id = r.ration_id
        JOIN Companies c ON rl.company_id = c.company_id
        WHERE rl.transaction_type IN ('Received_from_QM', 'Returned_to_QM')
        ORDER BY rl.transaction_date DESC
        LIMIT 20
    `);
        res.render("qm", {
            user: req.session.user,
            weapons: weapons,
            ammunition: ammo,
            battalionRations: battalionRations,
            companyRations: companyRations,
            rationLogs: rationLogs,
            fuel: fuel,
            vehicles: vehicles,
            alerts: alerts,
            companies: companies,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("QM dashboard error:", error);
        res.status(500).send("Server Error");
    }
});


// POST /qm/add-weapon - Adds a new weapon to the armory
app.post('/qm/add-weapon', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    
    // 1. Get all data from the form body
    const { serial_number, type, model, assigned_company_id } = req.body;

    // 2. Simple validation
    if (!serial_number || !type || !model || !assigned_company_id) {
        return res.redirect('/qm?error=All fields are required.');
    }

    try {
        // 3. Create the SQL query (note the backticks on `type`)
        const sql = 'INSERT INTO Weapons (serial_number, `type`, model, assigned_company_id) VALUES (?, ?, ?, ?)';
        
        // 4. Execute the query
        await pool.execute(sql, [serial_number, type, model, assigned_company_id]);

        // 5. Redirect on success
        res.redirect('/qm?success=Weapon added successfully!');

    } catch (error) {
        console.error("Error adding weapon:", error);
        
        // Handle a duplicate serial number error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.redirect('/qm?error=A weapon with that serial number already exists.');
        }
        
        // Handle other errors
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});



// API route to get data for a single weapon
app.get('/api/weapon/:id', checkAuth, checkRole(['QM', 'CO','Company_Weapon_Incharge']), async (req, res) => {
    try {
        const { id } = req.params;
        // Fetch weapon data, formatting dates for the HTML form
        const [rows] = await pool.execute(
            'SELECT *, DATE_FORMAT(last_maintenance, "%Y-%m-%d") AS html_last_maint, DATE_FORMAT(next_maintenance, "%Y-%m-%d") AS html_next_maint FROM Weapons WHERE weapon_id = ?', 
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Weapon not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("API Error fetching weapon:", error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST route to update a weapon's details
app.post('/qm/update-weapon/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;
    // Get all the data from the edit form
    const { serial_number, type, model, assigned_company_id, status } = req.body;

    try {
        await pool.execute(
            'UPDATE Weapons SET serial_number = ?, `type` = ?, model = ?, assigned_company_id = ?, `status` = ?, last_maintenance = ?, next_maintenance = ? WHERE weapon_id = ?',
            [serial_number, type, model, assigned_company_id, status,null,null, id]
        );
        res.redirect('/qm?success=Weapon updated successfully!');
    } catch (error) {
        console.error("Error updating weapon:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// GET route to delete a weapon
app.get('/qm/delete-weapon/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;

    try {
        // Safety Check 1: Is the weapon formally assigned to a soldier?
        const [assignmentRows] = await pool.execute('SELECT COUNT(*) AS count FROM Soldier_Weapon_Assignments WHERE weapon_id = ?', [id]);
        if (assignmentRows[0].count > 0) {
            return res.redirect('/qm?error=Cannot delete. Weapon is formally assigned. Un-assign it first.');
        }

        // Safety Check 2: Is the weapon currently issued to someone?
        const [weaponRows] = await pool.execute('SELECT `status` FROM Weapons WHERE weapon_id = ?', [id]);
        if (weaponRows.length > 0 && weaponRows[0].status === 'Issued') {
             return res.redirect('/qm?error=Cannot delete. Weapon is currently issued to a soldier.');
        }

        // If safe, proceed with deletion
        await pool.execute('DELETE FROM Weapons WHERE weapon_id = ?', [id]);
        res.redirect('/qm?success=Weapon removed from armory.');

    } catch (error) {
        console.error("Error deleting weapon:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});


// POST /qm/add-ammo - Adds new ammunition stock
app.post('/qm/add-ammo', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    
    // 1. Get all data from the (now corrected) form
    const { ammo_type, quantity, lot_number, expiry_date, low_stock_threshold } = req.body;

    // 2. Validation
    if (!ammo_type || !quantity || !lot_number || !expiry_date) {
        return res.redirect('/qm?error=All fields are required.');
    }

    try {
        // 3. Check if this exact ammo type and lot already exists
        const [existing] = await pool.execute(
            'SELECT * FROM Ammunition WHERE ammo_type = ? AND lot_number = ?',
            [ammo_type, lot_number]
        );

        if (existing.length > 0) {
            // 4a. If it exists, just ADD to the quantity
            await pool.execute(
                'UPDATE Ammunition SET quantity = quantity + ? WHERE ammo_id = ?',
                [quantity, existing[0].ammo_id]
            );
        } else {
            // 4b. If it's a new item/lot, INSERT a new row
            await pool.execute(
                'INSERT INTO Ammunition (ammo_type, quantity, lot_number, expiry_date, low_stock_threshold) VALUES (?, ?, ?, ?, ?)',
                [ammo_type, quantity, lot_number, expiry_date, low_stock_threshold]
            );
        }

        // 5. Redirect on success
        res.redirect('/qm?success=Ammunition stock added successfully!');

    } catch (error) {
        console.error("Error adding ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// API route to get data for a single ammo batch
app.get('/api/ammo/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { id } = req.params;
        // Fetch ammo data, formatting date for the HTML form
        const [rows] = await pool.execute(
            'SELECT *, DATE_FORMAT(expiry_date, "%Y-%m-%d") AS html_expiry_date FROM Ammunition WHERE ammo_id = ?',
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Ammunition not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("API Error fetching ammo:", error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST route to update an ammo batch's details
app.post('/qm/update-ammo/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { ammo_type, quantity, lot_number, expiry_date, low_stock_threshold } = req.body;

    try {
        await pool.execute(
            'UPDATE Ammunition SET ammo_type = ?, quantity = ?, lot_number = ?, expiry_date = ?, low_stock_threshold = ? WHERE ammo_id = ?',
            [ammo_type, quantity, lot_number, expiry_date, low_stock_threshold, id]
        );
        res.redirect('/qm?success=Ammunition updated successfully!');
    } catch (error) {
        console.error("Error updating ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// GET route to delete an ammo batch
app.get('/qm/delete-ammo/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;

    try {
        // SAFETY CHECK: Only allow deleting an item if its quantity is 0
        const [ammoRows] = await pool.execute('SELECT quantity FROM Ammunition WHERE ammo_id = ?', [id]);
        
        if (ammoRows.length > 0 && ammoRows[0].quantity > 0) {
            return res.redirect('/qm?error=Cannot delete. Stock is not empty (quantity is ' + ammoRows[0].quantity + '). Update quantity to 0 first.');
        }

        // If safe, proceed with deletion
        await pool.execute('DELETE FROM Ammunition WHERE ammo_id = ?', [id]);
        res.redirect('/qm?success=Ammunition batch removed from armory.');

    } catch (error) {
        console.error("Error deleting ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});



// POST /qm/add-stock - Adds new stock to the BattalionStock table
app.post('/qm/add-stock', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    // 1. Get lot_number from the form
    const { item_name, lot_number, quantity, expiry_date, low_stock_threshold } = req.body;

    try {
        // 2. The query now uses lot_number
        await pool.execute(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date, low_stock_threshold)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                quantity_kg = quantity_kg + VALUES(quantity_kg),
                expiry_date = VALUES(expiry_date),
                low_stock_threshold = VALUES(low_stock_threshold)`,
            [item_name, lot_number, quantity, expiry_date, low_stock_threshold]
        );
        res.redirect('/qm?success=Battalion stock added/updated successfully!');
    } catch (error) {
        console.error("Error adding stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// UPDATED: POST /qm/distribute-rations
app.post('/qm/distribute-rations', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { stock_id, company_id, quantity } = req.body;
    const qtyToMove = parseFloat(quantity);
    const userId = req.session.user.id; // Get the QM's ID for the log

    if (qtyToMove <= 0) {
        return res.redirect('/qm?error=Quantity must be greater than zero.');
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Check Battalion Stock
        const [stockRows] = await connection.execute(
            'SELECT * FROM BattalionStock WHERE stock_id = ? FOR UPDATE',
            [stock_id]
        );
        
        const item = stockRows[0];
        if (!item || item.quantity_kg < qtyToMove) {
            await connection.rollback();
            return res.redirect('/qm?error=Not enough stock in that batch.');
        }

        // 2. Subtract from Battalion Stock
        await connection.execute(
            'UPDATE BattalionStock SET quantity_kg = quantity_kg - ? WHERE stock_id = ?',
            [qtyToMove, stock_id]
        );

        // 3. Add to Company Stock (Rations table)
        await connection.execute(
            `INSERT INTO Rations (item_name, lot_number, expiry_date, assigned_company_id, quantity_kg)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity_kg = quantity_kg + VALUES(quantity_kg)`,
            [item.item_name, item.lot_number, item.expiry_date, company_id, qtyToMove]
        );

        // 4. --- NEW STEP: LOG THE TRANSACTION ---
        // First, retrieve the ration_id for the company's stock we just updated/inserted
        const [rationRows] = await connection.execute(
            'SELECT ration_id FROM Rations WHERE item_name = ? AND lot_number = ? AND assigned_company_id = ?',
            [item.item_name, item.lot_number, company_id]
        );
        const rationId = rationRows[0].ration_id;

        // Insert into Ration_Log
        await connection.execute(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES (?, ?, 'Received_from_QM', ?, ?, ?)`,
            [rationId, company_id, qtyToMove, userId, 'Distributed from Battalion Store']
        );

        await connection.commit();
        res.redirect('/qm?success=Rations distributed and logged successfully!');
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error distributing rations:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    } finally {
        if (connection) connection.release();
    }
});


// Update stock information
app.post('/qm/update-stock/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    // 1. Get the ID from the URL params
    const { stock_id } = req.params;
    
    // 2. Get the form data from the body
    const { expiry_date, low_stock_threshold, quantity_kg } = req.body;

    try {
        // 3. Update the database using the stock_id
        await pool.execute(
            'UPDATE BattalionStock SET expiry_date = ?, low_stock_threshold = ?, quantity_kg = ? WHERE stock_id = ?',
            [expiry_date, low_stock_threshold, quantity_kg, stock_id]
        );
        res.redirect('/qm?success=Battalion stock item updated!');
    } catch (error) {
        console.error("Error updating stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});


// This route completely deletes a stock item
app.get('/qm/delete-stock/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { stock_id } = req.params;

    try {
        // 1. Get the item details *before* deleting
        const [stockRows] = await pool.execute('SELECT * FROM BattalionStock WHERE stock_id = ?', [stock_id]);
        if (stockRows.length === 0) {
            return res.redirect('/qm?error=Item not found.');
        }
        const item = stockRows[0];

        // 2. SAFETY CHECK: See if this *specific lot* is in any company's stock
        const [companyRows] = await pool.execute(
            'SELECT COUNT(*) AS count FROM Rations WHERE item_name = ? AND lot_number = ?',
            [item.item_name, item.lot_number]
        );

        if (companyRows[0].count > 0) {
            return res.redirect('/qm?error=Cannot delete. This batch is still in use by a company. Revert all company stock first.');
        }

        // 3. If safe, proceed with deletion
        await pool.execute(
            'DELETE FROM BattalionStock WHERE stock_id = ?',
            [stock_id]
        );
        
        res.redirect('/qm?success=Stock item completely removed from battalion store.');

    } catch (error) {
        console.error("Error deleting stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

//  GET /qm/revert-stock - Returns stock from a Company back to the QM
app.get('/qm/revert-stock/:ration_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { ration_id } = req.params;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Find the exact company stock row by its unique ID
        const [companyRows] = await connection.execute(
            'SELECT * FROM Rations WHERE ration_id = ? FOR UPDATE',
            [ration_id]
        );
        
        if (companyRows.length === 0 || companyRows[0].quantity_kg <= 0) {
            await connection.rollback();
            return res.redirect('/qm?error=No stock to revert.');
        }
        
        const item = companyRows[0];
        const qtyToRevert = item.quantity_kg;

        // 2. Add that stock back to the correct batch in BattalionStock
        await connection.execute(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity_kg = quantity_kg + VALUES(quantity_kg)`,
            [item.item_name, item.lot_number, qtyToRevert, item.expiry_date]
        );

        // 3. Delete the specific row from the company's Rations table
        await connection.execute(
            'DELETE FROM Rations WHERE ration_id = ?',
            [ration_id]
        );

        await connection.commit();
        res.redirect('/qm?success=Stock successfully reverted to battalion store!');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error reverting stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    } finally {
        if (connection) connection.release();
    }
});

//  API route to get data for the "Edit Stock" modal
app.get('/api/stock-item/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { stock_id } = req.params; // Get stock_id from the URL
        const [rows] = await pool.execute(
            'SELECT *, DATE_FORMAT(expiry_date, "%Y-%m-%d") AS html_expiry_date FROM BattalionStock WHERE stock_id = ?', 
            [stock_id] // Use stock_id in the query
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Stock item not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("API Error fetching stock item:", error);
        res.status(500).json({ message: 'Server error' });
    }
});




// POST /qm/add-fuel - Adds a new fuel type or updates its quantity
app.post('/qm/add-fuel', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    // 1. Get data from the 'Add' form
    const { fuel_type, quantity, low_stock_threshold } = req.body;

    try {
        // 2. Use INSERT...ON DUPLICATE KEY to add stock
        // This will create 'Petrol' if it doesn't exist,
        // or add the quantity to it if it does.
        await pool.execute(
            `INSERT INTO Fuel_Lubricants (fuel_type, quantity_liters, low_stock_threshold)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                quantity_liters = quantity_liters + VALUES(quantity_liters),
                low_stock_threshold = VALUES(low_stock_threshold)`,
            [fuel_type, quantity, low_stock_threshold]
        );
        res.redirect('/qm?success=Fuel stock added/updated successfully!');
    } catch (error) {
        console.error("Error adding fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// POST /qm/update-fuel/:fuel_id - Updates a specific fuel item
app.post('/qm/update-fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { fuel_id } = req.params;
    const { fuel_type, quantity_liters, low_stock_threshold } = req.body;

    try {
        await pool.execute(
            'UPDATE Fuel_Lubricants SET fuel_type = ?, quantity_liters = ?, low_stock_threshold = ? WHERE fuel_id = ?',
            [fuel_type, quantity_liters, low_stock_threshold, fuel_id]
        );
        res.redirect('/qm?success=Fuel item updated successfully!');
    } catch (error) {
        console.error("Error updating fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// GET /qm/delete-fuel/:fuel_id - Deletes a fuel type
app.get('/qm/delete-fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { fuel_id } = req.params;

    try {
        // Safety check: Don't delete if there's still stock
        const [rows] = await pool.execute('SELECT quantity_liters FROM Fuel_Lubricants WHERE fuel_id = ?', [fuel_id]);
        if (rows.length > 0 && rows[0].quantity_liters > 0) {
            return res.redirect(`/qm?error=Cannot delete. Quantity is not 0. Update quantity first.`);
        }
        
        await pool.execute('DELETE FROM Fuel_Lubricants WHERE fuel_id = ?', [fuel_id]);
        res.redirect('/qm?success=Fuel type removed successfully.');

    } catch (error) {
        console.error("Error deleting fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// API route to get data for a single fuel item
app.get('/api/fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { fuel_id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM Fuel_Lubricants WHERE fuel_id = ?', [fuel_id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Fuel type not found' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error("API Error fetching fuel:", error);
        res.status(500).json({ message: 'Server error' });
    }
});




// POST /qm/add-vehicle - Adds a new vehicle
app.post('/qm/add-vehicle', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    // 1. Get data from the 'Add' form
    const { vehicle_number, type, model, assigned_company_id, last_maintenance, next_maintenance } = req.body;

    try {
        await pool.execute(
            `INSERT INTO Military_Transport (vehicle_number, \`type\`, model, last_maintenance, next_maintenance, \`status\`)
             VALUES (?, ?, ?, ?, ?, 'Operational')`,
            [vehicle_number, type, model, last_maintenance || null, next_maintenance || null]
        );
        res.redirect('/qm?success=Vehicle added successfully!');
    } catch (error) {
        console.error("Error adding vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// GET /api/vehicle/:id - API route to get data for a single vehicle
// defined above in the MTO section

// POST /qm/update-vehicle/:id - Updates a specific vehicle
app.post('/qm/update-vehicle/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { vehicle_number, type, model, driver_id, status, last_maintenance, next_maintenance } = req.body;

    try {
        await pool.execute(
            'UPDATE Military_Transport SET vehicle_number = ?, `type` = ?, model = ?, driver_id = ?, `status` = ?, last_maintenance = ?, next_maintenance = ? WHERE mt_id = ?',
            [vehicle_number, type, model, driver_id || null, status, last_maintenance || null, next_maintenance || null, id]
        );
        res.redirect('/qm?success=Vehicle updated successfully!');
    } catch (error) {
        console.error("Error updating vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});

// GET /qm/decommission-vehicle/:id - Decommissions a vehicle
app.get('/qm/decommission-vehicle/:id', checkAuth, checkRole(['QM', 'CO', 'MTO']), async (req, res) => {
    const { id } = req.params;

    try {
        // Safety check: Don't decommission if it's on duty
        const [rows] = await pool.execute('SELECT `status` FROM Military_Transport WHERE mt_id = ?', [id]);
        if (rows.length > 0 && rows[0].status === 'On-Duty') {
            return res.redirect(`/qm?error=Cannot decommission. Vehicle is currently 'On-Duty'.`);
        }
        
        // We'll set the status to 'In-Repair' as a "decommissioned" state.
        // A hard delete is dangerous because of log files.
        await pool.execute(
            'UPDATE Military_Transport SET `status` = ?, driver_id = NULL WHERE mt_id = ?',
            ['In-Repair', id]
        );
        res.redirect('/qm?success=Vehicle set to In-Repair and unassigned from driver.');

    } catch (error) {
        console.error("Error decommissioning vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.sqlMessage || 'A server error occurred.'));
    }
});



// GET /api/qm-report - Generates QM reports based on type
app.get('/api/qm-report', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { type } = req.query; // Get the report type from the dropdown

    try {
        if (type === 'stock') {
            // Logic for Full Stock Report
            // We'll get data from all the main inventory tables
            const [weapons] = await pool.query('SELECT `type`, model, `status`, serial_number FROM Weapons ORDER BY `type`');
            const [ammo] = await pool.query("SELECT ammo_type, lot_number, quantity, DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f FROM Ammunition ORDER BY ammo_type");
            const [rations] = await pool.query("SELECT item_name, lot_number, quantity_kg, DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f FROM BattalionStock ORDER BY item_name");
            const [fuel] = await pool.query("SELECT fuel_type, quantity_liters FROM Fuel_Lubricants ORDER BY fuel_type");
            
            res.json({ reportType: 'stock', data: { weapons, ammo, rations, fuel } });
        
        } else if (type === 'alerts') {
            // Logic for Active Alerts Report
            const [alerts] = await pool.query(
                "SELECT alert_type, message, alert_date_formatted AS alert_date_f FROM view_ActiveAlerts WHERE alert_type IN ('Low Stock', 'Expiry', 'Maintenance Due') ORDER BY alert_id DESC"
            );
            
            res.json({ reportType: 'alerts', data: alerts });
        
        } 
         else if (type === 'distribution_log') {
            // Logic for Distribution Log Report
            const [logs] = await pool.query(`
                SELECT 
                    DATE_FORMAT(rl.transaction_date, '%d-%m-%Y %H:%i') AS date_f,
                    r.item_name,
                    r.lot_number,
                    c.company_name,
                    rl.quantity_change,
                    rl.transaction_type
                FROM Ration_Log rl
                JOIN Rations r ON rl.ration_id = r.ration_id
                JOIN Companies c ON rl.company_id = c.company_id
                WHERE rl.transaction_type IN ('Received_from_QM', 'Returned_to_QM')
                ORDER BY rl.transaction_date DESC
            `);
            
            res.json({ reportType: 'distribution_log', data: logs });
        // --------------------------        
        }else {
            res.status(400).json({ message: 'Invalid report type' });
        }
    } catch (error) {
        console.error("QM Report API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});




// GET /alert/resolve/:id - Marks an alert as resolved
app.get('/alert/resolve/:id', checkAuth, async (req, res) => {
    // 1. Get the URL the user came from (e.g., "http://localhost:3000/qm")
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const referer = req.get('Referer') || '/';

    // 2. Create a parsable URL object
    const refererUrl = new URL(referer, baseUrl);

    try {
        const { id } = req.params;
        await pool.execute(
            'UPDATE Alerts SET is_resolved = TRUE WHERE alert_id = ?',
            [id]
        );

        // 3. Add the success message to the URL
        refererUrl.searchParams.set('success', 'Alert dismissed successfully!');

        // 4. Redirect to the new URL (e.g., /qm?success=...)
        res.redirect(refererUrl.pathname + refererUrl.search);

    } catch (error) {
        console.error("Error resolving alert:", error);

        // 3. Add the error message to the URL
        refererUrl.searchParams.set('error', 'Could not resolve alert');

        // 4. Redirect to the new URL (e.g., /qm?error=...)
        res.redirect(refererUrl.pathname + refererUrl.search);
    }
});












































// --- COMPANY COMMANDER DASHBOARD ROUTE ---


app.get("/cc-dashboard", checkAuth, checkRole(['CompanyCommander', 'CO']), setNoCache, async (req, res) => {
    
    try {

        

        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }
        // ---------------------

        // 2. Fetch all data *filtered by their company_id*
        const [personnel] = await pool.query(
            "SELECT soldier_id, name, `rank`, `status` FROM Soldiers WHERE company_id = ? AND `status` = 'Active'",
            [companyId]
        );
        const [pendingLeaves] = await pool.query(
            "SELECT * FROM view_AllPendingLeaveRequests WHERE company_id = ?",
            [companyId]
        );
        const [weapons] = await pool.query(
            `SELECT w.weapon_id, w.serial_number, w.\`type\`, s.name AS assigned_to, w.\`status\` 
             FROM Weapons w 
             LEFT JOIN Soldiers s ON w.current_allocatee_id = s.soldier_id 
             WHERE w.assigned_company_id = ?`,
            [companyId]
        );
        const [alerts] = await pool.query(
            `SELECT * FROM view_ActiveAlerts a 
             JOIN Weapons w ON a.related_entity_id = w.weapon_id 
             WHERE a.related_entity_type = 'Weapon' AND w.assigned_company_id = ?`,
            [companyId]
        );
        const [onLeave] = await pool.query(
            "SELECT COUNT(*) AS count FROM Leave_Records lr JOIN Soldiers s ON lr.soldier_id = s.soldier_id WHERE s.company_id = ? AND lr.status = 'Approved' AND CURDATE() BETWEEN lr.start_date AND lr.end_date",
            [companyId]
        );
        const [company] = await pool.query("SELECT company_name FROM Companies WHERE company_id = ?", [companyId]);

        // 3. Create the stats object
        const stats = {
            postedStrength: personnel.length,
            onLeave: onLeave[0].count,
            pendingLeaves: pendingLeaves.length,
            serviceableWeapons: weapons.filter(w => w.status !== 'In-Repair').length,
            totalWeapons: weapons.length
        };

        // 4. Render the page with the filtered data
        res.render("cc-dashboard", { // Make sure your file is named cc-dashboard.ejs
            user: req.session.user,
            viewedCompanyId: companyId,
            companyName: company[0].company_name,
            stats: stats,
            personnel: personnel,
            pendingLeaves: pendingLeaves,
            weapons: weapons,
            alerts: alerts,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("CC Dashboard Error:", error);
        res.status(500).send("Server Error");
    }
});

app.get('/api/cc-search-personnel', checkAuth, checkRole(['CompanyCommander', 'CO']), async (req, res) => {
    try {
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        

        const [rows] = await pool.execute(
    `SELECT soldier_id, name, \`rank\`, \`status\`
     FROM Soldiers 
     WHERE company_id = ? 
     AND \`status\` = 'Active' 
     AND (name LIKE ? OR \`rank\` LIKE ? OR soldier_id = ?)`, // Added soldier_id
    [companyId, searchPattern, searchPattern, searchTerm] // Pass the term for all 3
);
        
        res.json(rows);

    } catch (error) {
        console.error("CC Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// --- ADD THIS NEW API ROUTE for Company Kote Search ---
app.get('/api/cc-search-weapons', checkAuth, checkRole(['CompanyCommander', 'CO','Company_Weapon_Incharge']), async (req, res) => {
    try {

        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        

        const [rows] = await pool.execute(
            `SELECT w.weapon_id, w.serial_number, w.\`type\`, w.model, s.name AS assigned_to, w.\`status\`
             FROM Weapons w
             LEFT JOIN Soldiers s ON w.current_allocatee_id = s.soldier_id
             WHERE w.assigned_company_id = ?
             AND (w.serial_number LIKE ? OR w.\`type\` LIKE ? OR s.name LIKE ? OR w.model LIKE ?)`,
            [companyId, searchPattern, searchPattern, searchPattern, searchPattern]
        );

        res.json(rows);

    } catch (error) {
        console.error("CC Weapon Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});














































// --- RATION INCHARGE DASHBOARD ROUTE ---
app.get("/ration", checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), setNoCache, async (req, res) => {
    try {
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------
        const [company] = await pool.query("SELECT company_name FROM Companies WHERE company_id = ?", [companyId]);
        
        // 1. Get Rations for THIS company
        const [rations] = await pool.query(
            `SELECT ration_id, item_name, quantity_kg, low_stock_threshold,lot_number, 
                    DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f
             FROM Rations 
             WHERE assigned_company_id = ? AND quantity_kg > 0`,
            [companyId]
        );
        
        // 2. Get Alerts for Rations
        const [alerts] = await pool.query(
            `SELECT a.alert_type, a.message, DATE_FORMAT(a.alert_date, '%d-%m-%Y') AS alert_date_f
             FROM Alerts a
             JOIN Rations r ON a.related_entity_id = r.ration_id
             WHERE a.related_entity_type = 'Ration' AND a.is_resolved = FALSE AND r.assigned_company_id = ?`,
            [companyId]
        );

        // 3. Get recent Ration Logs
        const [rationLogs] = await pool.query(
            `SELECT rl.transaction_date, r.item_name, rl.transaction_type, rl.quantity_change, rl.remarks
             FROM Ration_Log rl
             JOIN Rations r ON rl.ration_id = r.ration_id
             WHERE rl.company_id = ?
             ORDER BY rl.transaction_date DESC LIMIT 20`,
            [companyId]
        );

        // 4. Calculate Stats
        const stats = {
            totalStock: rations.reduce((sum, r) => sum + parseFloat(r.quantity_kg), 0).toFixed(1),
            lowStockCount: rations.filter(r => r.quantity_kg < r.low_stock_threshold).length,
            expiringCount: alerts.filter(a => a.alert_type === 'Expiry').length
        };

        res.render("ration", { // Make sure your file is named ration.ejs
            user: req.session.user,
            companyName: company[0].company_name,
            viewedCompanyId: companyId,
            rations: rations,
            alerts: alerts,
            stats: stats,
            rationLogs: rationLogs,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("Ration dashboard error:", error);
        res.status(500).send("Server Error");
    }
});

// POST /ration/consume - Logs consumption OR spoilage
app.post('/ration/consume', checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), async (req, res) => {
    // 1. Get transaction_type from the form
    const { ration_id, quantity, remarks, transaction_type, redirect_company_id } = req.body;
    
    const qtyToConsume = parseFloat(quantity);
    const userId = req.session.user.id;

    // --- Logic to determine Target Company & Redirect URL ---
    let targetCompanyId = req.session.user.company_id;
    let redirectUrl = '/ration';

    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id; // Log this under the target company
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // -------------------------------------------------------


    if (qtyToConsume <= 0) return res.redirect(`${redirectUrl}${separator}error=Quantity must be positive.`);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 2. Check stock
        const [rows] = await connection.execute('SELECT quantity_kg, item_name FROM Rations WHERE ration_id = ? FOR UPDATE', [ration_id]);
        if (rows.length === 0 || rows[0].quantity_kg < qtyToConsume) {
            await connection.rollback();
            return res.redirect(`${redirectUrl}${separator}error=Not enough stock available.`);
        }

        // 3. Subtract the quantity (applies to both Consumption and Spoilage)
        await connection.execute(
            'UPDATE Rations SET quantity_kg = quantity_kg - ? WHERE ration_id = ?',
            [qtyToConsume, ration_id]
        );

        // 4. Log the transaction using the selected TYPE
        await connection.execute(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ration_id, targetCompanyId, transaction_type, -qtyToConsume, userId, remarks || transaction_type]
        );

        await connection.commit();
            res.redirect(`${redirectUrl}${separator}success=Transaction logged successfully!`);
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error consuming rations:", error);
        res.redirect(`${redirectUrl}${separator}error=Server Error`);
    } finally {
        if (connection) connection.release();
    }
});
// POST /ration/revert - Returns stock from Company to Battalion
app.post('/ration/revert', checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), async (req, res) => {
    const { ration_id, quantity, remarks, redirect_company_id } = req.body;
    const qtyToReturn = parseFloat(quantity);
    const userId = req.session.user.id;
    // --- Logic to determine Target Company & Redirect URL ---
    let targetCompanyId = req.session.user.company_id;
    let redirectUrl = '/ration';

    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id; // Log this under the target company
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // -------------------------------------------------------


    if (qtyToReturn <= 0) return res.redirect(`${redirectUrl}${separator}error=Quantity must be positive.`);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Get details of the company ration (we need Lot Number and Name to put it back)
        const [rationRows] = await connection.execute(
            'SELECT * FROM Rations WHERE ration_id = ? FOR UPDATE',
            [ration_id]
        );

        if (rationRows.length === 0 || rationRows[0].quantity_kg < qtyToReturn) {
            await connection.rollback();
                return res.redirect(`${redirectUrl}${separator}error=Not enough stock to return.`);
        }

        const item = rationRows[0];

        // 2. Subtract from Company Stock
        await connection.execute(
            'UPDATE Rations SET quantity_kg = quantity_kg - ? WHERE ration_id = ?',
            [qtyToReturn, ration_id]
        );

        // 3. Add back to Battalion Stock (Match Name AND Lot Number)
        // If the lot still exists in central store, update it. If not, create it.
        await connection.execute(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date, low_stock_threshold)
             VALUES (?, ?, ?, ?, 0) 
             ON DUPLICATE KEY UPDATE quantity_kg = quantity_kg + VALUES(quantity_kg)`,
            [item.item_name, item.lot_number, qtyToReturn, item.expiry_date]
        );

        // 4. Log the transaction
        await connection.execute(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES (?, ?, 'Returned_to_QM', ?, ?, ?)`,
            [ration_id, targetCompanyId, -qtyToReturn, userId, remarks || 'Returned to Battalion Store']
        );

        await connection.commit();
        res.redirect(`${redirectUrl}${separator}success=Stock returned to QM successfully!`);
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error reverting rations:", error);
        res.redirect(`${redirectUrl}${separator}error=Server Error`);
    } finally {
        if (connection) connection.release();
    }
});
// API route for Ration Reports
app.get('/api/ration-report', checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), async (req, res) => {
    try {
        const { type } = req.query;
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        if (type === 'stock') {
            // Report 1: Current Stock Status
            const [rows] = await pool.execute(
                `SELECT item_name, quantity_kg, low_stock_threshold, 
                        DATE_FORMAT(expiry_date, '%d-%m-%Y') AS expiry_date_f 
                 FROM Rations 
                 WHERE assigned_company_id = ? AND quantity_kg > 0
                 ORDER BY item_name`,
                [companyId]
            );
            res.json({ reportType: 'stock', data: rows });

        } else if (type === 'ledger') {
            // Report 2: Transaction History
            const [rows] = await pool.execute(
                `SELECT r.item_name, rl.transaction_type, rl.quantity_change, rl.remarks,
                        DATE_FORMAT(rl.transaction_date, '%d-%m-%Y %H:%i') AS date_f,
                        s.name AS soldier_name
                 FROM Ration_Log rl
                 JOIN Rations r ON rl.ration_id = r.ration_id
                 LEFT JOIN Soldiers s ON rl.performed_by_id = s.soldier_id
                 WHERE rl.company_id = ?
                 ORDER BY rl.transaction_date DESC LIMIT 100`,
                [companyId]
            );
            res.json({ reportType: 'ledger', data: rows });

        } else {
            res.status(400).json({ message: 'Invalid report type' });
        }

    } catch (error) {
        console.error("Ration Report API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});






















































// GET /kote - Renders the dashboard
app.get("/kote", checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), setNoCache, async (req, res) => {
    try {
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const [company] = await pool.query("SELECT company_name FROM Companies WHERE company_id = ?", [companyId]);
        
        // 1. Get all weapons for THIS company
        const [weapons] = await pool.query(
            "SELECT * FROM view_CompanyArmsKote WHERE assigned_company_id = ?",
            [companyId]
        );
        
        // 2. Get the weapon issue log for THIS company
        const [ledger] = await pool.query(
            `SELECT w.serial_number, s.name, 
                    DATE_FORMAT(wil.date_issued, '%d-%m-%Y %H:%i') AS date_issued_f, 
                    DATE_FORMAT(wil.date_returned, '%d-%m-%Y %H:%i') AS date_returned_f
             FROM Weapon_Issue_Log wil
             JOIN Weapons w ON wil.weapon_id = w.weapon_id
             JOIN Soldiers s ON wil.soldier_id = s.soldier_id
             WHERE w.assigned_company_id = ? 
             ORDER BY wil.date_issued DESC LIMIT 50`,
            [companyId]
        );
        
        // 3. Get all soldiers in THIS company
        const [soldiers] = await pool.query(
            "SELECT soldier_id, name, `rank` FROM Soldiers WHERE company_id = ? AND `status` = 'Active'",
            [companyId]
        );

        // 4. Get maintenance alerts for THIS company
        const [alerts] = await pool.query(
            `SELECT a.*, w.serial_number FROM Alerts a
             JOIN Weapons w ON a.related_entity_id = w.weapon_id
             WHERE a.related_entity_type = 'Weapon' AND a.is_resolved = FALSE AND w.assigned_company_id = ?`,
            [companyId]
        );

        // --- 5. NEW QUERY: Get all *formally assigned* weapons ---
        const [assignments] = await pool.query(
            `SELECT swa.weapon_id, w.serial_number, s.name, s.rank
             FROM Soldier_Weapon_Assignments swa
             JOIN Weapons w ON swa.weapon_id = w.weapon_id
             JOIN Soldiers s ON swa.soldier_id = s.soldier_id
             WHERE s.company_id = ?`,
            [companyId]
        );

        // 6. Get available ammunition for THIS company
        const [ammunition] = await pool.query(
            "SELECT * FROM Ammunition WHERE quantity > 0"
        );

        // 7. Get this company's ammo log
        const [ammoLog] = await pool.query(
            `SELECT l.log_id, a.ammo_type, a.lot_number, s.name AS soldier_name, l.quantity_change, 
                    DATE_FORMAT(l.transaction_date, '%d-%m-%Y %H:%i') AS date_f
             FROM Ammunition_Log l
             JOIN Ammunition a ON l.ammo_id = a.ammo_id
             LEFT JOIN Soldiers s ON l.recipient_soldier_id = s.soldier_id
             WHERE l.recipient_company_id = ? AND l.transaction_type IN ('Issued_to_Soldier', 'Returned_from_Soldier')
             ORDER BY l.transaction_date DESC`,
            [companyId]
        );

        res.render("kote", {
            user: req.session.user,
            viewedCompanyId: companyId,
            companyName: company[0].company_name,
            weapons: weapons,
            ledger: ledger,
            soldiers: soldiers,
            alerts: alerts,
            assignments: assignments,
            ammunition: ammunition, 
            ammoLog: ammoLog,
            error: req.query.error || null,
            success: req.query.success || null
        });

    } catch (error) {
        console.error("Kote dashboard error:", error);
        res.status(500).send("Server Error");
    }
});
// POST /kote/allocate - Handles the "Issue Weapon" form
app.post('/kote/allocate', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {

    // 1. Extract redirect_company_id along with other data
    const { weapon_id, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    // 2. Determine the Redirect URL
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        // Call the stored procedure for allocation
        await pool.execute('CALL sp_AllocateWeaponToSoldier(?, ?, ?)', [weapon_id, soldier_id, authorizerId]);
        // 3. Dynamic Redirect (Success)
        res.redirect(`${redirectUrl}${separator}success=Weapon allocated successfully!`);
    } catch (error) {
        console.error("Error allocating weapon:", error);
        // 4. Dynamic Redirect (Error)
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.sqlMessage || error.message)}`);
    }
});

// POST /kote/assign - Handles the "Assign Weapon" form
app.post('/kote/assign', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;
    // --- Redirect Logic ---
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // ----------------------

    try {
        // Call the stored procedure for assignment
        await pool.execute('CALL sp_AssignWeaponToSoldier(?, ?, ?)', [soldier_id, weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon formally assigned successfully!`);
    } catch (error) {
        console.error("Error assigning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.sqlMessage || error.message)}`);
    }
});

// POST /kote/return - Handles the "Return Weapon" form
app.post('/kote/return', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    // --- Redirect Logic ---
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // ----------------------


    try {
        await pool.execute('CALL sp_ReturnWeapon(?, ?)', [weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon returned to kote successfully!`);
    } catch (error) {
        console.error("Error returning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.sqlMessage || error.message)}`);
    }
});

// POST /kote/deassign - Handles the "De-assign Weapon" form
app.post('/kote/deassign', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    // --- Redirect Logic ---
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // ----------------------

    try {
        await pool.execute('CALL sp_DeassignWeapon(?, ?)', [weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon formally de-assigned successfully!`);
    } catch (error) {
        console.error("Error de-assigning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.sqlMessage || error.message)}`);
    }
});

// GET /kote/deassign/:weapon_id - Handles the "De-assign" link
app.get('/kote/deassign/:weapon_id', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------
    
    const { weapon_id } = req.params;

    const authorizerId = req.session.user.id;

    try {
        // This calls the stored procedure you already have
        await pool.execute('CALL sp_DeassignWeapon(?, ?)', [weapon_id, authorizerId]);
        res.redirect('/kote?success=Weapon formally de-assigned successfully!');
    } catch (error) {
        console.error("Error de-assigning weapon:", error);
        res.redirect('/kote?error=' + encodeURIComponent(error.sqlMessage || error.message));
    }
});

// POST /kote/update-maintenance/:id - Updates a weapon's maintenance dates
app.post('/kote/update-maintenance/:id', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { id } = req.params;
    // 1. Get the new 'status' field from the form
    const { last_maintenance, next_maintenance, status, redirect_company_id } = req.body;

    // --- Redirect Logic ---
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    // ----------------------


    try {
        // 2. Add the `status` = ? to the SQL query
        await pool.execute(
            'UPDATE Weapons SET last_maintenance = ?, next_maintenance = ?, `status` = ? WHERE weapon_id = ?',
            [last_maintenance || null, next_maintenance || null, status, id]
        );
        res.redirect(`${redirectUrl}${separator}success=Weapon details updated successfully!`);
    } catch (error) {
        console.error("Error updating weapon maintenance/status:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.sqlMessage || 'A server error occurred.')}`);
    }
});

// POST /kote/issue-ammo - Calls the SP to issue ammo
app.post('/kote/issue-ammo', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    // 1. Get the new 'transaction_type' from the form
    const { ammo_id, soldier_id, quantity, transaction_type, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;
    // Note: We must use the redirect_company_id for the LOGIC too, 
    // so the CO issues ammo from the target company, not HQ.
    let targetCompanyId = req.session.user.company_id;
    
    // 2. Determine URL & Target Company
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id; // <--- IMPORTANT: Use this for the DB call
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    try {
        // 2. Pass it as the 6th parameter to the stored procedure
        await pool.execute(
            'CALL sp_IssueAmmoToSoldier(?, ?, ?, ?, ?, ?)',
            [ammo_id, soldier_id, quantity, authorizerId,  targetCompanyId, transaction_type]
        );
        res.redirect(`${redirectUrl}${separator}success=Ammunition issued successfully!`);
    } catch (error) {
        console.error("Error issuing ammo:", error);
        res.redirect(`${redirectUrl}${separator}error=` + encodeURIComponent(error.sqlMessage || error.message));
    }
});
// POST /kote/return-ammo - Calls the SP to return ammo
app.post('/kote/return-ammo', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { ammo_type, lot_number, quantity, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;
    // Note: We must use the redirect_company_id for the LOGIC too, 
    // so the CO issues ammo from the target company, not HQ.
    let targetCompanyId = req.session.user.company_id;
    
    // 2. Determine URL & Target Company
    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id; // <--- IMPORTANT: Use this for the DB call
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    try {
        // Call the new stored procedure
        await pool.execute(
            'CALL sp_ReturnAmmoFromSoldier(?, ?, ?, ?, ?, ?)',
            [ammo_type, lot_number, quantity, soldier_id, authorizerId, targetCompanyId]
        );
        res.redirect(`${redirectUrl}${separator}success=Ammunition returned to store!`);
    } catch (error) {
        console.error("Error returning ammo:", error);
        res.redirect(`${redirectUrl}${separator}error=` + encodeURIComponent(error.sqlMessage || error.message));
    }
});
// --- API ROUTE for the Weapon Ledger Search ---
app.get('/api/kote/search-weapon-ledger', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const [rows] = await pool.query(
            `SELECT w.serial_number, s.name, 
                    DATE_FORMAT(wil.date_issued, '%d-%m-%Y %H:%i') AS date_issued_f, 
                    DATE_FORMAT(wil.date_returned, '%d-%m-%Y %H:%i') AS date_returned_f
             FROM Weapon_Issue_Log wil
             JOIN Weapons w ON wil.weapon_id = w.weapon_id
             JOIN Soldiers s ON wil.soldier_id = s.soldier_id
             WHERE w.assigned_company_id = ? 
             AND (w.serial_number LIKE ? OR s.name LIKE ?)
             ORDER BY wil.date_issued DESC LIMIT 50`,
            [companyId, searchPattern, searchPattern]
        );
        res.json(rows);
    } catch (error) {
        console.error("Weapon Ledger Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// --- API ROUTE for the Company Ammo Log Search ---
app.get('/api/kote/search-ammo-log', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const [rows] = await pool.query(
            `SELECT l.log_id, a.ammo_type, a.lot_number, s.name AS soldier_name, l.quantity_change, 
                    DATE_FORMAT(l.transaction_date, '%d-%m-%Y %H:%i') AS date_f
             FROM Ammunition_Log l
             JOIN Ammunition a ON l.ammo_id = a.ammo_id
             LEFT JOIN Soldiers s ON l.recipient_soldier_id = s.soldier_id
             WHERE l.recipient_company_id = ? 
             AND l.transaction_type IN ('Issued_to_Soldier', 'Returned_from_Soldier')
             AND (s.name LIKE ? OR a.ammo_type LIKE ? OR a.lot_number LIKE ?)
             ORDER BY l.transaction_date DESC`,
            [companyId, searchPattern, searchPattern, searchPattern]
        );
        res.json(rows);
    } catch (error) {
        console.error("Ammo Log Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});
// --- ADD THIS NEW API ROUTE for Weapon Assignment Search ---
app.get('/api/kote/search-assignments', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id; // Default to user's own company
        // If User is CO AND a specific company is requested in URL, override it
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }       
        // ---------------------

        const [rows] = await pool.query(
            `SELECT swa.weapon_id, w.serial_number, s.name, s.rank
             FROM Soldier_Weapon_Assignments swa
             JOIN Weapons w ON swa.weapon_id = w.weapon_id
             JOIN Soldiers s ON swa.soldier_id = s.soldier_id
             WHERE s.company_id = ?
             AND (w.serial_number LIKE ? OR s.name LIKE ? OR s.rank LIKE ?)`,
            [companyId, searchPattern, searchPattern, searchPattern]
        );
        res.json(rows);
    } catch (error) {
        console.error("Weapon Assignment Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});


































// Soldier Dashboard Route
app.get("/soldier", checkAuth, checkRole(['Soldier', 'CO']), setNoCache, async (req, res) => {
    try {


        const soldierId = req.session.user.id;

        // 1. Fetch the soldier's personal dashboard info
        const [dashboardRows] = await pool.execute(
            'SELECT * FROM view_SoldierPersonalDashboard WHERE soldier_id = ?',
            [soldierId]
        );
        
        // 2. Fetch the soldier's leave history
        const [leaveRows] = await pool.execute(
            `SELECT DATE_FORMAT(start_date, '%d-%m-%Y') AS start_date_f, 
                    DATE_FORMAT(end_date, '%d-%m-%Y') AS end_date_f, 
                    leave_type, \`status\` 
             FROM Leave_Records 
             WHERE soldier_id = ? 
             ORDER BY start_date DESC`,
            [soldierId]
        );

        // 3. Fetch alerts related to this soldier's assigned weapon
        const [alertRows] = await pool.execute(
            `SELECT a.alert_type, a.message, DATE_FORMAT(a.alert_date, '%d-%m-%Y') AS alert_date_f
             FROM Alerts a 
             JOIN Soldier_Weapon_Assignments swa ON a.related_entity_id = swa.weapon_id
             WHERE a.related_entity_type = 'Weapon' 
               AND swa.soldier_id = ? 
               AND a.is_resolved = FALSE`,
            [soldierId]
        );

        res.render("soldier", {
            user: req.session.user,
            soldier: dashboardRows[0], // The soldier's own profile data
            leaveHistory: leaveRows,     // An array of their leave applications
            alerts: alertRows,           // An array of their alerts
            error: req.query.error || null,   // Pass the error message to the template
            success: req.query.success || null  // Pass the success
        });

    } catch (error) {
        console.error("Soldier dashboard error:", error);
        res.status(500).send("Server Error");
    }
});

// POST Route (To handle the leave application form)
app.post("/apply-leave", checkAuth, checkRole(['Soldier', 'CO']), async (req, res) => {
    try {
        let { leave_type, start_date, end_date, reason } = req.body;
        const soldierId = req.session.user.id;

        if (!reason || reason.trim() === '') {
            reason = 'as per leave plan'; // Set the default value
        }

        // --- Business Logic: Check if soldier has enough leave ---
        const [soldierData] = await pool.execute('SELECT remaining_annual_leave, remaining_casual_leave FROM Soldiers WHERE soldier_id = ?', [soldierId]);
        
        // Calculate leave days (DATEDIFF is inclusive, so add 1)
        const [days] = await pool.execute('SELECT DATEDIFF(?, ?) + 1 AS day_count', [end_date, start_date]);
        const leaveDays = days[0].day_count;

        if (leave_type === 'Annual' && leaveDays > soldierData[0].remaining_annual_leave) {
            // Not enough annual leave
            // We'll redirect back with an error query (a real app might use flash messages)
            return res.redirect("/soldier?error=Not enough annual leave");
        }
        
        if (leave_type === 'Casual' && leaveDays > soldierData[0].remaining_casual_leave) {
            // Not enough casual leave
            return res.redirect("/soldier?error=Not enough casual leave");
        }
        
        // --- All checks passed, insert the leave record ---
        await pool.execute(
            'INSERT INTO Leave_Records (soldier_id, start_date, end_date, leave_type, reason) VALUES (?, ?, ?, ?, ?)',
            [soldierId, start_date, end_date, leave_type, reason]
        );

        // Redirect back to the soldier dashboard
        res.redirect("/soldier?success=Leave application submitted!");

    } catch (error) {
        console.error("Error applying for leave:", error);
        res.redirect("/soldier?error=Server error");
    }
});

// POST route to handle the contact update form
app.post("/update-contact", checkAuth, checkRole(['Soldier', 'CO']), async (req, res) => {
    
    // 1. Get the new contact number from the form body
    const { new_contact } = req.body;
    
    // 2. Securely get the logged-in soldier's ID from their session
    const soldierId = req.session.user.id;

    // 3. Basic validation
    if (!new_contact || new_contact.trim() === '') {
        // Redirect back with an error (you can display this in EJS later)
        return res.redirect("/soldier?error=Contact number cannot be empty");
    }

    try {
        // 4. Execute the SQL UPDATE query
        await pool.execute(
            'UPDATE Soldiers SET contact = ? WHERE soldier_id = ?',
            [new_contact, soldierId]
        );
        
        // 5. Redirect back to the soldier dashboard to see the change
        res.redirect("/soldier?success=Contact updated successfully!");

    } catch (error) {
        console.error("Error updating contact:", error);
        
        // Handle a very common error: duplicate contact number
        if (error.code === 'ER_DUP_ENTRY') {
            return res.redirect("/soldier?error=This contact number is already in use.");
        }
        
        // Handle other general errors
        res.redirect("/soldier?error=A server error occurred.");
    }
});

// POST route to handle the password change form
app.post("/change-password", checkAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    const soldierId = req.session.user.id;

    if (!current_password || !new_password) {
        return res.redirect("/soldier?error=All password fields are required.");
    }

    try {
        // 1. Get the user's *hashed* password
        const [rows] = await pool.execute('SELECT password_hash FROM Users WHERE soldier_id = ?', [soldierId]);
        const hashed_password = rows[0].password_hash;

        // 2. Securely compare the submitted password with the hash
        const isMatch = await bcrypt.compare(current_password, hashed_password);

        if (!isMatch) {
            return res.redirect("/soldier?error=Incorrect current password.");
        }

        // 3. Hash the *new* password before saving it
        const newHashedPassword = await bcrypt.hash(new_password, saltRounds);

        // 4. Store the new hash in the database
        await pool.execute(
            'UPDATE Users SET password_hash = ? WHERE soldier_id = ?',
            [newHashedPassword, soldierId]
        );

        res.redirect("/soldier?success=Password changed successfully!");

    } catch (error) {
        //...
    }
});































// Start the server
app.listen(PORT, function() {
    console.log(`ArmouryNet server started on port ${PORT}`);
});