// backend/app.js
// ============================================================
// PostgreSQL VERSION (converted from the original MySQL app.js)
// Uses the "pg" package instead of "mysql2".
//   npm install pg
// ============================================================

const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session"); // user sessions
const path = require("path");               // managing file paths
const { Pool } = require("pg");
const bcrypt = require('bcrypt');
const saltRounds = 10; // How much processing to use

const { URL } = require('url');

// ------------------------------------------------------------
// DATABASE CONNECTION (PostgreSQL)
// ------------------------------------------------------------
// Configure via environment variables, or edit the defaults below.
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'battalion_inventory'
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));
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
app.get("/", function (req, res) {
    res.render("home");
});

// Serves the public about page
app.get("/about", function (req, res) {
    res.render("about");
});

// Serves the login page
app.get("/login", function (req, res) {
    res.render("login", {
        error: req.query.error || null,
        success: req.query.success || null
    });
});

// ===================================
//  AUTHENTICATION ROUTES
// ===================================

// Handles the login form submission
app.post("/login", async function (req, res) {
    const { username, password } = req.body;

    try {
        // 1. Find the user and explicitly select all the fields we need.
        const { rows } = await pool.query(
            `SELECT
                s.soldier_id, s.name, s."rank", s.company_id,
                u.role, u.password_hash
             FROM Users u
             JOIN Soldiers s ON u.soldier_id = s.soldier_id
             WHERE u.username = $1`,
            [username]
        );

        if (rows.length === 0) {
            return res.redirect("/login?error=Invalid username or password.");
        }

        const user = rows[0];
        const hashedPassword = user.password_hash;

        // 2. Check if the user has a password set
        if (!hashedPassword) {
            console.error(`User ${username} has a NULL password in the database.`);
            return res.redirect("/login?error=Account is not properly configured. Contact admin.");
        }

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

        // 5. Redirect based on role
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
            return res.redirect("/");
        }
        res.clearCookie('connect.sid');
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
        const { rows } = await pool.query(
            'SELECT soldier_id FROM Soldiers WHERE soldier_id = $1 AND "rank" = $2 AND dob = $3',
            [soldier_id, rank, dob]
        );

        if (rows.length === 0) {
            return res.render('forgot-password', { error: 'Verification failed. Details do not match our records.' });
        }

        // 2. Soldier found! Hash the new password
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // 3. Update the Users table
        await pool.query(
            'UPDATE Users SET password_hash = $1 WHERE soldier_id = $2',
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

// CO Dashboard Route
app.get("/co", checkAuth, setNoCache, checkRole(['CO']), async function (req, res) {
    try {
        // 1. Personnel Stats
        const { rows: personnelStats } = await pool.query(
            'SELECT SUM(total_strength) AS total_strength, SUM(officers) AS total_officers, SUM(jcos) AS total_jcos, SUM(other_ranks) AS total_ors FROM view_BattalionPersonnelOverview'
        );

        // 2. Leave Stats
        const { rows: leaveStats } = await pool.query(
            `SELECT COUNT(*) AS on_leave FROM Leave_Records WHERE "status" = 'Approved' AND CURRENT_DATE BETWEEN start_date AND end_date`
        );

        // 3. Weapon Stats
        const { rows: weaponStats } = await pool.query(
            "SELECT total_items, serviceable_count FROM view_BattalionMasterInventory WHERE category = 'Weapons'"
        );

        // 4. Vehicle Stats
        const { rows: vehicleStats } = await pool.query(
            "SELECT total_items, serviceable_count FROM view_BattalionMasterInventory WHERE category = 'Vehicles'"
        );

        // 5. Ammo Stats (Total Quantity)
        const { rows: ammoStats } = await pool.query(
            "SELECT SUM(quantity) AS total_ammo FROM Ammunition"
        );

        // 6. Ration Stats (Total Quantity in Battalion Store)
        const { rows: rationStats } = await pool.query(
            "SELECT SUM(quantity_kg) AS total_rations FROM BattalionStock"
        );

        // 7. All Active Alerts (High Priority)
        const { rows: allAlerts } = await pool.query(
            "SELECT * FROM view_ActiveAlerts ORDER BY alert_date_formatted DESC LIMIT 20"
        );

        // 8. Company-wise Strength (for the Personnel section)
        const { rows: companyStrength } = await pool.query(
            "SELECT * FROM view_BattalionPersonnelOverview"
        );

        // 9. Readiness Data (for Reports section)
        const { rows: readiness } = await pool.query(`
            SELECT
            c.company_name,
            COUNT(DISTINCT swa.soldier_id) as issued_weapons
            FROM Companies c
            LEFT JOIN Soldiers s ON c.company_id = s.company_id AND s."status" = 'Active'
            LEFT JOIN Soldier_Weapon_Assignments swa ON s.soldier_id = swa.soldier_id
            GROUP BY c.company_id, c.company_name
        `);

        // 10. List of all Companies (for dropdowns, etc.)
        const { rows: allCompanies } = await pool.query("SELECT company_id, company_name FROM Companies");

        const { rows: approvalQueue } = await pool.query(`
            SELECT
                lr.leave_id,
                s.name,
                s."rank",
                c.company_name,
                lr.leave_type,
                TO_CHAR(lr.start_date, 'DD-MM-YYYY') as start,
                TO_CHAR(lr.end_date, 'DD-MM-YYYY') as "end",
                lr.reason
            FROM Leave_Records lr
            JOIN Soldiers s ON lr.soldier_id = s.soldier_id
            JOIN Companies c ON s.company_id = c.company_id
            WHERE lr."status" = 'Pending'
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

        const { rows: users } = await pool.query(
            `SELECT u.user_id, u.username, u.role, s.name, s."rank"
             FROM Users u
             JOIN Soldiers s ON u.soldier_id = s.soldier_id
             WHERE u.username ILIKE $1 OR s.name ILIKE $2 OR u.role::text ILIKE $3
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

    try {
        const hash = await bcrypt.hash('pass123', 10); // Live generation

        await pool.query(
            'UPDATE Users SET password_hash = $1 WHERE user_id = $2',
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
        const { rows: soldiers } = await pool.query(
            `SELECT soldier_id, name, "rank"
             FROM Soldiers
             WHERE soldier_id NOT IN (SELECT soldier_id FROM Users)
             AND "status" = 'Active'`
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
        const { rows } = await pool.query('SELECT user_id, username, role FROM Users WHERE user_id = $1', [id]);
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

        await pool.query(
            'INSERT INTO Users (soldier_id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
            [soldier_id, username, hashedPassword, role]
        );
        res.redirect('/co?success=User account created successfully!');
    } catch (error) {
        console.error("Error adding user:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// 4. POST: Update a user (Role/Username)
app.post('/admin/update-user/:id', checkAuth, checkRole(['CO']), async (req, res) => {
    const { id } = req.params;
    const { username, role } = req.body;

    try {
        await pool.query(
            'UPDATE Users SET username = $1, role = $2 WHERE user_id = $3',
            [username, role, id]
        );
        res.redirect('/co?success=User updated successfully!');
    } catch (error) {
        console.error("Error updating user:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// 5. GET: Delete a user
app.get('/admin/delete-user/:id', checkAuth, checkRole(['CO']), async (req, res) => {
    const { id } = req.params;
    if (id == req.session.user.user_id) {
        return res.redirect('/co?error=You cannot delete your own account.');
    }

    try {
        await pool.query('DELETE FROM Users WHERE user_id = $1', [id]);
        res.redirect('/co?success=User access revoked.');
    } catch (error) {
        res.redirect('/co?error=Could not delete user.');
    }
});

// POST /admin/run-daily-checks - Manually triggers the daily maintenance procedure
app.post('/admin/run-daily-checks', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        await pool.query('CALL sp_RunDailyChecks()');
        res.redirect('/co?success=Daily diagnostics run successfully. Alerts have been updated.');
    } catch (error) {
        console.error("Error running daily checks:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.message || 'Server error during diagnostics.'));
    }
});

// POST /admin/reset-yearly-leaves - Manually triggers the yearly reset
app.post('/admin/reset-yearly-leaves', checkAuth, checkRole(['CO']), async (req, res) => {
    try {
        await pool.query('CALL sp_ResetYearlyLeaves()');
        res.redirect('/co?success=Yearly leave quotas have been reset for all soldiers.');
    } catch (error) {
        console.error("Error resetting leaves:", error);
        res.redirect('/co?error=' + encodeURIComponent(error.message || 'Server error.'));
    }
});

// API route to search personnel by name, rank, or company
app.get("/api/search-personnel", checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;

        const { rows } = await pool.query(
            `SELECT soldier_id, name, "rank", company_name
             FROM view_SoldierPersonalDashboard
             WHERE name ILIKE $1 OR "rank" ILIKE $2 OR company_name ILIKE $3`,
            [searchPattern, searchPattern, searchPattern]
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

        const { rows: soldierRows } = await pool.query('SELECT * FROM Soldiers WHERE soldier_id = $1', [id]);

        if (soldierRows.length === 0) {
            return res.status(404).json({ message: 'Soldier not found' });
        }

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
        await pool.query(
            'UPDATE Soldiers SET "status" = $1 WHERE soldier_id = $2',
            [newStatus, id]
        );
        res.redirect('/adjutant?success=Soldier status updated!');
    } catch (error) {
        console.error("Error updating status:", error);
        res.redirect('/adjutant?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// API route to search leave records by soldier name, rank, or company
app.get("/api/search-leave", checkAuth, checkRole(['Adjutant', 'CO', 'CompanyCommander']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchStatus = req.query.status || 'all';
        const searchPattern = `%${searchTerm}%`;

        let sql = `SELECT * FROM view_AllLeaveRecords
                   WHERE (soldier_name ILIKE $1 OR "rank" ILIKE $2 OR company_name ILIKE $3)`;

        let params = [searchPattern, searchPattern, searchPattern];

        if (searchStatus !== 'all') {
            params.push(searchStatus);
            sql += ` AND "status" = $${params.length}`;
        }

        sql += ' ORDER BY start_date_formatted DESC';

        const { rows } = await pool.query(sql, params);
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
        const { rows: leaveRows } = await pool.query(
            'SELECT * FROM view_AllLeaveRecords WHERE leave_id = $1',
            [id]
        );

        if (leaveRows.length === 0) {
            return res.status(404).json({ message: 'Leave record not found' });
        }

        const leaveData = leaveRows[0];

        // 2. Find the last approved leave for this soldier
        // NOTE: view_AllLeaveRecords exposes formatted dates only, so we
        // re-fetch the raw start_date from Leave_Records for the comparison.
        const { rows: currentLeaveRaw } = await pool.query(
            'SELECT start_date FROM Leave_Records WHERE leave_id = $1',
            [id]
        );
        const rawStartDate = currentLeaveRaw[0].start_date;

        const { rows: lastLeaveRows } = await pool.query(
            `SELECT TO_CHAR(end_date, 'DD-MM-YYYY') AS last_leave_end_date
             FROM Leave_Records
             WHERE soldier_id = $1 AND "status" = 'Approved' AND start_date < $2
             ORDER BY start_date DESC LIMIT 1`,
            [leaveData.soldier_id, rawStartDate]
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
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const referer = req.get('Referer') || '/';
    const refererUrl = new URL(referer, baseUrl);

    try {
        const { id } = req.params;
        const approverId = req.session.user.id;

        await pool.query(
            'UPDATE Leave_Records SET "status" = $1, approved_by_id = $2 WHERE leave_id = $3 AND "status" = $4',
            ['Approved', approverId, id, 'Pending']
        );

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

        await pool.query(
            'UPDATE Leave_Records SET "status" = $1, approved_by_id = $2 WHERE leave_id = $3 AND "status" = $4',
            ['Rejected', approverId, id, 'Pending']
        );

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
        const { company_id } = req.query;

        let sql = 'SELECT * FROM view_RollCallReport';
        let params = [];

        if (company_id && company_id !== 'all') {
            params.push(company_id);
            sql += ` WHERE company_id = $${params.length}`;
        }

        sql += ' ORDER BY company_name, "rank", name';

        const { rows } = await pool.query(sql, params);
        res.json(rows);

    } catch (error) {
        console.error("Roll Call API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// Adjutant Dashboard Route
app.get("/adjutant", checkAuth, checkRole(['Adjutant', 'CO']), setNoCache, async function (req, res) {

    try {
        const { rows: personnelList } = await pool.query(
            'SELECT soldier_id, name, "rank", company_name FROM view_SoldierPersonalDashboard'
        );

        const { rows: allLeaves } = await pool.query(
            'SELECT * FROM view_AllLeaveRecords ORDER BY start_date_formatted DESC'
        );

        const { rows: pendingLeaves } = await pool.query(
            'SELECT * FROM view_AllPendingLeaveRequests'
        );

        const { rows: personnelStats } = await pool.query(
            'SELECT SUM(total_strength) AS total_strength FROM view_BattalionPersonnelOverview'
        );

        const { rows: soldiersOnLeave } = await pool.query(
            `SELECT COUNT(*) AS on_leave_count FROM Leave_Records WHERE "status" = 'Approved' AND CURRENT_DATE BETWEEN start_date AND end_date`
        );

        const { rows: companyList } = await pool.query(
            'SELECT company_id, company_name FROM Companies'
        );

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
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    try {
        await pool.query(
            'CALL sp_RegisterNewSoldier($1, $2, $3, $4, $5, $6, $7)',
            [name, rank, dob, contact, company_id, username, hashedPassword]
        );
        res.redirect('/adjutant?success=Soldier added successfully!');
    } catch (error) {
        console.error("Error adding soldier:", error);
        res.redirect('/adjutant?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// POST /personnel/update/:id - Handles the "Update Soldier" form
app.post('/personnel/update/:id', checkAuth, checkRole(['Adjutant', 'CO']), async (req, res) => {
    const { name, rank, contact, company_id } = req.body;
    const { id } = req.params;

    try {
        await pool.query(
            'UPDATE Soldiers SET name = $1, "rank" = $2, contact = $3, company_id = $4 WHERE soldier_id = $5',
            [name, rank, contact, company_id, id]
        );
        res.redirect('/adjutant?success=Record updated successfully!');
    } catch (error) {
        console.error("Error updating soldier:", error);
        res.redirect('/adjutant?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// MTO Dashboard Route
app.get("/mto", checkAuth, setNoCache, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {

    try {
        const { rows: vehicles } = await pool.query('SELECT * FROM view_MTO_Dashboard');

        const { rows: fuelStock } = await pool.query('SELECT * FROM Fuel_Lubricants');

        const { rows: alerts } = await pool.query(
            "SELECT * FROM view_ActiveAlerts WHERE related_entity_type = 'Military_Transport' OR related_entity_type = 'Fuel_Lubricants'"
        );

        const { rows: drivers } = await pool.query(
            `SELECT s.soldier_id, s.name, s."rank" FROM Soldiers s JOIN Companies c ON s.company_id = c.company_id WHERE c.company_name = 'Headquarter Company' AND s."status" = 'Active'`
        );

        const stats = {
            totalVehicles: vehicles.length,
            operational: vehicles.filter(v => v.status === 'Operational').length,
            inRepair: vehicles.filter(v => v.status === 'In-Repair').length
        };

        const { rows: fuelLogs } = await pool.query(`
            SELECT
                fl.log_id,
                TO_CHAR(fl.date_drawn, 'DD-MM-YYYY HH24:MI') AS log_date,
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
        const context = req.query.context;
        const searchPattern = `%${searchTerm}%`;

        let sql = `SELECT * FROM view_MTO_Dashboard
                   WHERE (vehicle_number ILIKE $1 OR model ILIKE $2 OR driver_name ILIKE $3)`;
        let params = [searchPattern, searchPattern, searchPattern];

        if (context === 'maintenance') {
            sql += ' AND next_maintenance_date IS NOT NULL';
        }

        const { rows } = await pool.query(sql, params);
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
        const { rows } = await pool.query(
            `SELECT *, TO_CHAR(last_maintenance, 'YYYY-MM-DD') AS html_last_maint, TO_CHAR(next_maintenance, 'YYYY-MM-DD') AS html_next_maint FROM Military_Transport WHERE mt_id = $1`,
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

        const { rows } = await pool.query(
            `SELECT
                fl.log_id,
                TO_CHAR(fl.date_drawn, 'DD-MM-YYYY HH24:MI') AS log_date,
                mt.vehicle_number,
                f.fuel_type,
                fl.quantity_drawn,
                fl.odometer_reading
            FROM MT_Fuel_Log fl
            JOIN Military_Transport mt ON fl.mt_id = mt.mt_id
            JOIN Fuel_Lubricants f ON fl.fuel_id = f.fuel_id
            WHERE
                (mt.vehicle_number ILIKE $1 OR
                 f.fuel_type ILIKE $2 OR
                 CAST(fl.odometer_reading AS TEXT) ILIKE $3)
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

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Get the log entry we are about to delete
        const { rows: logRows } = await client.query(
            'SELECT * FROM MT_Fuel_Log WHERE log_id = $1 FOR UPDATE',
            [id]
        );

        if (logRows.length === 0) {
            await client.query('ROLLBACK');
            return res.redirect('/mto?error=Log entry not found.');
        }

        const log = logRows[0];
        const qtyToReturn = log.quantity_drawn;
        const vehicleId = log.mt_id;

        // 2. Add the fuel quantity back to the main Fuel_Lubricants stock
        await client.query(
            'UPDATE Fuel_Lubricants SET quantity_liters = quantity_liters + $1 WHERE fuel_id = $2',
            [qtyToReturn, log.fuel_id]
        );

        // 3. Delete the log entry
        await client.query(
            'DELETE FROM MT_Fuel_Log WHERE log_id = $1',
            [id]
        );

        // 4. Fix the vehicle's master odometer reading.
        const { rows: latestLogs } = await client.query(
            'SELECT odometer_reading FROM MT_Fuel_Log WHERE mt_id = $1 ORDER BY date_drawn DESC LIMIT 1',
            [vehicleId]
        );

        let newOdometer = 0;
        if (latestLogs.length > 0) {
            newOdometer = latestLogs[0].odometer_reading;
        }

        // 5. Update the Military_Transport table with the correct (previous) odometer reading
        await client.query(
            'UPDATE Military_Transport SET odometer_reading = $1 WHERE mt_id = $2',
            [newOdometer, vehicleId]
        );

        // 6. If all steps succeed, commit the changes
        await client.query('COMMIT');
        res.redirect('/mto?success=Fuel log successfully reversed!');

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error reversing fuel log:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    } finally {
        if (client) client.release();
    }
});

// POST route to update vehicle maintenance
app.post('/mto/update-maintenance/:id', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { last_maintenance, next_maintenance, odometer_reading, status } = req.body;

    try {
        await pool.query(
            'UPDATE Military_Transport SET last_maintenance = $1, next_maintenance = $2, odometer_reading = $3, "status" = $4 WHERE mt_id = $5',
            [last_maintenance || null, next_maintenance || null, odometer_reading, status, id]
        );
        res.redirect('/mto?success=Vehicle condition updated successfully!');
    } catch (error) {
        console.error("Error updating maintenance:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
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

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Get current vehicle and fuel data
        const { rows: fuelRows } = await client.query('SELECT quantity_liters FROM Fuel_Lubricants WHERE fuel_id = $1 FOR UPDATE', [fuel_id]);
        const { rows: vehicleRows } = await client.query('SELECT odometer_reading FROM Military_Transport WHERE mt_id = $1 FOR UPDATE', [mt_id]);

        // 2. Check for sufficient fuel
        if (fuelRows.length === 0 || fuelRows[0].quantity_liters < qty) {
            await client.query('ROLLBACK');
            return res.redirect('/mto?error=Not enough fuel in stock.');
        }

        // 3. Check if new odometer reading is valid
        if (odometer > 0 && odometer < vehicleRows[0].odometer_reading) {
            await client.query('ROLLBACK');
            return res.redirect('/mto?error=Odometer reading must be higher than the previous one.');
        }

        // 4. Subtract from the main fuel stock
        await client.query(
            'UPDATE Fuel_Lubricants SET quantity_liters = quantity_liters - $1 WHERE fuel_id = $2',
            [qty, fuel_id]
        );

        // 5. Log the transaction in MT_Fuel_Log
        await client.query(
            'INSERT INTO MT_Fuel_Log (mt_id, fuel_id, quantity_drawn, odometer_reading) VALUES ($1, $2, $3, $4)',
            [mt_id, fuel_id, qty, odometer]
        );

        // 6. Update the vehicle's master odometer reading
        if (odometer > 0) {
            await client.query(
                'UPDATE Military_Transport SET odometer_reading = $1 WHERE mt_id = $2',
                [odometer, mt_id]
            );
        }

        await client.query('COMMIT');
        res.redirect('/mto?success=Fuel log added successfully!');

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error logging fuel:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    } finally {
        if (client) client.release();
    }
});

app.get('/api/mto-report', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    try {
        const { type } = req.query;

        if (type === 'vehicle_status') {
            const { rows: reportData } = await pool.query(
                'SELECT * FROM view_MTO_Dashboard ORDER BY "status", vehicle_number'
            );
            res.json({ reportType: 'vehicle_status', data: reportData });

        } else if (type === 'fuel_log') {
            const { rows: reportData } = await pool.query(`
                SELECT
                    TO_CHAR(fl.date_drawn, 'DD-MM-YYYY HH24:MI') AS log_date,
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

// POST /mto/assign-driver/:id
app.post('/mto/assign-driver/:id', checkAuth, checkRole(['MTO', 'MT_JCO', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { driver_id } = req.body;

    try {
        await pool.query(
            'UPDATE Military_Transport SET driver_id = $1 WHERE mt_id = $2',
            [driver_id || null, id]
        );

        res.redirect('/mto?success=Driver assignment updated successfully!');

    } catch (error) {
        console.error("Error assigning driver:", error);
        res.redirect('/mto?error=' + encodeURIComponent(error.detail || error.message || 'Server Error'));
    }
});

// QM Dashboard Route
app.get("/qm", checkAuth, setNoCache, checkRole(['QM', 'CO']), async function (req, res) {
    try {
        const { rows: weapons } = await pool.query(
            `SELECT asset_id, serial_number, model, "status", assigned_to FROM view_QMMasterLogisticsLedger WHERE asset_category = 'Weapon'`
        );

        const { rows: ammo } = await pool.query(
            "SELECT ammo_id, ammo_type, quantity, lot_number, TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f FROM Ammunition"
        );

        const { rows: vehicles } = await pool.query(
            'SELECT * FROM view_MTO_Dashboard'
        );

        const { rows: alerts } = await pool.query(
            "SELECT * FROM view_ActiveAlerts WHERE alert_type IN ('Low Stock', 'Expiry','Maintenance Due')"
        );

        const { rows: companies } = await pool.query(
            "SELECT * FROM Companies"
        );

        const { rows: fuel } = await pool.query(
            "SELECT fuel_id, fuel_type, quantity_liters, low_stock_threshold FROM Fuel_Lubricants"
        );

        // --- RATION LOGIC ---
        const { rows: battalionRations } = await pool.query(
            "SELECT *, TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f FROM BattalionStock"
        );
        const { rows: companyRations } = await pool.query(
            "SELECT r.ration_id, r.item_name, r.lot_number, c.company_name, r.quantity_kg, r.assigned_company_id, TO_CHAR(r.expiry_date, 'DD-MM-YYYY') AS expiry_date_f FROM Rations r JOIN Companies c ON r.assigned_company_id = c.company_id"
        );

        const { rows: rationLogs } = await pool.query(`
        SELECT
            TO_CHAR(rl.transaction_date, 'DD-MM-YYYY HH24:MI') AS date_f,
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

    const { serial_number, type, model, assigned_company_id } = req.body;

    if (!serial_number || !type || !model || !assigned_company_id) {
        return res.redirect('/qm?error=All fields are required.');
    }

    try {
        const sql = 'INSERT INTO Weapons (serial_number, "type", model, assigned_company_id) VALUES ($1, $2, $3, $4)';

        await pool.query(sql, [serial_number, type, model, assigned_company_id]);

        res.redirect('/qm?success=Weapon added successfully!');

    } catch (error) {
        console.error("Error adding weapon:", error);

        // Postgres unique-violation error code
        if (error.code === '23505') {
            return res.redirect('/qm?error=A weapon with that serial number already exists.');
        }

        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// API route to get data for a single weapon
app.get('/api/weapon/:id', checkAuth, checkRole(['QM', 'CO', 'Company_Weapon_Incharge']), async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query(
            `SELECT *, TO_CHAR(last_maintenance, 'YYYY-MM-DD') AS html_last_maint, TO_CHAR(next_maintenance, 'YYYY-MM-DD') AS html_next_maint FROM Weapons WHERE weapon_id = $1`,
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
    const { serial_number, type, model, assigned_company_id, status } = req.body;

    try {
        await pool.query(
            'UPDATE Weapons SET serial_number = $1, "type" = $2, model = $3, assigned_company_id = $4, "status" = $5, last_maintenance = $6, next_maintenance = $7 WHERE weapon_id = $8',
            [serial_number, type, model, assigned_company_id, status, null, null, id]
        );
        res.redirect('/qm?success=Weapon updated successfully!');
    } catch (error) {
        console.error("Error updating weapon:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// GET route to delete a weapon
app.get('/qm/delete-weapon/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;

    try {
        // Safety Check 1: Is the weapon formally assigned to a soldier?
        const { rows: assignmentRows } = await pool.query('SELECT COUNT(*) AS count FROM Soldier_Weapon_Assignments WHERE weapon_id = $1', [id]);
        if (parseInt(assignmentRows[0].count, 10) > 0) {
            return res.redirect('/qm?error=Cannot delete. Weapon is formally assigned. Un-assign it first.');
        }

        // Safety Check 2: Is the weapon currently issued to someone?
        const { rows: weaponRows } = await pool.query('SELECT "status" FROM Weapons WHERE weapon_id = $1', [id]);
        if (weaponRows.length > 0 && weaponRows[0].status === 'Issued') {
            return res.redirect('/qm?error=Cannot delete. Weapon is currently issued to a soldier.');
        }

        // If safe, proceed with deletion
        await pool.query('DELETE FROM Weapons WHERE weapon_id = $1', [id]);
        res.redirect('/qm?success=Weapon removed from armory.');

    } catch (error) {
        console.error("Error deleting weapon:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// POST /qm/add-ammo - Adds new ammunition stock
app.post('/qm/add-ammo', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {

    const { ammo_type, quantity, lot_number, expiry_date, low_stock_threshold } = req.body;

    if (!ammo_type || !quantity || !lot_number || !expiry_date) {
        return res.redirect('/qm?error=All fields are required.');
    }

    try {
        // Check if this exact ammo type and lot already exists
        const { rows: existing } = await pool.query(
            'SELECT * FROM Ammunition WHERE ammo_type = $1 AND lot_number = $2',
            [ammo_type, lot_number]
        );

        if (existing.length > 0) {
            // If it exists, just ADD to the quantity
            await pool.query(
                'UPDATE Ammunition SET quantity = quantity + $1 WHERE ammo_id = $2',
                [quantity, existing[0].ammo_id]
            );
        } else {
            // If it's a new item/lot, INSERT a new row
            await pool.query(
                'INSERT INTO Ammunition (ammo_type, quantity, lot_number, expiry_date, low_stock_threshold) VALUES ($1, $2, $3, $4, $5)',
                [ammo_type, quantity, lot_number, expiry_date, low_stock_threshold]
            );
        }

        res.redirect('/qm?success=Ammunition stock added successfully!');

    } catch (error) {
        console.error("Error adding ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// API route to get data for a single ammo batch
app.get('/api/ammo/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query(
            `SELECT *, TO_CHAR(expiry_date, 'YYYY-MM-DD') AS html_expiry_date FROM Ammunition WHERE ammo_id = $1`,
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
        await pool.query(
            'UPDATE Ammunition SET ammo_type = $1, quantity = $2, lot_number = $3, expiry_date = $4, low_stock_threshold = $5 WHERE ammo_id = $6',
            [ammo_type, quantity, lot_number, expiry_date, low_stock_threshold, id]
        );
        res.redirect('/qm?success=Ammunition updated successfully!');
    } catch (error) {
        console.error("Error updating ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// GET route to delete an ammo batch
app.get('/qm/delete-ammo/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;

    try {
        // SAFETY CHECK: Only allow deleting an item if its quantity is 0
        const { rows: ammoRows } = await pool.query('SELECT quantity FROM Ammunition WHERE ammo_id = $1', [id]);

        if (ammoRows.length > 0 && ammoRows[0].quantity > 0) {
            return res.redirect('/qm?error=Cannot delete. Stock is not empty (quantity is ' + ammoRows[0].quantity + '). Update quantity to 0 first.');
        }

        await pool.query('DELETE FROM Ammunition WHERE ammo_id = $1', [id]);
        res.redirect('/qm?success=Ammunition batch removed from armory.');

    } catch (error) {
        console.error("Error deleting ammo:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// POST /qm/add-stock - Adds new stock to the BattalionStock table
app.post('/qm/add-stock', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { item_name, lot_number, quantity, expiry_date, low_stock_threshold } = req.body;

    try {
        // Postgres upsert using the uq_item_lot unique constraint (item_name, lot_number)
        await pool.query(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date, low_stock_threshold)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (item_name, lot_number)
             DO UPDATE SET
                quantity_kg = BattalionStock.quantity_kg + EXCLUDED.quantity_kg,
                expiry_date = EXCLUDED.expiry_date,
                low_stock_threshold = EXCLUDED.low_stock_threshold`,
            [item_name, lot_number, quantity, expiry_date, low_stock_threshold]
        );
        res.redirect('/qm?success=Battalion stock added/updated successfully!');
    } catch (error) {
        console.error("Error adding stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// POST /qm/distribute-rations
app.post('/qm/distribute-rations', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { stock_id, company_id, quantity } = req.body;
    const qtyToMove = parseFloat(quantity);
    const userId = req.session.user.id;

    if (qtyToMove <= 0) {
        return res.redirect('/qm?error=Quantity must be greater than zero.');
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Check Battalion Stock
        const { rows: stockRows } = await client.query(
            'SELECT * FROM BattalionStock WHERE stock_id = $1 FOR UPDATE',
            [stock_id]
        );

        const item = stockRows[0];
        if (!item || item.quantity_kg < qtyToMove) {
            await client.query('ROLLBACK');
            return res.redirect('/qm?error=Not enough stock in that batch.');
        }

        // 2. Subtract from Battalion Stock
        await client.query(
            'UPDATE BattalionStock SET quantity_kg = quantity_kg - $1 WHERE stock_id = $2',
            [qtyToMove, stock_id]
        );

        // 3. Add to Company Stock (Rations table) - upsert on uq_item_lot_company
        await client.query(
            `INSERT INTO Rations (item_name, lot_number, expiry_date, assigned_company_id, quantity_kg)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (item_name, lot_number, assigned_company_id)
             DO UPDATE SET quantity_kg = Rations.quantity_kg + EXCLUDED.quantity_kg`,
            [item.item_name, item.lot_number, item.expiry_date, company_id, qtyToMove]
        );

        // 4. Log the transaction
        const { rows: rationRows } = await client.query(
            'SELECT ration_id FROM Rations WHERE item_name = $1 AND lot_number = $2 AND assigned_company_id = $3',
            [item.item_name, item.lot_number, company_id]
        );
        const rationId = rationRows[0].ration_id;

        await client.query(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES ($1, $2, 'Received_from_QM', $3, $4, $5)`,
            [rationId, company_id, qtyToMove, userId, 'Distributed from Battalion Store']
        );

        await client.query('COMMIT');
        res.redirect('/qm?success=Rations distributed and logged successfully!');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error distributing rations:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    } finally {
        if (client) client.release();
    }
});

// Update stock information
app.post('/qm/update-stock/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { stock_id } = req.params;
    const { expiry_date, low_stock_threshold, quantity_kg } = req.body;

    try {
        await pool.query(
            'UPDATE BattalionStock SET expiry_date = $1, low_stock_threshold = $2, quantity_kg = $3 WHERE stock_id = $4',
            [expiry_date, low_stock_threshold, quantity_kg, stock_id]
        );
        res.redirect('/qm?success=Battalion stock item updated!');
    } catch (error) {
        console.error("Error updating stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// This route completely deletes a stock item
app.get('/qm/delete-stock/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { stock_id } = req.params;

    try {
        // 1. Get the item details *before* deleting
        const { rows: stockRows } = await pool.query('SELECT * FROM BattalionStock WHERE stock_id = $1', [stock_id]);
        if (stockRows.length === 0) {
            return res.redirect('/qm?error=Item not found.');
        }
        const item = stockRows[0];

        // 2. SAFETY CHECK: See if this *specific lot* is in any company's stock
        const { rows: companyRows } = await pool.query(
            'SELECT COUNT(*) AS count FROM Rations WHERE item_name = $1 AND lot_number = $2',
            [item.item_name, item.lot_number]
        );

        if (parseInt(companyRows[0].count, 10) > 0) {
            return res.redirect('/qm?error=Cannot delete. This batch is still in use by a company. Revert all company stock first.');
        }

        // 3. If safe, proceed with deletion
        await pool.query(
            'DELETE FROM BattalionStock WHERE stock_id = $1',
            [stock_id]
        );

        res.redirect('/qm?success=Stock item completely removed from battalion store.');

    } catch (error) {
        console.error("Error deleting stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// GET /qm/revert-stock - Returns stock from a Company back to the QM
app.get('/qm/revert-stock/:ration_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { ration_id } = req.params;

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Find the exact company stock row by its unique ID
        const { rows: companyRows } = await client.query(
            'SELECT * FROM Rations WHERE ration_id = $1 FOR UPDATE',
            [ration_id]
        );

        if (companyRows.length === 0 || companyRows[0].quantity_kg <= 0) {
            await client.query('ROLLBACK');
            return res.redirect('/qm?error=No stock to revert.');
        }

        const item = companyRows[0];
        const qtyToRevert = item.quantity_kg;

        // 2. Add that stock back to the correct batch in BattalionStock
        await client.query(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (item_name, lot_number)
             DO UPDATE SET quantity_kg = BattalionStock.quantity_kg + EXCLUDED.quantity_kg`,
            [item.item_name, item.lot_number, qtyToRevert, item.expiry_date]
        );

        // 3. Delete the specific row from the company's Rations table
        await client.query(
            'DELETE FROM Rations WHERE ration_id = $1',
            [ration_id]
        );

        await client.query('COMMIT');
        res.redirect('/qm?success=Stock successfully reverted to battalion store!');

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error reverting stock:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    } finally {
        if (client) client.release();
    }
});

// API route to get data for the "Edit Stock" modal
app.get('/api/stock-item/:stock_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { stock_id } = req.params;
        const { rows } = await pool.query(
            `SELECT *, TO_CHAR(expiry_date, 'YYYY-MM-DD') AS html_expiry_date FROM BattalionStock WHERE stock_id = $1`,
            [stock_id]
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
    const { fuel_type, quantity, low_stock_threshold } = req.body;

    try {
        await pool.query(
            `INSERT INTO Fuel_Lubricants (fuel_type, quantity_liters, low_stock_threshold)
             VALUES ($1, $2, $3)
             ON CONFLICT (fuel_type)
             DO UPDATE SET
                quantity_liters = Fuel_Lubricants.quantity_liters + EXCLUDED.quantity_liters,
                low_stock_threshold = EXCLUDED.low_stock_threshold`,
            [fuel_type, quantity, low_stock_threshold]
        );
        res.redirect('/qm?success=Fuel stock added/updated successfully!');
    } catch (error) {
        console.error("Error adding fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// POST /qm/update-fuel/:fuel_id
app.post('/qm/update-fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { fuel_id } = req.params;
    const { fuel_type, quantity_liters, low_stock_threshold } = req.body;

    try {
        await pool.query(
            'UPDATE Fuel_Lubricants SET fuel_type = $1, quantity_liters = $2, low_stock_threshold = $3 WHERE fuel_id = $4',
            [fuel_type, quantity_liters, low_stock_threshold, fuel_id]
        );
        res.redirect('/qm?success=Fuel item updated successfully!');
    } catch (error) {
        console.error("Error updating fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// GET /qm/delete-fuel/:fuel_id
app.get('/qm/delete-fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { fuel_id } = req.params;

    try {
        const { rows } = await pool.query('SELECT quantity_liters FROM Fuel_Lubricants WHERE fuel_id = $1', [fuel_id]);
        if (rows.length > 0 && rows[0].quantity_liters > 0) {
            return res.redirect(`/qm?error=Cannot delete. Quantity is not 0. Update quantity first.`);
        }

        await pool.query('DELETE FROM Fuel_Lubricants WHERE fuel_id = $1', [fuel_id]);
        res.redirect('/qm?success=Fuel type removed successfully.');

    } catch (error) {
        console.error("Error deleting fuel:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// API route to get data for a single fuel item
app.get('/api/fuel/:fuel_id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    try {
        const { fuel_id } = req.params;
        const { rows } = await pool.query('SELECT * FROM Fuel_Lubricants WHERE fuel_id = $1', [fuel_id]);

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
    const { vehicle_number, type, model, assigned_company_id, last_maintenance, next_maintenance } = req.body;

    try {
        await pool.query(
            `INSERT INTO Military_Transport (vehicle_number, "type", model, last_maintenance, next_maintenance, "status")
             VALUES ($1, $2, $3, $4, $5, 'Operational')`,
            [vehicle_number, type, model, last_maintenance || null, next_maintenance || null]
        );
        res.redirect('/qm?success=Vehicle added successfully!');
    } catch (error) {
        console.error("Error adding vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message));
    }
});

// POST /qm/update-vehicle/:id
app.post('/qm/update-vehicle/:id', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { vehicle_number, type, model, driver_id, status, last_maintenance, next_maintenance } = req.body;

    try {
        await pool.query(
            'UPDATE Military_Transport SET vehicle_number = $1, "type" = $2, model = $3, driver_id = $4, "status" = $5, last_maintenance = $6, next_maintenance = $7 WHERE mt_id = $8',
            [vehicle_number, type, model, driver_id || null, status, last_maintenance || null, next_maintenance || null, id]
        );
        res.redirect('/qm?success=Vehicle updated successfully!');
    } catch (error) {
        console.error("Error updating vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// GET /qm/decommission-vehicle/:id
app.get('/qm/decommission-vehicle/:id', checkAuth, checkRole(['QM', 'CO', 'MTO']), async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await pool.query('SELECT "status" FROM Military_Transport WHERE mt_id = $1', [id]);
        if (rows.length > 0 && rows[0].status === 'On-Duty') {
            return res.redirect(`/qm?error=Cannot decommission. Vehicle is currently 'On-Duty'.`);
        }

        await pool.query(
            'UPDATE Military_Transport SET "status" = $1, driver_id = NULL WHERE mt_id = $2',
            ['In-Repair', id]
        );
        res.redirect('/qm?success=Vehicle set to In-Repair and unassigned from driver.');

    } catch (error) {
        console.error("Error decommissioning vehicle:", error);
        res.redirect('/qm?error=' + encodeURIComponent(error.detail || error.message || 'A server error occurred.'));
    }
});

// GET /api/qm-report - Generates QM reports based on type
app.get('/api/qm-report', checkAuth, checkRole(['QM', 'CO']), async (req, res) => {
    const { type } = req.query;

    try {
        if (type === 'stock') {
            const { rows: weapons } = await pool.query('SELECT "type", model, "status", serial_number FROM Weapons ORDER BY "type"');
            const { rows: ammo } = await pool.query("SELECT ammo_type, lot_number, quantity, TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f FROM Ammunition ORDER BY ammo_type");
            const { rows: rations } = await pool.query("SELECT item_name, lot_number, quantity_kg, TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f FROM BattalionStock ORDER BY item_name");
            const { rows: fuel } = await pool.query("SELECT fuel_type, quantity_liters FROM Fuel_Lubricants ORDER BY fuel_type");

            res.json({ reportType: 'stock', data: { weapons, ammo, rations, fuel } });

        } else if (type === 'alerts') {
            const { rows: alerts } = await pool.query(
                "SELECT alert_type, message, alert_date_formatted AS alert_date_f FROM view_ActiveAlerts WHERE alert_type IN ('Low Stock', 'Expiry', 'Maintenance Due') ORDER BY alert_id DESC"
            );

            res.json({ reportType: 'alerts', data: alerts });

        } else if (type === 'distribution_log') {
            const { rows: logs } = await pool.query(`
                SELECT
                    TO_CHAR(rl.transaction_date, 'DD-MM-YYYY HH24:MI') AS date_f,
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

        } else {
            res.status(400).json({ message: 'Invalid report type' });
        }
    } catch (error) {
        console.error("QM Report API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /alert/resolve/:id - Marks an alert as resolved
app.get('/alert/resolve/:id', checkAuth, async (req, res) => {
    const baseUrl = `${req.protocol}://${req.headers.host}`;
    const referer = req.get('Referer') || '/';
    const refererUrl = new URL(referer, baseUrl);

    try {
        const { id } = req.params;
        await pool.query(
            'UPDATE Alerts SET is_resolved = TRUE WHERE alert_id = $1',
            [id]
        );

        refererUrl.searchParams.set('success', 'Alert dismissed successfully!');
        res.redirect(refererUrl.pathname + refererUrl.search);

    } catch (error) {
        console.error("Error resolving alert:", error);
        refererUrl.searchParams.set('error', 'Could not resolve alert');
        res.redirect(refererUrl.pathname + refererUrl.search);
    }
});

// --- COMPANY COMMANDER DASHBOARD ROUTE ---
app.get("/cc-dashboard", checkAuth, checkRole(['CompanyCommander', 'CO']), setNoCache, async (req, res) => {

    try {
        // --- OVERRIDE LOGIC ---
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }
        // ---------------------

        const { rows: personnel } = await pool.query(
            `SELECT soldier_id, name, "rank", "status" FROM Soldiers WHERE company_id = $1 AND "status" = 'Active'`,
            [companyId]
        );
        const { rows: pendingLeaves } = await pool.query(
            "SELECT * FROM view_AllPendingLeaveRequests WHERE company_id = $1",
            [companyId]
        );
        const { rows: weapons } = await pool.query(
            `SELECT w.weapon_id, w.serial_number, w."type", s.name AS assigned_to, w."status"
             FROM Weapons w
             LEFT JOIN Soldiers s ON w.current_allocatee_id = s.soldier_id
             WHERE w.assigned_company_id = $1`,
            [companyId]
        );
        const { rows: alerts } = await pool.query(
            `SELECT a.* FROM view_ActiveAlerts a
             JOIN Weapons w ON a.related_entity_id = w.weapon_id
             WHERE a.related_entity_type = 'Weapon' AND w.assigned_company_id = $1`,
            [companyId]
        );
        const { rows: onLeave } = await pool.query(
            `SELECT COUNT(*) AS count FROM Leave_Records lr JOIN Soldiers s ON lr.soldier_id = s.soldier_id WHERE s.company_id = $1 AND lr."status" = 'Approved' AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date`,
            [companyId]
        );
        const { rows: company } = await pool.query("SELECT company_name FROM Companies WHERE company_id = $1", [companyId]);

        const stats = {
            postedStrength: personnel.length,
            onLeave: onLeave[0].count,
            pendingLeaves: pendingLeaves.length,
            serviceableWeapons: weapons.filter(w => w.status !== 'In-Repair').length,
            totalWeapons: weapons.length
        };

        res.render("cc-dashboard", {
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
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;

        const { rows } = await pool.query(
            `SELECT soldier_id, name, "rank", "status"
             FROM Soldiers
             WHERE company_id = $1
             AND "status" = 'Active'
             AND (name ILIKE $2 OR "rank" ILIKE $3 OR CAST(soldier_id AS TEXT) = $4)`,
            [companyId, searchPattern, searchPattern, searchTerm]
        );

        res.json(rows);

    } catch (error) {
        console.error("CC Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// API for Company Kote Search
app.get('/api/cc-search-weapons', checkAuth, checkRole(['CompanyCommander', 'CO', 'Company_Weapon_Incharge']), async (req, res) => {
    try {
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;

        const { rows } = await pool.query(
            `SELECT w.weapon_id, w.serial_number, w."type", w.model, s.name AS assigned_to, w."status"
             FROM Weapons w
             LEFT JOIN Soldiers s ON w.current_allocatee_id = s.soldier_id
             WHERE w.assigned_company_id = $1
             AND (w.serial_number ILIKE $2 OR w."type" ILIKE $3 OR s.name ILIKE $4 OR w.model ILIKE $5)`,
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
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }
        const { rows: company } = await pool.query("SELECT company_name FROM Companies WHERE company_id = $1", [companyId]);

        // 1. Get Rations for THIS company
        const { rows: rations } = await pool.query(
            `SELECT ration_id, item_name, quantity_kg, low_stock_threshold, lot_number,
                    TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f
             FROM Rations
             WHERE assigned_company_id = $1 AND quantity_kg > 0`,
            [companyId]
        );

        // 2. Get Alerts for Rations
        const { rows: alerts } = await pool.query(
            `SELECT a.alert_type, a.message, TO_CHAR(a.alert_date, 'DD-MM-YYYY') AS alert_date_f
             FROM Alerts a
             JOIN Rations r ON a.related_entity_id = r.ration_id
             WHERE a.related_entity_type = 'Ration' AND a.is_resolved = FALSE AND r.assigned_company_id = $1`,
            [companyId]
        );

        // 3. Get recent Ration Logs
        const { rows: rationLogs } = await pool.query(
            `SELECT rl.transaction_date, r.item_name, rl.transaction_type, rl.quantity_change, rl.remarks
             FROM Ration_Log rl
             JOIN Rations r ON rl.ration_id = r.ration_id
             WHERE rl.company_id = $1
             ORDER BY rl.transaction_date DESC LIMIT 20`,
            [companyId]
        );

        // 4. Calculate Stats
        const stats = {
            totalStock: rations.reduce((sum, r) => sum + parseFloat(r.quantity_kg), 0).toFixed(1),
            lowStockCount: rations.filter(r => r.quantity_kg < r.low_stock_threshold).length,
            expiringCount: alerts.filter(a => a.alert_type === 'Expiry').length
        };

        res.render("ration", {
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
    const { ration_id, quantity, remarks, transaction_type, redirect_company_id } = req.body;

    const qtyToConsume = parseFloat(quantity);
    const userId = req.session.user.id;

    let targetCompanyId = req.session.user.company_id;
    let redirectUrl = '/ration';

    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    if (qtyToConsume <= 0) return res.redirect(`${redirectUrl}${separator}error=Quantity must be positive.`);

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 2. Check stock
        const { rows } = await client.query('SELECT quantity_kg, item_name FROM Rations WHERE ration_id = $1 FOR UPDATE', [ration_id]);
        if (rows.length === 0 || rows[0].quantity_kg < qtyToConsume) {
            await client.query('ROLLBACK');
            return res.redirect(`${redirectUrl}${separator}error=Not enough stock available.`);
        }

        // 3. Subtract the quantity
        await client.query(
            'UPDATE Rations SET quantity_kg = quantity_kg - $1 WHERE ration_id = $2',
            [qtyToConsume, ration_id]
        );

        // 4. Log the transaction
        await client.query(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ration_id, targetCompanyId, transaction_type, -qtyToConsume, userId, remarks || transaction_type]
        );

        await client.query('COMMIT');
        res.redirect(`${redirectUrl}${separator}success=Transaction logged successfully!`);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error consuming rations:", error);
        res.redirect(`${redirectUrl}${separator}error=Server Error`);
    } finally {
        if (client) client.release();
    }
});

// POST /ration/revert - Returns stock from Company to Battalion
app.post('/ration/revert', checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), async (req, res) => {
    const { ration_id, quantity, remarks, redirect_company_id } = req.body;
    const qtyToReturn = parseFloat(quantity);
    const userId = req.session.user.id;

    let targetCompanyId = req.session.user.company_id;
    let redirectUrl = '/ration';

    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    if (qtyToReturn <= 0) return res.redirect(`${redirectUrl}${separator}error=Quantity must be positive.`);

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Get details of the company ration
        const { rows: rationRows } = await client.query(
            'SELECT * FROM Rations WHERE ration_id = $1 FOR UPDATE',
            [ration_id]
        );

        if (rationRows.length === 0 || rationRows[0].quantity_kg < qtyToReturn) {
            await client.query('ROLLBACK');
            return res.redirect(`${redirectUrl}${separator}error=Not enough stock to return.`);
        }

        const item = rationRows[0];

        // 2. Subtract from Company Stock
        await client.query(
            'UPDATE Rations SET quantity_kg = quantity_kg - $1 WHERE ration_id = $2',
            [qtyToReturn, ration_id]
        );

        // 3. Add back to Battalion Stock (upsert)
        await client.query(
            `INSERT INTO BattalionStock (item_name, lot_number, quantity_kg, expiry_date, low_stock_threshold)
             VALUES ($1, $2, $3, $4, 0)
             ON CONFLICT (item_name, lot_number)
             DO UPDATE SET quantity_kg = BattalionStock.quantity_kg + EXCLUDED.quantity_kg`,
            [item.item_name, item.lot_number, qtyToReturn, item.expiry_date]
        );

        // 4. Log the transaction
        await client.query(
            `INSERT INTO Ration_Log (ration_id, company_id, transaction_type, quantity_change, performed_by_id, remarks)
             VALUES ($1, $2, 'Returned_to_QM', $3, $4, $5)`,
            [ration_id, targetCompanyId, -qtyToReturn, userId, remarks || 'Returned to Battalion Store']
        );

        await client.query('COMMIT');
        res.redirect(`${redirectUrl}${separator}success=Stock returned to QM successfully!`);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Error reverting rations:", error);
        res.redirect(`${redirectUrl}${separator}error=Server Error`);
    } finally {
        if (client) client.release();
    }
});

// API route for Ration Reports
app.get('/api/ration-report', checkAuth, checkRole(['Company_Ration_Incharge', 'CO']), async (req, res) => {
    try {
        const { type } = req.query;
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        if (type === 'stock') {
            const { rows } = await pool.query(
                `SELECT item_name, quantity_kg, low_stock_threshold,
                        TO_CHAR(expiry_date, 'DD-MM-YYYY') AS expiry_date_f
                 FROM Rations
                 WHERE assigned_company_id = $1 AND quantity_kg > 0
                 ORDER BY item_name`,
                [companyId]
            );
            res.json({ reportType: 'stock', data: rows });

        } else if (type === 'ledger') {
            const { rows } = await pool.query(
                `SELECT r.item_name, rl.transaction_type, rl.quantity_change, rl.remarks,
                        TO_CHAR(rl.transaction_date, 'DD-MM-YYYY HH24:MI') AS date_f,
                        s.name AS soldier_name
                 FROM Ration_Log rl
                 JOIN Rations r ON rl.ration_id = r.ration_id
                 LEFT JOIN Soldiers s ON rl.performed_by_id = s.soldier_id
                 WHERE rl.company_id = $1
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
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const { rows: company } = await pool.query("SELECT company_name FROM Companies WHERE company_id = $1", [companyId]);

        // 1. Get all weapons for THIS company
        const { rows: weapons } = await pool.query(
            "SELECT * FROM view_CompanyArmsKote WHERE assigned_company_id = $1",
            [companyId]
        );

        // 2. Get the weapon issue log for THIS company
        const { rows: ledger } = await pool.query(
            `SELECT w.serial_number, s.name,
                    TO_CHAR(wil.date_issued, 'DD-MM-YYYY HH24:MI') AS date_issued_f,
                    TO_CHAR(wil.date_returned, 'DD-MM-YYYY HH24:MI') AS date_returned_f
             FROM Weapon_Issue_Log wil
             JOIN Weapons w ON wil.weapon_id = w.weapon_id
             JOIN Soldiers s ON wil.soldier_id = s.soldier_id
             WHERE w.assigned_company_id = $1
             ORDER BY wil.date_issued DESC LIMIT 50`,
            [companyId]
        );

        // 3. Get all soldiers in THIS company
        const { rows: soldiers } = await pool.query(
            `SELECT soldier_id, name, "rank" FROM Soldiers WHERE company_id = $1 AND "status" = 'Active'`,
            [companyId]
        );

        // 4. Get maintenance alerts for THIS company
        const { rows: alerts } = await pool.query(
            `SELECT a.*, w.serial_number FROM Alerts a
             JOIN Weapons w ON a.related_entity_id = w.weapon_id
             WHERE a.related_entity_type = 'Weapon' AND a.is_resolved = FALSE AND w.assigned_company_id = $1`,
            [companyId]
        );

        // 5. Get all *formally assigned* weapons
        const { rows: assignments } = await pool.query(
            `SELECT swa.weapon_id, w.serial_number, s.name, s.rank
             FROM Soldier_Weapon_Assignments swa
             JOIN Weapons w ON swa.weapon_id = w.weapon_id
             JOIN Soldiers s ON swa.soldier_id = s.soldier_id
             WHERE s.company_id = $1`,
            [companyId]
        );

        // 6. Get available ammunition
        const { rows: ammunition } = await pool.query(
            "SELECT * FROM Ammunition WHERE quantity > 0"
        );

        // 7. Get this company's ammo log
        const { rows: ammoLog } = await pool.query(
            `SELECT l.log_id, a.ammo_type, a.lot_number, s.name AS soldier_name, l.quantity_change,
                    TO_CHAR(l.transaction_date, 'DD-MM-YYYY HH24:MI') AS date_f
             FROM Ammunition_Log l
             JOIN Ammunition a ON l.ammo_id = a.ammo_id
             LEFT JOIN Soldiers s ON l.recipient_soldier_id = s.soldier_id
             WHERE l.recipient_company_id = $1 AND l.transaction_type IN ('Issued_to_Soldier', 'Returned_from_Soldier')
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

    const { weapon_id, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        await pool.query('CALL sp_AllocateWeaponToSoldier($1, $2, $3)', [weapon_id, soldier_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon allocated successfully!`);
    } catch (error) {
        console.error("Error allocating weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.message)}`);
    }
});

// POST /kote/assign - Handles the "Assign Weapon" form
app.post('/kote/assign', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        await pool.query('CALL sp_AssignWeaponToSoldier($1, $2, $3)', [soldier_id, weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon formally assigned successfully!`);
    } catch (error) {
        console.error("Error assigning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.message)}`);
    }
});

// POST /kote/return - Handles the "Return Weapon" form
app.post('/kote/return', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        await pool.query('CALL sp_ReturnWeapon($1, $2)', [weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon returned to kote successfully!`);
    } catch (error) {
        console.error("Error returning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.message)}`);
    }
});

// POST /kote/deassign - Handles the "De-assign Weapon" form
app.post('/kote/deassign', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        await pool.query('CALL sp_DeassignWeapon($1, $2)', [weapon_id, authorizerId]);
        res.redirect(`${redirectUrl}${separator}success=Weapon formally de-assigned successfully!`);
    } catch (error) {
        console.error("Error de-assigning weapon:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.message)}`);
    }
});

// GET /kote/deassign/:weapon_id - Handles the "De-assign" link
app.get('/kote/deassign/:weapon_id', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { weapon_id } = req.params;
    const authorizerId = req.session.user.id;

    try {
        await pool.query('CALL sp_DeassignWeapon($1, $2)', [weapon_id, authorizerId]);
        res.redirect('/kote?success=Weapon formally de-assigned successfully!');
    } catch (error) {
        console.error("Error de-assigning weapon:", error);
        res.redirect('/kote?error=' + encodeURIComponent(error.message));
    }
});

// POST /kote/update-maintenance/:id
app.post('/kote/update-maintenance/:id', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { id } = req.params;
    const { last_maintenance, next_maintenance, status, redirect_company_id } = req.body;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';

    try {
        await pool.query(
            'UPDATE Weapons SET last_maintenance = $1, next_maintenance = $2, "status" = $3 WHERE weapon_id = $4',
            [last_maintenance || null, next_maintenance || null, status, id]
        );
        res.redirect(`${redirectUrl}${separator}success=Weapon details updated successfully!`);
    } catch (error) {
        console.error("Error updating weapon maintenance/status:", error);
        res.redirect(`${redirectUrl}${separator}error=${encodeURIComponent(error.detail || error.message || 'A server error occurred.')}`);
    }
});

// POST /kote/issue-ammo - Calls the SP to issue ammo
app.post('/kote/issue-ammo', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { ammo_id, soldier_id, quantity, transaction_type, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;
    let targetCompanyId = req.session.user.company_id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    try {
        await pool.query(
            'CALL sp_IssueAmmoToSoldier($1, $2, $3, $4, $5, $6)',
            [ammo_id, soldier_id, quantity, authorizerId, targetCompanyId, transaction_type]
        );
        res.redirect(`${redirectUrl}${separator}success=Ammunition issued successfully!`);
    } catch (error) {
        console.error("Error issuing ammo:", error);
        res.redirect(`${redirectUrl}${separator}error=` + encodeURIComponent(error.message));
    }
});

// POST /kote/return-ammo - Calls the SP to return ammo
app.post('/kote/return-ammo', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    const { ammo_type, lot_number, quantity, soldier_id, redirect_company_id } = req.body;
    const authorizerId = req.session.user.id;
    let targetCompanyId = req.session.user.company_id;

    let redirectUrl = '/kote';
    if (req.session.user.role === 'CO' && redirect_company_id) {
        redirectUrl += `?company_id=${redirect_company_id}`;
        targetCompanyId = redirect_company_id;
    }
    const separator = redirectUrl.includes('?') ? '&' : '?';
    try {
        await pool.query(
            'CALL sp_ReturnAmmoFromSoldier($1, $2, $3, $4, $5, $6)',
            [ammo_type, lot_number, quantity, soldier_id, authorizerId, targetCompanyId]
        );
        res.redirect(`${redirectUrl}${separator}success=Ammunition returned to store!`);
    } catch (error) {
        console.error("Error returning ammo:", error);
        res.redirect(`${redirectUrl}${separator}error=` + encodeURIComponent(error.message));
    }
});

// --- API ROUTE for the Weapon Ledger Search ---
app.get('/api/kote/search-weapon-ledger', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const { rows } = await pool.query(
            `SELECT w.serial_number, s.name,
                    TO_CHAR(wil.date_issued, 'DD-MM-YYYY HH24:MI') AS date_issued_f,
                    TO_CHAR(wil.date_returned, 'DD-MM-YYYY HH24:MI') AS date_returned_f
             FROM Weapon_Issue_Log wil
             JOIN Weapons w ON wil.weapon_id = w.weapon_id
             JOIN Soldiers s ON wil.soldier_id = s.soldier_id
             WHERE w.assigned_company_id = $1
             AND (w.serial_number ILIKE $2 OR s.name ILIKE $3)
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
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const { rows } = await pool.query(
            `SELECT l.log_id, a.ammo_type, a.lot_number, s.name AS soldier_name, l.quantity_change,
                    TO_CHAR(l.transaction_date, 'DD-MM-YYYY HH24:MI') AS date_f
             FROM Ammunition_Log l
             JOIN Ammunition a ON l.ammo_id = a.ammo_id
             LEFT JOIN Soldiers s ON l.recipient_soldier_id = s.soldier_id
             WHERE l.recipient_company_id = $1
             AND l.transaction_type IN ('Issued_to_Soldier', 'Returned_from_Soldier')
             AND (s.name ILIKE $2 OR a.ammo_type ILIKE $3 OR a.lot_number ILIKE $4)
             ORDER BY l.transaction_date DESC`,
            [companyId, searchPattern, searchPattern, searchPattern]
        );
        res.json(rows);
    } catch (error) {
        console.error("Ammo Log Search API Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// API ROUTE for Weapon Assignment Search
app.get('/api/kote/search-assignments', checkAuth, checkRole(['Company_Weapon_Incharge', 'CO']), async (req, res) => {
    try {
        const searchTerm = req.query.term || '';
        const searchPattern = `%${searchTerm}%`;
        let companyId = req.session.user.company_id;
        if (req.session.user.role === 'CO' && req.query.company_id) {
            companyId = req.query.company_id;
        }

        const { rows } = await pool.query(
            `SELECT swa.weapon_id, w.serial_number, s.name, s.rank
             FROM Soldier_Weapon_Assignments swa
             JOIN Weapons w ON swa.weapon_id = w.weapon_id
             JOIN Soldiers s ON swa.soldier_id = s.soldier_id
             WHERE s.company_id = $1
             AND (w.serial_number ILIKE $2 OR s.name ILIKE $3 OR s.rank ILIKE $4)`,
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
        const { rows: dashboardRows } = await pool.query(
            'SELECT * FROM view_SoldierPersonalDashboard WHERE soldier_id = $1',
            [soldierId]
        );

        // 2. Fetch the soldier's leave history
        const { rows: leaveRows } = await pool.query(
            `SELECT TO_CHAR(start_date, 'DD-MM-YYYY') AS start_date_f,
                    TO_CHAR(end_date, 'DD-MM-YYYY') AS end_date_f,
                    leave_type, "status"
             FROM Leave_Records
             WHERE soldier_id = $1
             ORDER BY start_date DESC`,
            [soldierId]
        );

        // 3. Fetch alerts related to this soldier's assigned weapon
        const { rows: alertRows } = await pool.query(
            `SELECT a.alert_type, a.message, TO_CHAR(a.alert_date, 'DD-MM-YYYY') AS alert_date_f
             FROM Alerts a
             JOIN Soldier_Weapon_Assignments swa ON a.related_entity_id = swa.weapon_id
             WHERE a.related_entity_type = 'Weapon'
               AND swa.soldier_id = $1
               AND a.is_resolved = FALSE`,
            [soldierId]
        );

        res.render("soldier", {
            user: req.session.user,
            soldier: dashboardRows[0],
            leaveHistory: leaveRows,
            alerts: alertRows,
            error: req.query.error || null,
            success: req.query.success || null
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
            reason = 'as per leave plan';
        }

        // --- Business Logic: Check if soldier has enough leave ---
        const { rows: soldierData } = await pool.query('SELECT remaining_annual_leave, remaining_casual_leave FROM Soldiers WHERE soldier_id = $1', [soldierId]);

        // Calculate leave days (DATEDIFF equivalent in Postgres: date subtraction)
        const { rows: days } = await pool.query('SELECT (($1::date - $2::date) + 1) AS day_count', [end_date, start_date]);
        const leaveDays = days[0].day_count;

        if (leave_type === 'Annual' && leaveDays > soldierData[0].remaining_annual_leave) {
            return res.redirect("/soldier?error=Not enough annual leave");
        }

        if (leave_type === 'Casual' && leaveDays > soldierData[0].remaining_casual_leave) {
            return res.redirect("/soldier?error=Not enough casual leave");
        }

        // --- All checks passed, insert the leave record ---
        await pool.query(
            'INSERT INTO Leave_Records (soldier_id, start_date, end_date, leave_type, reason) VALUES ($1, $2, $3, $4, $5)',
            [soldierId, start_date, end_date, leave_type, reason]
        );

        res.redirect("/soldier?success=Leave application submitted!");

    } catch (error) {
        console.error("Error applying for leave:", error);
        res.redirect("/soldier?error=Server error");
    }
});

// POST route to handle the contact update form
app.post("/update-contact", checkAuth, checkRole(['Soldier', 'CO']), async (req, res) => {

    const { new_contact } = req.body;
    const soldierId = req.session.user.id;

    if (!new_contact || new_contact.trim() === '') {
        return res.redirect("/soldier?error=Contact number cannot be empty");
    }

    try {
        await pool.query(
            'UPDATE Soldiers SET contact = $1 WHERE soldier_id = $2',
            [new_contact, soldierId]
        );

        res.redirect("/soldier?success=Contact updated successfully!");

    } catch (error) {
        console.error("Error updating contact:", error);

        // Postgres unique-violation error code
        if (error.code === '23505') {
            return res.redirect("/soldier?error=This contact number is already in use.");
        }

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
        const { rows } = await pool.query('SELECT password_hash FROM Users WHERE soldier_id = $1', [soldierId]);
        const hashed_password = rows[0].password_hash;

        // 2. Securely compare the submitted password with the hash
        const isMatch = await bcrypt.compare(current_password, hashed_password);

        if (!isMatch) {
            return res.redirect("/soldier?error=Incorrect current password.");
        }

        // 3. Hash the *new* password before saving it
        const newHashedPassword = await bcrypt.hash(new_password, saltRounds);

        // 4. Store the new hash in the database
        await pool.query(
            'UPDATE Users SET password_hash = $1 WHERE soldier_id = $2',
            [newHashedPassword, soldierId]
        );

        res.redirect("/soldier?success=Password changed successfully!");

    } catch (error) {
        console.error("Error changing password:", error);
        res.redirect("/soldier?error=Server error");
    }
});

// Start the server
app.listen(PORT, function () {
    console.log(`ArmouryNet server started on port ${PORT}`);
});