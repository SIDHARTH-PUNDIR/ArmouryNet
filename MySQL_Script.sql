
--         FINAL SCRIPT


-- SECTION 0: DATABASE SETUP


CREATE DATABASE IF NOT EXISTS battalion_inventory;
USE battalion_inventory;


-- SECTION 1: TABLE CREATION


CREATE TABLE Companies (
    company_id INT PRIMARY KEY AUTO_INCREMENT,
    company_name VARCHAR(100) NOT NULL UNIQUE,
    company_commander_id INT NOT NULL
);

CREATE TABLE Soldiers (
    soldier_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    `rank` VARCHAR(50) NOT NULL,
    dob DATE,
    contact VARCHAR(20) UNIQUE,
    company_id INT NOT NULL,
    `status` ENUM('Active', 'On Leave', 'Discharged') NOT NULL DEFAULT 'Active',
    total_annual_leave INT DEFAULT 30,
    remaining_annual_leave INT,
    total_casual_leave INT DEFAULT 15,
    remaining_casual_leave INT,
    CONSTRAINT fk_soldiers_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
);

ALTER TABLE Companies
ADD CONSTRAINT fk_companies_commander FOREIGN KEY (company_commander_id) REFERENCES Soldiers(soldier_id);

CREATE TABLE Users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    soldier_id INT NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    `role` ENUM('CO', 'Adjutant', 'QM', 'CompanyCommander', 'MTO', 'MT_JCO', 'Company_Weapon_Incharge', 'Battalion_Ammo_Incharge', 'Company_Ration_Incharge', 'Fuel_NCO', 'Soldier') NOT NULL,
    CONSTRAINT fk_users_soldier FOREIGN KEY (soldier_id) REFERENCES Soldiers(soldier_id)
);

CREATE TABLE Weapons (
    weapon_id INT PRIMARY KEY AUTO_INCREMENT,
    serial_number VARCHAR(100) NOT NULL UNIQUE,
    `type` VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    assigned_company_id INT NOT NULL,
    `status` ENUM('In-Store', 'Issued', 'In-Repair') DEFAULT 'In-Store',
    current_allocatee_id INT,
    last_maintenance DATE,
    next_maintenance DATE,
    CONSTRAINT fk_weapons_company FOREIGN KEY (assigned_company_id) REFERENCES Companies(company_id),
    CONSTRAINT fk_weapons_allocatee FOREIGN KEY (current_allocatee_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT chk_weapon_maintenance_dates CHECK (next_maintenance IS NULL OR last_maintenance IS NULL OR next_maintenance > last_maintenance)
);

CREATE TABLE Soldier_Weapon_Assignments (
    assignment_id INT PRIMARY KEY AUTO_INCREMENT,
    soldier_id INT NOT NULL,
    weapon_id INT NOT NULL UNIQUE,
    assignment_date DATE DEFAULT (CURDATE()),
    CONSTRAINT fk_assignment_soldier FOREIGN KEY (soldier_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT fk_assignment_weapon FOREIGN KEY (weapon_id) REFERENCES Weapons(weapon_id)
);

CREATE TABLE Weapon_Issue_Log (
    issue_id INT PRIMARY KEY AUTO_INCREMENT,
    weapon_id INT NOT NULL,
    soldier_id INT NOT NULL,
    issued_by_id INT NULL,
    date_issued DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_returned DATETIME,
    CONSTRAINT fk_issuelog_weapon FOREIGN KEY (weapon_id) REFERENCES Weapons(weapon_id),
    CONSTRAINT fk_issuelog_soldier FOREIGN KEY (soldier_id) REFERENCES Soldiers(soldier_id)
);

CREATE TABLE Ammunition (
    ammo_id INT PRIMARY KEY AUTO_INCREMENT,
    ammo_type VARCHAR(100) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    lot_number VARCHAR(100),
    expiry_date DATE,
    low_stock_threshold INT NOT NULL DEFAULT 0,
    CONSTRAINT chk_ammo_quantity CHECK (quantity >= 0)
);

CREATE TABLE Weapon_Ammo_Compatibility (
    weapon_type VARCHAR(100),
    ammo_type VARCHAR(100),
    PRIMARY KEY (weapon_type, ammo_type)
);



CREATE TABLE Ammunition_Log (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    ammo_id INT NOT NULL,
    transaction_type ENUM('Received', 'Issued_Training', 'Issued_Operational', 'Returned', 'Expended', 'Audit_Correction','Issued_to_Company', 'Returned_from_Company',
    'Issued_to_Soldier', 'Returned_from_Soldier') NOT NULL,
    quantity_change INT NOT NULL,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    authorizing_officer_id INT NOT NULL,
    recipient_company_id INT,
    recipient_soldier_id INT,
    remarks TEXT,
    CONSTRAINT fk_ammolog_ammo FOREIGN KEY (ammo_id) REFERENCES Ammunition(ammo_id),
    CONSTRAINT fk_ammolog_authorizer FOREIGN KEY (authorizing_officer_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT fk_ammolog_company FOREIGN KEY (recipient_company_id) REFERENCES Companies(company_id),
    CONSTRAINT fk_ammolog_soldier FOREIGN KEY (recipient_soldier_id) REFERENCES Soldiers(soldier_id)
);


CREATE TABLE BattalionStock (
    stock_id INT PRIMARY KEY AUTO_INCREMENT,
    item_name VARCHAR(255) NOT NULL,
    lot_number VARCHAR(100) NOT NULL,
    quantity_kg DECIMAL(10, 2) NOT NULL DEFAULT 0,
    expiry_date DATE,
    low_stock_threshold DECIMAL(10, 2) NOT NULL DEFAULT 0,
    CONSTRAINT chk_battalion_stock_qty CHECK (quantity_kg >= 0),
    UNIQUE KEY `uq_item_lot` (`item_name`, `lot_number`) -- Prevent duplicate lots
);

CREATE TABLE Rations (
    ration_id INT PRIMARY KEY AUTO_INCREMENT,
    item_name VARCHAR(255) NOT NULL,
    lot_number VARCHAR(100) NOT NULL,
    assigned_company_id INT NOT NULL,
    quantity_kg DECIMAL(10, 2) NOT NULL,
    low_stock_threshold DECIMAL(10, 2) NOT NULL DEFAULT 0,
    expiry_date DATE,
    CONSTRAINT fk_rations_company FOREIGN KEY (assigned_company_id) REFERENCES Companies(company_id),
    CONSTRAINT chk_ration_quantity CHECK (quantity_kg >= 0),
    UNIQUE KEY `uq_item_lot_company` (`item_name`, `lot_number`, `assigned_company_id`)
);


CREATE TABLE Ration_Log (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    ration_id INT NOT NULL,
    company_id INT NOT NULL,
    transaction_type ENUM('Received_from_QM', 'Consumed_Daily', 'Spoilage/Waste','Returned_to_QM' ) NOT NULL,
    quantity_change DECIMAL(10, 2) NOT NULL, -- Negative for consumption, Positive for receiving
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    performed_by_id INT, -- The soldier ID of the incharge
    remarks TEXT,
    CONSTRAINT fk_rationlog_item FOREIGN KEY (ration_id) REFERENCES Rations(ration_id) ON DELETE CASCADE,
    CONSTRAINT fk_rationlog_company FOREIGN KEY (company_id) REFERENCES Companies(company_id)
);

CREATE TABLE Military_Transport (
    mt_id INT PRIMARY KEY AUTO_INCREMENT,
    vehicle_number VARCHAR(50) NOT NULL UNIQUE,
    `type` VARCHAR(100),
    model VARCHAR(100),
    odometer_reading INT NOT NULL DEFAULT 0 COMMENT 'Current (latest) odometer reading in km',
    driver_id INT,
    `status` ENUM('Operational', 'On-Duty', 'In-Repair') DEFAULT 'Operational',
    last_maintenance DATE,
    next_maintenance DATE,
    CONSTRAINT fk_mt_driver FOREIGN KEY (driver_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT chk_mt_maintenance_dates CHECK (next_maintenance IS NULL OR last_maintenance IS NULL OR next_maintenance > last_maintenance)
);

CREATE TABLE Fuel_Lubricants (
    fuel_id INT PRIMARY KEY AUTO_INCREMENT,
    fuel_type VARCHAR(100) NOT NULL UNIQUE,
    quantity_liters DECIMAL(10, 2) NOT NULL,
    low_stock_threshold DECIMAL(10, 2) NOT NULL DEFAULT 0,
    CONSTRAINT chk_fuel_quantity CHECK (quantity_liters >= 0)
);

CREATE TABLE MT_Fuel_Log (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    mt_id INT NOT NULL,
    fuel_id INT NOT NULL,
    quantity_drawn DECIMAL(10, 2) NOT NULL,
    odometer_reading INT NULL,
    date_drawn DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fuellog_mt FOREIGN KEY (mt_id) REFERENCES Military_Transport(mt_id),
    CONSTRAINT fk_fuellog_fuel FOREIGN KEY (fuel_id) REFERENCES Fuel_Lubricants(fuel_id)
);

CREATE TABLE Leave_Records (
    leave_id INT PRIMARY KEY AUTO_INCREMENT,
    soldier_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    leave_type ENUM('Annual', 'Casual') NOT NULL,
    reason TEXT NULL,
    `status` ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    approved_by_id INT,
    CONSTRAINT fk_leave_soldier FOREIGN KEY (soldier_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT fk_leave_approver FOREIGN KEY (approved_by_id) REFERENCES Soldiers(soldier_id),
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE TABLE Alerts (
    alert_id INT PRIMARY KEY AUTO_INCREMENT,
    alert_type ENUM('Low Stock', 'Expiry', 'Maintenance Due') NOT NULL,
    related_entity_id INT NOT NULL,
    related_entity_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    alert_date DATE DEFAULT (CURDATE()),
    is_resolved BOOLEAN DEFAULT FALSE
);


-- SECTION 2: VIEWS 


CREATE OR REPLACE VIEW view_CompanyReadinessStatus AS
SELECT
    s.soldier_id,
    s.name,
    s.`rank`,
    c.company_name,
    w.serial_number,
    w.model AS weapon_model
FROM
    Soldiers s
JOIN
    Companies c ON s.company_id = c.company_id
LEFT JOIN
    Weapons w ON s.soldier_id = w.current_allocatee_id
WHERE
    w.`status` = 'Issued';


CREATE OR REPLACE VIEW view_UpcomingMaintenance AS
SELECT
    'Weapon' AS item_type,
    serial_number AS identifier,
    DATE_FORMAT(next_maintenance, '%d-%m-%Y') AS next_maintenance_date
FROM
    Weapons
WHERE
    next_maintenance BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY
UNION ALL
SELECT
    'Vehicle' AS item_type,
    vehicle_number AS identifier,
    DATE_FORMAT(next_maintenance, '%d-%m-%Y') AS next_maintenance_date
FROM
    Military_Transport
WHERE
    next_maintenance BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY;


CREATE OR REPLACE VIEW view_BattalionMasterInventory AS
SELECT
    -- Force the string 'Weapons' to use standard unicode collation
    _utf8mb4'Weapons' COLLATE utf8mb4_unicode_ci AS category,
    COUNT(*) AS total_items,
    SUM(CASE WHEN `status` = 'In-Store' THEN 1 ELSE 0 END) AS serviceable_count
FROM
    Weapons
UNION ALL
SELECT
    _utf8mb4'Ammunition' COLLATE utf8mb4_unicode_ci AS category,
    IFNULL(SUM(quantity), 0), -- Handle case where table is empty
    NULL
FROM
    Ammunition
UNION ALL
SELECT
    _utf8mb4'Vehicles' COLLATE utf8mb4_unicode_ci AS category,
    COUNT(*) AS total_items,
    SUM(CASE WHEN `status` = 'Operational' THEN 1 ELSE 0 END) AS serviceable_count
FROM
    Military_Transport;


CREATE OR REPLACE VIEW view_ActiveAlerts AS
SELECT
    alert_id,
    alert_type,
    message,
    DATE_FORMAT(alert_date, '%d-%m-%Y') AS alert_date_formatted,
    related_entity_type,
    related_entity_id
FROM
    Alerts
WHERE
    is_resolved = FALSE;
    
    

CREATE OR REPLACE VIEW view_AllLeaveRecords AS
SELECT
    lr.leave_id, s.soldier_id, s.name AS soldier_name,
    s.`rank`, c.company_name,
    DATE_FORMAT(lr.start_date, '%d-%m-%Y') AS start_date_formatted,
    DATE_FORMAT(lr.end_date, '%d-%m-%Y') AS end_date_formatted,
    lr.leave_type,
    lr.reason, -- <-- ADDED THIS LINE
    lr.`status`
FROM
    Leave_Records lr
JOIN
    Soldiers s ON lr.soldier_id = s.soldier_id
JOIN
    Companies c ON s.company_id = c.company_id;



CREATE OR REPLACE VIEW view_AllPendingLeaveRequests AS
SELECT
    lr.leave_id,
    s.soldier_id,
    s.name AS soldier_name,
    s.`rank`,
    c.company_name,
    s.company_id, 
    DATE_FORMAT(lr.start_date, '%d-%m-%Y') AS start_date_formatted,
    DATE_FORMAT(lr.end_date, '%d-%m-%Y') AS end_date_formatted,
    lr.leave_type,
    lr.reason
FROM
    Leave_Records lr
JOIN
    Soldiers s ON lr.soldier_id = s.soldier_id
JOIN
    Companies c ON s.company_id = c.company_id
WHERE
    lr.`status` = 'Pending';


    
    
CREATE OR REPLACE VIEW view_RollCallReport AS
SELECT
    s.soldier_id,
    s.name,
    s.`rank`,
    c.company_id,
    c.company_name,
    
    -- Column 1: Attendance Status
    CASE
        WHEN lr.leave_id IS NOT NULL THEN 'On Leave'
        ELSE 'Present'
    END AS attendance_status,
    
    -- Column 2: Assigned Weapon Serial Number
    w.serial_number AS assigned_weapon_sn,
    
    -- Column 3: Weapon Readiness Status
    CASE
        WHEN swa.weapon_id IS NULL THEN 'N/A' -- Not applicable (no weapon assigned)
        WHEN w.status = 'Issued' AND w.current_allocatee_id = s.soldier_id THEN 'With Soldier'
        WHEN w.status = 'Issued' AND w.current_allocatee_id != s.soldier_id THEN 'Issued to Other'
        WHEN w.status = 'In-Store' THEN 'In-Store'
        WHEN w.status = 'In-Repair' THEN 'In-Repair'
        ELSE 'N/A'
    END AS weapon_status
FROM
    Soldiers s
JOIN
    Companies c ON s.company_id = c.company_id
LEFT JOIN
    Leave_Records lr ON s.soldier_id = lr.soldier_id
                     AND lr.`status` = 'Approved'
                     AND CURDATE() BETWEEN lr.start_date AND lr.end_date
LEFT JOIN
    Soldier_Weapon_Assignments swa ON s.soldier_id = swa.soldier_id
LEFT JOIN
    Weapons w ON swa.weapon_id = w.weapon_id
WHERE
    s.`status` = 'Active'; -- Only show Active soldiers
    
    





CREATE OR REPLACE VIEW view_MTO_Dashboard AS
SELECT
    mt.mt_id,
    mt.vehicle_number,
    mt.model,
    mt.odometer_reading, -- <-- THIS IS THE NEWLY ADDED COLUMN
    mt.`status`,
    DATE_FORMAT(mt.next_maintenance, '%d-%m-%Y') AS next_maintenance_date,
    s.name AS driver_name
FROM
    Military_Transport mt
LEFT JOIN
    Soldiers s ON mt.driver_id = s.soldier_id;


CREATE OR REPLACE VIEW view_BattalionPersonnelOverview AS
SELECT
    c.company_name,
    COUNT(s.soldier_id) AS total_strength,
    SUM(CASE WHEN s.`rank` IN ('Lieutenant Colonel', 'Major', 'Captain', 'Lieutenant') THEN 1 ELSE 0 END) AS officers,
    SUM(CASE WHEN s.`rank` IN ('Subedar Major', 'Subedar', 'Naib Subedar') THEN 1 ELSE 0 END) AS jcos,
    SUM(CASE WHEN s.`rank` IN ('Havildar', 'Naik', 'Sepoy') THEN 1 ELSE 0 END) AS other_ranks
FROM
    Companies c
JOIN
    Soldiers s ON c.company_id = s.company_id
GROUP BY
    c.company_name;


CREATE OR REPLACE VIEW view_QMMasterLogisticsLedger AS
SELECT
    -- We force the collation on the new text columns we are creating
    _utf8mb4'Weapon' COLLATE utf8mb4_unicode_ci AS asset_category,
    w.weapon_id AS asset_id,
    w.serial_number,
    w.model,
    w.`status`,
    c.company_name AS assigned_to,
    DATE_FORMAT(w.next_maintenance, '%d-%m-%Y') AS next_maintenance_date
FROM
    Weapons w
JOIN
    Companies c ON w.assigned_company_id = c.company_id
UNION ALL
SELECT
    _utf8mb4'Vehicle' COLLATE utf8mb4_unicode_ci AS asset_category,
    mt.mt_id AS asset_id,
    mt.vehicle_number,
    mt.model,
    mt.`status`,
    _utf8mb4'Battalion' COLLATE utf8mb4_unicode_ci AS assigned_to,
    DATE_FORMAT(mt.next_maintenance, '%d-%m-%Y') AS next_maintenance_date
FROM
    Military_Transport mt;


CREATE OR REPLACE VIEW view_CompanyArmsKote AS
SELECT
    w.assigned_company_id,
    c.company_name,
    w.weapon_id,
    w.serial_number,
    w.model,
    w.`type`, -- <-- THIS IS THE MISSING LINE
    w.`status`,
    s.name AS allocated_to
FROM
    Weapons w
JOIN
    Companies c ON w.assigned_company_id = c.company_id
LEFT JOIN
    Soldiers s ON w.current_allocatee_id = s.soldier_id;

CREATE OR REPLACE VIEW view_SoldierPersonalDashboard AS
SELECT
    s.soldier_id, s.name, s.`rank`, s.company_id, c.company_name,
    DATE_FORMAT(s.dob, '%d-%m-%Y') AS dob,
    s.contact,
    s.remaining_annual_leave, s.remaining_casual_leave,
    w.serial_number AS allocated_weapon_sn,
    w.model AS allocated_weapon_model,
    s.`status` -- Also include the new status column
FROM
    Soldiers s
JOIN
    Companies c ON s.company_id = c.company_id
LEFT JOIN
    Weapons w ON s.soldier_id = w.current_allocatee_id AND w.`status` = 'Issued'
WHERE
    s.`status` = 'Active'; -- This view now only shows Active soldiers


-- SECTION 3: STORED PROCEDURES


DELIMITER $$

CREATE PROCEDURE sp_AssignWeaponToSoldier(IN p_soldier_id INT, IN p_weapon_id INT, IN p_authorizer_id INT)
BEGIN
    DECLARE v_authorizer_role ENUM('CO', 'Adjutant', 'QM', 'CompanyCommander', 'MTO', 'MT_JCO', 'Company_Weapon_Incharge', 'Battalion_Ammo_Incharge', 'Company_Ration_Incharge', 'Fuel_NCO', 'Soldier');
    DECLARE v_authorizer_company_id INT;
    DECLARE v_soldier_company_id INT;
    DECLARE v_weapon_type VARCHAR(100);
    DECLARE v_type_count INT;
    DECLARE v_authority_granted BOOLEAN DEFAULT FALSE;
    SELECT u.`role`, s.company_id INTO v_authorizer_role, v_authorizer_company_id FROM Users u JOIN Soldiers s ON u.soldier_id = s.soldier_id WHERE u.soldier_id = p_authorizer_id;
    SELECT company_id INTO v_soldier_company_id FROM Soldiers WHERE soldier_id = p_soldier_id;
    IF v_authorizer_role IN ('CO', 'QM') THEN
        SET v_authority_granted = TRUE;
    ELSEIF v_authorizer_role IN ('CompanyCommander', 'Company_Weapon_Incharge') THEN
        IF v_authorizer_company_id = v_soldier_company_id THEN
            SET v_authority_granted = TRUE;
        END IF;
    END IF;
    IF v_authority_granted THEN
        SELECT `type` INTO v_weapon_type FROM Weapons WHERE weapon_id = p_weapon_id;
        SELECT COUNT(*) INTO v_type_count FROM Soldier_Weapon_Assignments swa JOIN Weapons w ON swa.weapon_id = w.weapon_id WHERE swa.soldier_id = p_soldier_id AND w.`type` = v_weapon_type;
        IF v_type_count > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: Soldier is already assigned a weapon of this type.';
        ELSE
            INSERT INTO Soldier_Weapon_Assignments (soldier_id, weapon_id) VALUES (p_soldier_id, p_weapon_id);
        END IF;
    ELSE
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: You do not have the required authority to perform this assignment.';
    END IF;
END$$


CREATE PROCEDURE sp_AllocateWeaponToSoldier(
    IN p_weapon_id INT, 
    IN p_soldier_id INT, 
    IN p_authorizer_id INT
)
BEGIN
    DECLARE v_weapon_status VARCHAR(50);
    DECLARE v_soldier_has_weapon INT;
    DECLARE v_assigned_soldier_id INT;
    DECLARE v_assigned_soldier_name VARCHAR(100);

    -- 1. CHECK: Is the weapon physically available?
    SELECT `status` INTO v_weapon_status
    FROM Weapons
    WHERE weapon_id = p_weapon_id;

    IF v_weapon_status != 'In-Store' THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Error: This weapon is not in the kote (It is Issued or In-Repair).';
    END IF;

    -- 2. CHECK: Does the receiver already have a weapon?
    SELECT COUNT(*) INTO v_soldier_has_weapon
    FROM Weapons
    WHERE current_allocatee_id = p_soldier_id AND `status` = 'Issued';

    IF v_soldier_has_weapon > 0 THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Error: This soldier already holds a weapon. Return it first.';
    END IF;

    -- 3. CHECK (NEW): Is this weapon formally assigned to someone else?
    -- We look up who "owns" this weapon in the assignment table
    SELECT s.soldier_id, s.name 
    INTO v_assigned_soldier_id, v_assigned_soldier_name
    FROM Soldier_Weapon_Assignments swa
    JOIN Soldiers s ON swa.soldier_id = s.soldier_id
    WHERE swa.weapon_id = p_weapon_id
    LIMIT 1;

    -- If it is assigned to someone, AND that someone is NOT the person trying to take it...
    IF v_assigned_soldier_id IS NOT NULL AND v_assigned_soldier_id != p_soldier_id THEN
        -- BLOCK THE ISSUE
        SET @error_msg = CONCAT('Error: This weapon is assigned to ', v_assigned_soldier_name, '. You cannot issue it to another soldier.');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @error_msg;
    END IF;

    -- 4. If all checks pass, EXECUTE ISSUE
    UPDATE Weapons
    SET current_allocatee_id = p_soldier_id, `status` = 'Issued'
    WHERE weapon_id = p_weapon_id;

    -- 5. LOG TRANSACTION
    INSERT INTO Weapon_Issue_Log (weapon_id, soldier_id, issued_by_id, date_issued)
    VALUES (p_weapon_id, p_soldier_id, p_authorizer_id, CURRENT_TIMESTAMP);

END$$



CREATE PROCEDURE sp_RegisterNewSoldier(IN p_name VARCHAR(255), IN p_rank VARCHAR(50), IN p_dob DATE, IN p_contact VARCHAR(20), IN p_company_id INT, IN p_username VARCHAR(255), IN p_password VARCHAR(255))
BEGIN
    DECLARE v_soldier_id INT;
    INSERT INTO Soldiers (name, `rank`, dob, contact, company_id, remaining_annual_leave, remaining_casual_leave) VALUES (p_name, p_rank, p_dob, p_contact, p_company_id, 30, 15);
    SET v_soldier_id = LAST_INSERT_ID();
    INSERT INTO Users (soldier_id, username, password_hash, `role`) VALUES (v_soldier_id, p_username, p_password, 'Soldier');
END$$




-- This procedure handles the PHYSICAL return of a weapon
CREATE PROCEDURE sp_ReturnWeapon(IN p_weapon_id INT, IN p_authorizer_id INT)
BEGIN
    DECLARE v_soldier_id INT;

    -- 1. Find out who is returning the weapon
    SELECT current_allocatee_id INTO v_soldier_id
    FROM Weapons
    WHERE weapon_id = p_weapon_id AND `status` = 'Issued';

    -- 2. If the weapon is not 'Issued', throw an error
    IF v_soldier_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: This weapon is not currently issued to anyone.';
    END IF;

    -- 3. Update the weapon's status to 'In-Store'
    UPDATE Weapons
    SET `status` = 'In-Store', current_allocatee_id = NULL
    WHERE weapon_id = p_weapon_id;

    -- 4. Update the log by setting the 'date_returned'
    UPDATE Weapon_Issue_Log
    SET date_returned = CURRENT_TIMESTAMP
    WHERE weapon_id = p_weapon_id AND soldier_id = v_soldier_id AND date_returned IS NULL;
    
END$$

-- This procedure handles the FORMAL de-assignment of a weapon
CREATE PROCEDURE sp_DeassignWeapon(IN p_weapon_id INT, IN p_authorizer_id INT)
BEGIN
    DECLARE v_status ENUM('In-Store', 'Issued', 'In-Repair');

    -- 1. Check the weapon's physical status
    SELECT `status` INTO v_status
    FROM Weapons
    WHERE weapon_id = p_weapon_id;

    -- 2. SAFETY CHECK: Block de-assignment if the weapon is physically issued
    IF v_status = 'Issued' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: Cannot de-assign. Weapon is still physically issued. Return it first.';
    END IF;

    -- 3. If safe, delete the formal assignment link
    DELETE FROM Soldier_Weapon_Assignments
    WHERE weapon_id = p_weapon_id;
END$$



-- This is the new, corrected procedure for ISSUING ammo
CREATE PROCEDURE sp_IssueAmmoToSoldier(
    IN p_ammo_id INT,
    IN p_soldier_id INT,
    IN p_quantity INT,
    IN p_authorizer_id INT,
    IN p_company_id INT,
    IN p_transaction_type VARCHAR(50)
)
BEGIN
    DECLARE v_current_stock INT;
    DECLARE v_weapon_model VARCHAR(100); -- Changed variable name for clarity
    DECLARE v_ammo_type VARCHAR(100);
    DECLARE v_is_compatible INT;

    -- 1. Get the soldier's currently issued weapon MODEL (not type)
    -- We use 'model' because that is what determines ammo compatibility
    SELECT `model` INTO v_weapon_model
    FROM Weapons
    WHERE current_allocatee_id = p_soldier_id AND `status` = 'Issued'
    LIMIT 1;

    -- Validation: Does the soldier have a weapon?
    IF v_weapon_model IS NULL THEN
        SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = 'Error: Soldier does not have a weapon issued. Cannot issue ammo.';
    END IF;

    -- 2. Get the type of ammo being issued
    SELECT ammo_type, quantity INTO v_ammo_type, v_current_stock
    FROM Ammunition
    WHERE ammo_id = p_ammo_id
    FOR UPDATE;

    -- Validation: Is there enough stock?
    IF v_current_stock < p_quantity THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: Not enough ammo stock.';
    END IF;

    -- 3. Validation: Is the ammo compatible with the weapon?
    SELECT COUNT(*) INTO v_is_compatible
    FROM Weapon_Ammo_Compatibility
    WHERE weapon_type = v_weapon_model AND ammo_type = v_ammo_type;

    IF v_is_compatible = 0 THEN
        SET @error_msg = CONCAT('Error: Incompatible Ammo. ', v_ammo_type, ' cannot be used with ', v_weapon_model);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @error_msg;
    END IF;

    -- 4. Execute the Issue (Subtract Stock)
    UPDATE Ammunition
    SET quantity = quantity - p_quantity
    WHERE ammo_id = p_ammo_id;

    -- 5. Log the Transaction
    INSERT INTO Ammunition_Log (
        ammo_id, transaction_type, quantity_change, 
        authorizing_officer_id, recipient_company_id, recipient_soldier_id, remarks
    )
    VALUES (
        p_ammo_id, p_transaction_type, -p_quantity, 
        p_authorizer_id, p_company_id, p_soldier_id, 
        CONCAT('Issued for ', v_weapon_model)
    );

END$$


-- This is the new, corrected procedure for RETURNING ammo
CREATE PROCEDURE sp_ReturnAmmoFromSoldier(
    IN p_ammo_type VARCHAR(100),
    IN p_lot_number VARCHAR(100),
    IN p_quantity INT,
    IN p_soldier_id INT,
    IN p_authorizer_id INT,
    IN p_company_id INT
)
BEGIN
    DECLARE v_ammo_id INT;

    -- This procedure ONLY inserts a log. The trigger will do the math.

    -- 1. Find the ammo_id for the item being returned
    SELECT ammo_id INTO v_ammo_id
    FROM Ammunition
    WHERE ammo_type = p_ammo_type AND lot_number = p_lot_number
    LIMIT 1;
    
    IF v_ammo_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Return failed. No such ammo/lot exists in the central store.';
    END IF;

    -- 2. Log the transaction. The trigger will fire after this.
    INSERT INTO Ammunition_Log (
        ammo_id, transaction_type, quantity_change, 
        authorizing_officer_id, recipient_company_id, recipient_soldier_id, remarks
    )
    VALUES (
        v_ammo_id, 
        'Returned_from_Soldier', 
        p_quantity, -- Pass the positive number
        p_authorizer_id, 
        p_company_id, 
        p_soldier_id, 
        CONCAT('Returned by Company ', p_company_id)
    );
END$$



CREATE PROCEDURE sp_RunDailyChecks()
BEGIN
    -- Declare variables to hold item details while looping
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_item_id INT;
    DECLARE v_item_type VARCHAR(100);
    DECLARE v_extra_info VARCHAR(100); -- Reused for lot_number, etc.
    DECLARE v_check_date DATE;

    -- --- CURSORS for all checks ---
    DECLARE cur_expired_ammo CURSOR FOR 
        SELECT ammo_id, ammo_type, lot_number, expiry_date 
        FROM Ammunition WHERE expiry_date <= CURDATE();
        
    DECLARE cur_expired_rations CURSOR FOR 
        SELECT ration_id, item_name, assigned_company_id, expiry_date 
        FROM Rations WHERE expiry_date <= CURDATE();
        
    DECLARE cur_expired_battalion_stock CURSOR FOR 
        SELECT stock_id, item_name, lot_number, expiry_date 
        FROM BattalionStock WHERE expiry_date <= CURDATE();
        
    DECLARE cur_maintenance_weapons CURSOR FOR 
        SELECT weapon_id, `type`, serial_number, next_maintenance 
        FROM Weapons WHERE next_maintenance BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY;
        
    DECLARE cur_maintenance_mt CURSOR FOR 
        SELECT mt_id, `type`, vehicle_number, next_maintenance 
        FROM Military_Transport WHERE next_maintenance BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY;

    -- Declare a handler to exit loops
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- --- 1. Process Expired Ammunition ---
    OPEN cur_expired_ammo;
    ammo_loop: LOOP
        FETCH cur_expired_ammo INTO v_item_id, v_item_type, v_extra_info, v_check_date;
        IF done THEN LEAVE ammo_loop; END IF;
        IF NOT EXISTS (SELECT 1 FROM Alerts WHERE alert_type = 'Expiry' AND related_entity_id = v_item_id AND related_entity_type = 'Ammunition') THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Expiry', v_item_id, 'Ammunition', CONCAT(v_item_type, ' (Lot: ', v_extra_info, ') has expired on ', DATE_FORMAT(v_check_date, '%d-%m-%Y')));
        END IF;
    END LOOP;
    CLOSE cur_expired_ammo;
    SET done = FALSE;

    -- --- 2. Process Expired Rations (Company Level) ---
    OPEN cur_expired_rations;
    ration_loop: LOOP
        FETCH cur_expired_rations INTO v_item_id, v_item_type, v_extra_info, v_check_date;
        IF done THEN LEAVE ration_loop; END IF;
        IF NOT EXISTS (SELECT 1 FROM Alerts WHERE alert_type = 'Expiry' AND related_entity_id = v_item_id AND related_entity_type = 'Ration') THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Expiry', v_item_id, 'Ration', CONCAT(v_item_type, ' at Company ID ', v_extra_info, ' has expired on ', DATE_FORMAT(v_check_date, '%d-%m-%Y')));
        END IF;
    END LOOP;
    CLOSE cur_expired_rations;
    SET done = FALSE;

    -- --- 3. Process Expired Battalion Stock ---
    OPEN cur_expired_battalion_stock;
    battalion_stock_loop: LOOP
        FETCH cur_expired_battalion_stock INTO v_item_id, v_item_type, v_extra_info, v_check_date;
        IF done THEN LEAVE battalion_stock_loop; END IF;
        IF NOT EXISTS (SELECT 1 FROM Alerts WHERE alert_type = 'Expiry' AND related_entity_id = v_item_id AND related_entity_type = 'BattalionStock') THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) 
            VALUES ('Expiry', v_item_id, 'BattalionStock', CONCAT(v_item_type, ' (Lot: ', v_extra_info, ') in QM Store has expired on ', DATE_FORMAT(v_check_date, '%d-%m-%Y')));
        END IF;
    END LOOP;
    CLOSE cur_expired_battalion_stock;
    SET done = FALSE;

    -- --- 4. Process Weapon Maintenance Due ---
    OPEN cur_maintenance_weapons;
    weapon_maint_loop: LOOP
        FETCH cur_maintenance_weapons INTO v_item_id, v_item_type, v_extra_info, v_check_date;
        IF done THEN LEAVE weapon_maint_loop; END IF;
        IF NOT EXISTS (SELECT 1 FROM Alerts WHERE alert_type = 'Maintenance Due' AND related_entity_id = v_item_id AND related_entity_type = 'Weapon') THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Maintenance Due', v_item_id, 'Weapon', CONCAT('Weapon S/N: ', v_extra_info, ' requires maintenance by ', DATE_FORMAT(v_check_date, '%d-%m-%Y')));
        END IF;
    END LOOP;
    CLOSE cur_maintenance_weapons;
    SET done = FALSE;

    -- --- 5. Process Military Transport Maintenance Due ---
    OPEN cur_maintenance_mt;
    mt_maint_loop: LOOP
        FETCH cur_maintenance_mt INTO v_item_id, v_item_type, v_extra_info, v_check_date;
        IF done THEN LEAVE mt_maint_loop; END IF;
        IF NOT EXISTS (SELECT 1 FROM Alerts WHERE alert_type = 'Maintenance Due' AND related_entity_id = v_item_id AND related_entity_type = 'Military_Transport') THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Maintenance Due', v_item_id, 'Military_Transport', CONCAT('Vehicle No: ', v_extra_info, ' requires maintenance by ', DATE_FORMAT(v_check_date, '%d-%m-%Y')));
        END IF;
    END LOOP;
    CLOSE cur_maintenance_mt;

END$$


-- 1. The Procedure: Resets leave for all Active soldiers
CREATE PROCEDURE sp_ResetYearlyLeaves()
BEGIN
    -- Standard Indian Army Entitlement (Example: 60 Annual, 30 Casual)
    UPDATE Soldiers
    SET remaining_annual_leave = 60,
        remaining_casual_leave = 30
    WHERE `status` = 'Active';

    -- Notify the CO that this happened
    INSERT INTO Alerts (alert_type, related_entity_type, message, alert_date)
    VALUES ('Info', 'System', 'Yearly Leave Reset completed. All active personnel quotas restored to 60/30.', CURDATE());
END$$




-- Reset the delimiter
DELIMITER ;





-- SECTION 4: TRIGGERS


DELIMITER $$



CREATE TRIGGER trg_after_leave_approval AFTER UPDATE ON Leave_Records FOR EACH ROW
BEGIN
    DECLARE v_leave_days INT;
    IF NEW.`status` = 'Approved' AND OLD.`status` = 'Pending' THEN
        SET v_leave_days = DATEDIFF(NEW.end_date, NEW.start_date) + 1;
        IF NEW.leave_type = 'Annual' THEN
            UPDATE Soldiers SET remaining_annual_leave = remaining_annual_leave - v_leave_days WHERE soldier_id = NEW.soldier_id;
        ELSEIF NEW.leave_type = 'Casual' THEN
            UPDATE Soldiers SET remaining_casual_leave = remaining_casual_leave - v_leave_days WHERE soldier_id = NEW.soldier_id;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_after_ammo_update_shortage AFTER UPDATE ON Ammunition FOR EACH ROW
BEGIN
    IF NEW.quantity < NEW.low_stock_threshold AND OLD.quantity >= OLD.low_stock_threshold THEN
        INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Low Stock', NEW.ammo_id, 'Ammunition', CONCAT(NEW.ammo_type, ' is running low. Current stock: ', NEW.quantity));
    END IF;
END$$

CREATE TRIGGER trg_after_fuel_update_shortage AFTER UPDATE ON Fuel_Lubricants FOR EACH ROW
BEGIN
    IF NEW.quantity_liters < NEW.low_stock_threshold AND OLD.quantity_liters >= OLD.low_stock_threshold THEN
        INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Low Stock', NEW.fuel_id, 'Fuel', CONCAT(NEW.fuel_type, ' is running low. Current stock: ', NEW.quantity_liters, 'L'));
    END IF;
END$$

CREATE TRIGGER trg_after_ration_update_shortage AFTER UPDATE ON Rations FOR EACH ROW
BEGIN
    IF NEW.quantity_kg < NEW.low_stock_threshold AND OLD.quantity_kg >= OLD.low_stock_threshold THEN
        INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Low Stock', NEW.ration_id, 'Ration', CONCAT(NEW.item_name, ' at Company ID ', NEW.assigned_company_id, ' is running low.'));
    END IF;
END$$



CREATE TRIGGER trg_battalionstock_after_update_low_stock
AFTER UPDATE ON BattalionStock
FOR EACH ROW
BEGIN
    -- Check if the quantity just dropped below the threshold
    IF NEW.quantity_kg < NEW.low_stock_threshold AND OLD.quantity_kg >= OLD.low_stock_threshold THEN
        INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message)
        VALUES ('Low Stock', NEW.stock_id, 'BattalionStock', CONCAT(NEW.item_name, ' (Lot: ', NEW.lot_number, ') in QM Store is running low.'));
    END IF;
END$$


CREATE TRIGGER trg_battalionstock_after_insert_low_stock
AFTER INSERT ON BattalionStock
FOR EACH ROW
BEGIN
    IF NEW.quantity_kg < NEW.low_stock_threshold THEN
        INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message)
        VALUES ('Low Stock', NEW.stock_id, 'BattalionStock', CONCAT(NEW.item_name, ' (Lot: ', NEW.lot_number, ') in QM Store is running low.'));
    END IF;
END$$






CREATE TRIGGER trg_after_weapon_update_maintenance AFTER UPDATE ON Weapons FOR EACH ROW
BEGIN
    IF NEW.next_maintenance IS NOT NULL AND (OLD.next_maintenance IS NULL OR NEW.next_maintenance != OLD.next_maintenance) THEN
        IF NEW.next_maintenance <= CURDATE() + INTERVAL 30 DAY THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Maintenance Due', NEW.weapon_id, 'Weapon', CONCAT('Weapon S/N: ', NEW.serial_number, ' requires maintenance by ', DATE_FORMAT(NEW.next_maintenance, '%d-%m-%Y')));
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_after_mt_update_maintenance AFTER UPDATE ON Military_Transport FOR EACH ROW
BEGIN
    IF NEW.next_maintenance IS NOT NULL AND (OLD.next_maintenance IS NULL OR NEW.next_maintenance != OLD.next_maintenance) THEN
        IF NEW.next_maintenance <= CURDATE() + INTERVAL 30 DAY THEN
            INSERT INTO Alerts (alert_type, related_entity_id, related_entity_type, message) VALUES ('Maintenance Due', NEW.mt_id, 'Military_Transport', CONCAT('Vehicle No: ', NEW.vehicle_number, ' requires maintenance by ', DATE_FORMAT(NEW.next_maintenance, '%d-%m-%Y')));
        END IF;
    END IF;
END$$

DELIMITER ;


-- SECTION 5: EVENT SCHEDULER

-- 1. Event to run daily checks
SET GLOBAL event_scheduler = ON;

CREATE EVENT IF NOT EXISTS evt_daily_checks
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
COMMENT 'Daily check for all time-based events like expiry and maintenance.'
DO
    CALL sp_RunDailyChecks();
    
    
-- 2. The Event: Runs automatically on Jan 1st every year
CREATE EVENT evt_yearly_leave_reset
ON SCHEDULE EVERY 1 YEAR
STARTS '2026-01-01 00:00:00'
DO
    CALL sp_ResetYearlyLeaves();



























--                     DATA POPULATION SCRIPT                                        --


USE battalion_inventory;

-- SECTION 0: PREPARATION
-- Temporarily disable foreign key checks to allow insertion of interdependent data.
SET FOREIGN_KEY_CHECKS = 0;


-- SECTION 1: POPULATE COMPANIES & SOLDIERS

INSERT INTO Companies (company_id, company_name, company_commander_id) VALUES
(1, 'Alpha Company', 1), (2, 'Bravo Company', 1), (3, 'Charlie Company', 1),
(4, 'Delta Company', 1), (5, 'Headquarter Company', 1), (6, 'Support Company', 1);

INSERT INTO Soldiers (soldier_id, name, `rank`, dob, company_id, remaining_annual_leave, remaining_casual_leave) VALUES
(1, 'Soldier 1', 'Lieutenant Colonel', '1980-05-20', 5, 30, 15),(2, 'Soldier 2', 'Major', '1985-11-15', 5, 30, 15),(3, 'Soldier 3', 'Captain', '1990-08-01', 5, 30, 15),(4, 'Soldier 4', 'Major', '1986-02-25', 5, 30, 15),(5, 'Soldier 5', 'Subedar Major', '1975-01-10', 5, 30, 15),(101, 'Soldier 101', 'Major', '1987-07-22', 1, 30, 15),(102, 'Soldier 102', 'Subedar', '1982-03-12', 1, 30, 15),(103, 'Soldier 103', 'Havildar', '1992-06-18', 1, 30, 15),(104, 'Soldier 104', 'Havildar', '1993-01-30', 1, 30, 15),(105, 'Soldier 105', 'Naik', '1995-04-10', 1, 30, 15),(106, 'Soldier 106', 'Naik', '1996-05-20', 1, 30, 15),(107, 'Soldier 107', 'Sepoy', '2001-02-11', 1, 30, 15),(108, 'Soldier 108', 'Sepoy', '2002-03-22', 1, 30, 15),(109, 'Soldier 109', 'Sepoy', '2002-07-07', 1, 30, 15),(110, 'Soldier 110', 'Sepoy', '2003-01-01', 1, 30, 15),(111, 'Soldier 111', 'Sepoy', '2003-08-15', 1, 30, 15),(112, 'Soldier 112', 'Sepoy', '2004-05-09', 1, 30, 15),(201, 'Soldier 201', 'Major', '1988-01-15', 2, 30, 15),(202, 'Soldier 202', 'Subedar', '1983-04-20', 2, 30, 15),(203, 'Soldier 203', 'Havildar', '1993-07-01', 2, 30, 15),(204, 'Soldier 204', 'Havildar', '1994-02-12', 2, 30, 15),(205, 'Soldier 205', 'Naik', '1996-09-03', 2, 30, 15),(206, 'Soldier 206', 'Naik', '1997-10-14', 2, 30, 15),(207, 'Soldier 207', 'Sepoy', '2002-04-25', 2, 30, 15),(208, 'Soldier 208', 'Sepoy', '2002-09-16', 2, 30, 15),(209, 'Soldier 209', 'Sepoy', '2003-03-27', 2, 30, 15),(210, 'Soldier 210', 'Sepoy', '2003-11-08', 2, 30, 15),(211, 'Soldier 211', 'Sepoy', '2004-01-19', 2, 30, 15),(212, 'Soldier 212', 'Sepoy', '2004-06-30', 2, 30, 15),(301, 'Soldier 301', 'Captain', '1990-12-05', 3, 30, 15),(302, 'Soldier 302', 'Naib Subedar', '1985-06-25', 3, 30, 15),(303, 'Soldier 303', 'Havildar', '1994-08-07', 3, 30, 15),(304, 'Soldier 304', 'Havildar', '1995-03-18', 3, 30, 15),(305, 'Soldier 305', 'Naik', '1997-11-20', 3, 30, 15),(306, 'Soldier 306', 'Naik', '1998-01-21', 3, 30, 15),(307, 'Soldier 307', 'Sepoy', '2003-05-02', 3, 30, 15),(308, 'Soldier 308', 'Sepoy', '2003-10-13', 3, 30, 15),(309, 'Soldier 309', 'Sepoy', '2004-02-24', 3, 30, 15),(310, 'Soldier 310', 'Sepoy', '2004-07-05', 3, 30, 15),(311, 'Soldier 311', 'Sepoy', '2004-12-16', 3, 30, 15),(312, 'Soldier 312', 'Sepoy', '2005-02-27', 3, 30, 15),(401, 'Soldier 401', 'Captain', '1991-10-10', 4, 30, 15),(402, 'Soldier 402', 'Naib Subedar', '1986-07-17', 4, 30, 15),(403, 'Soldier 403', 'Havildar', '1995-09-11', 4, 30, 15),(404, 'Soldier 404', 'Havildar', '1996-04-22', 4, 30, 15),(405, 'Soldier 405', 'Naik', '1998-12-04', 4, 30, 15),(406, 'Soldier 406', 'Naik', '1999-02-15', 4, 30, 15),(407, 'Soldier 407', 'Sepoy', '2004-06-07', 4, 30, 15),(408, 'Soldier 408', 'Sepoy', '2004-11-18', 4, 30, 15),(409, 'Soldier 409', 'Sepoy', '2005-01-29', 4, 30, 15),(410, 'Soldier 410', 'Sepoy', '2005-04-10', 4, 30, 15),(411, 'Soldier 411', 'Sepoy', '2005-08-21', 4, 30, 15),(412, 'Soldier 412', 'Sepoy', '2005-10-01', 4, 30, 15),(501, 'Soldier 501', 'Captain', '1992-02-15', 5, 30, 15),(502, 'Soldier 502', 'Naib Subedar', '1985-10-05', 5, 30, 15),(503, 'Soldier 503', 'Havildar', '1994-07-21', 5, 30, 15),(504, 'Soldier 504', 'Sepoy', '2001-12-01', 5, 30, 15),(505, 'Soldier 505', 'Sepoy', '2002-01-08', 5, 30, 15),(601, 'Soldier 601', 'Major', '1988-09-01', 6, 30, 15),(602, 'Soldier 602', 'Subedar', '1984-01-20', 6, 30, 15),(603, 'Soldier 603', 'Havildar', '1993-11-11', 6, 30, 15),(604, 'Soldier 604', 'Naik', '1997-06-06', 6, 30, 15),(605, 'Soldier 605', 'Sepoy', '2002-10-10', 6, 30, 15);

UPDATE Companies SET company_commander_id = 1 WHERE company_name = 'Headquarter Company';
UPDATE Companies SET company_commander_id = 101 WHERE company_name = 'Alpha Company';
UPDATE Companies SET company_commander_id = 201 WHERE company_name = 'Bravo Company';
UPDATE Companies SET company_commander_id = 301 WHERE company_name = 'Charlie Company';
UPDATE Companies SET company_commander_id = 401 WHERE company_name = 'Delta Company';
UPDATE Companies SET company_commander_id = 601 WHERE company_name = 'Support Company';

-- SECTION 2: POPULATE USERS, LEAVE, & INVENTORY
INSERT INTO Users (soldier_id, username, password_hash, `role`) VALUES
(1, 'co.user', 'hashed_password', 'CO'), (3, 'adjutant.user', 'hashed_password', 'Adjutant'), (4, 'qm.user', 'hashed_password', 'QM'),
(101, 'cc.alpha', 'hashed_password', 'CompanyCommander'), (103, 'wi.alpha', 'hashed_password', 'Company_Weapon_Incharge'),
(104, 'ri.alpha', 'hashed_password', 'Company_Ration_Incharge'),
(201, 'cc.bravo', 'hashed_password', 'CompanyCommander'), (301, 'cc.charlie', 'hashed_password', 'CompanyCommander'),
(401, 'cc.delta', 'hashed_password', 'CompanyCommander'), (501, 'mto.user', 'hashed_password', 'MTO'),
(502, 'mtjco.user', 'hashed_password', 'MT_JCO'), (503, 'fuelnco.user', 'hashed_password', 'Fuel_NCO'),
(601, 'cc.support', 'hashed_password', 'CompanyCommander'),(107, 'soldier107', 'hashed_password', 'Soldier');

INSERT INTO Leave_Records (soldier_id, start_date, end_date, leave_type, reason,`status`, approved_by_id)
VALUES (307, '2025-10-10', '2025-10-25', 'Annual', 'as per leave plan', 'Approved', 301);

INSERT INTO Weapons (weapon_id, serial_number, `type`, model, assigned_company_id) VALUES
(101, 'RFL-A01', 'Rifle', 'INSAS 5.56mm', 1),(102, 'RFL-A02', 'Rifle', 'INSAS 5.56mm', 1),(103, 'RFL-A03', 'Rifle', 'INSAS 5.56mm', 1),(104, 'RFL-A04', 'Rifle', 'INSAS 5.56mm', 1),(105, 'RFL-A05', 'Rifle', 'INSAS 5.56mm', 1),(106, 'PST-A01', 'Pistol', 'Pistol Auto 9mm 1A', 1),(201, 'RFL-B01', 'Rifle', 'INSAS 5.56mm', 2),(202, 'RFL-B02', 'Rifle', 'INSAS 5.56mm', 2),(203, 'RFL-B03', 'Rifle', 'INSAS 5.56mm', 2),(204, 'RFL-B04', 'Rifle', 'INSAS 5.56mm', 2),(205, 'RFL-B05', 'Rifle', 'INSAS 5.56mm', 2),(206, 'PST-B01', 'Pistol', 'Pistol Auto 9mm 1A', 2),(301, 'RFL-C01', 'Rifle', 'INSAS 5.56mm', 3),(302, 'RFL-C02', 'Rifle', 'INSAS 5.56mm', 3),(303, 'RFL-C03', 'Rifle', 'INSAS 5.56mm', 3),(304, 'RFL-C04', 'Rifle', 'INSAS 5.56mm', 3),(305, 'RFL-C05', 'Rifle', 'INSAS 5.56mm', 3),(306, 'PST-C01', 'Pistol', 'Pistol Auto 9mm 1A', 3),(401, 'RFL-D01', 'Rifle', 'INSAS 5.56mm', 4),(402, 'RFL-D02', 'Rifle', 'INSAS 5.56mm', 4),(403, 'RFL-D03', 'Rifle', 'INSAS 5.56mm', 4),(404, 'RFL-D04', 'Rifle', 'INSAS 5.56mm', 4),(405, 'RFL-D05', 'Rifle', 'INSAS 5.56mm', 4),(406, 'PST-D01', 'Pistol', 'Pistol Auto 9mm 1A', 4),(501, 'PST-HQ01', 'Pistol', 'Pistol Auto 9mm 1A', 5),(601, 'MTR-S01', 'Mortar', '81mm Mortar', 6);

CALL sp_AssignWeaponToSoldier(107, 101, 4); CALL sp_AssignWeaponToSoldier(108, 102, 4); CALL sp_AssignWeaponToSoldier(101, 106, 4);
CALL sp_AssignWeaponToSoldier(207, 201, 4); CALL sp_AssignWeaponToSoldier(208, 202, 4); CALL sp_AssignWeaponToSoldier(201, 206, 4);
CALL sp_AssignWeaponToSoldier(308, 301, 4); CALL sp_AssignWeaponToSoldier(307, 302, 4); CALL sp_AssignWeaponToSoldier(301, 306, 4);
CALL sp_AssignWeaponToSoldier(407, 401, 4); CALL sp_AssignWeaponToSoldier(408, 402, 4); CALL sp_AssignWeaponToSoldier(401, 406, 4);
CALL sp_AssignWeaponToSoldier(1, 501, 4); CALL sp_AssignWeaponToSoldier(603, 601, 4);

INSERT INTO Ammunition (ammo_id, ammo_type, quantity, lot_number, expiry_date, low_stock_threshold) VALUES
(1, '5.56mm Ball', 5100, 'LOT-101/24', '2034-12-31', 5000), (2, '9mm Ball', 2000, 'LOT-202/23', '2033-12-31', 1000),
(3, '81mm HE', 100, 'LOT-301/22', '2032-12-31', 20);

INSERT INTO Weapon_Ammo_Compatibility (weapon_type, ammo_type) VALUES 
('INSAS 5.56mm', '5.56mm Ball'),
('Pistol Auto 9mm 1A', '9mm Ball'),
('81mm Mortar', '81mm HE');

INSERT INTO Rations (item_name, assigned_company_id, quantity_kg, low_stock_threshold, expiry_date) VALUES
('Rice', 1, 500, 100, '2026-09-30'), ('Wheat Flour', 2, 80, 150, '2026-06-30'),
('Sugar', 3, 150, 50, '2025-09-01'), ('Lentils', 4, 200, 50, '2027-01-01');

INSERT INTO Military_Transport (vehicle_number, `type`, model, driver_id, `status`, last_maintenance, next_maintenance) VALUES
('BA-01-G-1234', 'GS 4x4', 'Tata Safari Storme', 504, 'Operational', '2025-08-10', '2026-02-10'),
('BA-01-T-5678', 'Truck 5T', 'Ashok Leyland Stallion', 505, 'Operational', '2025-09-20', '2025-10-20');

INSERT INTO Fuel_Lubricants (fuel_type, quantity_liters, low_stock_threshold) VALUES
('Diesel', 1800.00, 500), ('Petrol', 450.50, 100);

INSERT INTO Ammunition_Log (ammo_id, transaction_type, quantity_change, authorizing_officer_id, recipient_company_id, remarks)
VALUES (1, 'Issued_Training', -200, 4, 1, 'Alpha Company annual firing practice');

-- Re-enable foreign key checks now that all data is consistent.
SET FOREIGN_KEY_CHECKS = 1;

COMMIT;