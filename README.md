<div align="center">
  <h1>🪖 ArmouryNet</h1>
  <p><b>Battalion Inventory Management System</b></p>

  [![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
  [![EJS](https://img.shields.io/badge/EJS-B4CA65?style=for-the-badge&logo=ejs&logoColor=black)](https://ejs.co/)
  [![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)](https://www.mysql.com/)
  [![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)

  *ArmouryNet is a comprehensive, role-based web application designed to digitize and automate the logistical, personnel, and inventory management operations of a military battalion. It replaces manual registers with a centralized database, ensuring real-time tracking of weapons, ammunition, rations, vehicles, and personnel.*

</div>

---

## ✨ Key Features

* **Role-Based Access Control (RBAC):** Secure, dedicated dashboards for CO, Adjutant, Quartermaster (QM), MTO, Company Commanders, and Soldiers.
* **Personnel Management:** Track strength, leave records, and service details across the battalion.
* **Weapons (Kote) Management:** Track weapon assignments, maintenance schedules, and issue/return logs.
* **Logistics (QM) Management:** Centralized tracking of battalion rations, ammo batches (Lot No.), and fuel.
* **Transport (MTO) Management:** Vehicle fleet status, maintenance scheduling, and fuel logging.
* **Automated Alerts:** Triggers and Events automatically generate alerts for low stock, upcoming maintenance, and expiry dates.
* **Report Generation:** PDF export functionality for Roll Calls, Stock Ledgers, and Transaction Logs.

---

## 🛠️ Tech Stack

| Domain | Technologies |
|---|---|
| **Frontend** | EJS (Embedded JavaScript Templates), CSS3, Client-side JavaScript |
| **Backend** | Node.js, Express.js |
| **Database** | MySQL (via `mysql2` with connection pooling & transactions) |
| **Authentication** | Session-based auth with `bcrypt` password hashing |
| **PDF Generation** | `html2pdf.js` (Client-side) |

---

## 📂 Project Structure

```text
ArmouryNet/
├── public/
│   ├── css/
│   │   └── style.css            # Main stylesheet
│   └── images/                  # Static assets
│
├── views/
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
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites
* Node.js installed
* MySQL Server installed and running

### 1️⃣ Clone and Install
```bash
git clone https://github.com/Astic-x/ArmouryNet
cd ArmouryNet
npm install
```

### 2️⃣ Database Setup

Open your MySQL client (Workbench or Command Line) and run the `schema.sql` script to create the `battalion_inventory` database along with all tables, views, triggers, and stored procedures.

Then update `db.js` with your local MySQL credentials:

```javascript
// db.js
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',         // Your MySQL username
    password: '',         // Your MySQL password
    database: 'battalion_inventory',
});
```

### 3️⃣ Security Setup

Before running the app for the first time, hash the default passwords in the database:

```bash
node hashPasswords.js
```

This script updates all user passwords to the bcrypt hash for `pass123`.

### 4️⃣ Run the Application

```bash
node app.js
```

Access the application at 👉 **`http://localhost:3000`**

---

## 🔐 Default Credentials (for Testing)

All accounts default to password: **`pass123`** (after running the hasher script).

| Role | Username | Dashboard Route |
|---|---|---|
| Commanding Officer | `co.user` | `/co` |
| Adjutant | `adjutant.user` | `/adjutant` |
| Quartermaster | `qm.user` | `/qm` |
| MTO | `mto.user` | `/mto` |
| Company Commander | `cc.alpha` | `/cc-dashboard` |
| Weapon Incharge | `wi.alpha` | `/kote` |
| Ration Incharge | `ri.alpha` | `/ration` |
| Soldier | `soldier107` | `/soldier` |

---

## 🔗 Original Collaborative Repository

This project was built as a team effort. The original repository — containing the complete commit history and contributions from all four developers — is available here:

👉 **[Astic-x/ArmouryNet](https://github.com/Astic-x/ArmouryNet)**

> This repository is a personal fork maintained by [@SIDHARTH-PUNDIR](https://github.com/SIDHARTH-PUNDIR).

---

## 👥 Contributors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Astic-x">
        <img src="https://github.com/Astic-x.png" width="100px;" alt="Ankush Malik"/><br />
        <sub><b>Ankush Malik</b></sub>
      </a><br />
      <sub>Backend & RBAC System</sub>
    </td>
    <td align="center">
      <a href="https://github.com/vishalsingh21xyz">
        <img src="https://github.com/vishalsingh21xyz.png" width="100px;" alt="Vishal Vijay Singh"/><br />
        <sub><b>Vishal Vijay Singh</b></sub>
      </a><br />
      <sub>Frontend & EJS Templates</sub>
    </td>
    <td align="center">
      <a href="https://github.com/SIDHARTH-PUNDIR">
        <img src="https://github.com/SIDHARTH-PUNDIR.png" width="100px;" alt="Sidharth Pundir"/><br />
        <sub><b>Sidharth Pundir</b></sub>
      </a><br />
      <sub>Database & Stored Procedures</sub>
    </td>
    <td align="center">
      <a href="https://github.com/akshatbansal13">
        <img src="https://github.com/akshatbansal13.png" width="100px;" alt="Akshat Bansal"/><br />
        <sub><b>Akshat Bansal</b></sub>
      </a><br />
      <sub>Logistics & Transport Module</sub>
    </td>
  </tr>
</table>

<p align="center">
  <br>
  <i>Developed for academic and research purposes.</i>
</p>
