# ArmouryNet – Battalion Inventory Management System

ArmouryNet is a comprehensive, role-based web application designed to digitize and automate the logistical, personnel, and inventory management operations of a military battalion.

It replaces manual registers with a centralized database, ensuring real-time tracking of weapons, ammunition, rations, vehicles, and personnel.



## 🚀 Key Features

* **Role-Based Access Control (RBAC):** Secure dashboards for CO, Adjutant, Quartermaster (QM), MTO, Company Commanders, and Soldiers.
* **Personnel Management:** Track strength, leave records, and service details.
* **Weapons (Kote) Management:** Track weapon assignments, maintenance schedules, and issue/return logs.
* **Logistics (QM) Management:** Centralized tracking of battalion rations, ammo batches (Lot No.), and fuel.
* **Transport (MTO) Management:** Vehicle fleet status, maintenance scheduling, and fuel logging.
* **Automated Alerts:** Triggers and Events automatically generate alerts for low stock, upcoming maintenance, and expiry dates.
* **Report Generation:** PDF export functionality for Roll Calls, Stock Ledgers, and Transaction Logs.

## 🛠️ Tech Stack

* **Frontend:** EJS (Embedded JavaScript templates), CSS3, Client-side JavaScript.
* **Backend:** Node.js, Express.js.
* **Database:** MySQL (using `mysql2` for connection pooling and transactions).
* **Authentication:** Session-based auth with `bcrypt` password hashing.
* **PDF Generation:** `html2pdf.js` (Client-side).

## ⚙️ Installation & Setup

### 1. Prerequisites
* Node.js installed.
* MySQL Server installed and running.

### 2. Clone and Install
```bash
git clone [https://github.com/Astic-x/ArmouryNet](https://github.com/Astic-x/ArmouryNet)
cd armourynet
npm install
```

### 3. Database Setup

Open your MySQL Client (Workbench/Command Line).Run the schema.sql script (not included in repo, ensure you have the schema) to create the battalion_inventory database, tables, views, triggers, and stored procedures.
Update db.js with your local MySQL credentials:JavaScript backend/db.js
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root', // Your User
    password: 'your_password', // Your Password
    database: 'battalion_inventory',
    // ...
});


### 4. Security Setup
Before running the app for the first time, you must hash the default passwords in the database.
```bash
node hashPasswords.js
```

This script updates all user passwords to the default hash for pass123.5. 

Run the Application
```bash
node app.js
```

Access the application at http://localhost:3000.

🔐 Default Credentials (for Testing)All accounts default to password: pass123 (after running the hasher script).
Role                           Username             Dashboard Route
Commanding Officer              co.user                 /co
Adjutant                        adjutant.user           /adjutant
Quartermaster                   qm.user                 /qm
MTO                             mto.user                /mto
Company Commander               cc.alpha                /cc-dashboard
Weapon Incharge                 wi.alpha                /kote
Ration Incharge                 ri.alpha                /ration
Soldier                         soldier107              /soldier


### 📂 Project Structure
```Bash
ArmouryNet/
├── Public/
│   ├── css/
│   │   └── style.css            # Main stylesheet
│   └── images/                  # Static assets
│
├── Views/
│   ├── home.ejs                 # Landing page
│   ├── login.ejs                # Login page
│   ├── co.ejs                   # CO Dashboard
│   ├── qm.ejs                   # Quartermaster Dashboard
│   ├── mto.ejs                  # MTO Dashboard
│   ├── adjutant.ejs             # Adjutant Dashboard
│   ├── kote.ejs                 # Company Weapon Dashboard
│   ├── ration.ejs               # Company Ration Dashboard
│   └── soldier.ejs              # Soldier Dashboard
│
├── hashPasswords.js             # Utility script for hashing passwords
├── app.js                       # Main server entry point
├── db.js                        # Database connection pool
├── .gitignore
├── package.json
└── README
```

### Next Steps

Once you have saved these files, you can initialize your git repository:

```bash
git init
git add .
git commit -m "Initial commit: ArmouryNet functional build"
```