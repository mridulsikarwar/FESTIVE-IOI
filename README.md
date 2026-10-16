# FESTIVE IOI 2026 - Event Registration & Secure QR Check-in System

A complete event registration and gate attendance platform built with Node.js, Express, SQLite, and Google OAuth.

---

## 🌟 Key Features

### 👨‍🎓 1. Student Portal (`/`)
- **Domain-Restricted Sign-In**: Restricts Google sign-in exclusively to an institutional domain (e.g., `@college.edu`). Accounts with other domains (e.g. `@gmail.com`) are automatically rejected.
- **Event Registration Form**:
  - `enrollment_id` (**Primary Key**, college roll number)
  - `name` (pre-filled from Google profile)
  - `department` (dynamic department selection)
  - `year` (1st to 5th Year)
  - `phone` (10-digit mobile number)
  - `email` (verified and locked from Google account)
- **Unique Event Pass (QR Code Ticket)**:
  - Generates a high-resolution, cryptographically signed ticket QR code.
  - Live check-in status badge: `🎟️ VALID TICKET (PENDING GATE SCAN)` vs `✅ CHECKED IN (ATTENDANCE VERIFIED)`.
  - Print / Save Ticket as PDF/PNG option.
  - Celebratory confetti animation upon registration.

### 🛡️ 2. Admin Portal (`/admin`)
- **Passcode Protected Gate Control**: Staff authenticate with a secure admin passkey (default: `admin123`).
- **Live Camera QR Scanner**:
  - Powered by `html5-qrcode` to scan tickets directly from laptops or smartphones.
  - Fallback manual entry / handheld USB barcode scanner input.
  - **Audio feedback**: Pleasant chime on valid entry, sharp buzzer on duplicate/invalid.
- **Strict Single-Scan Rule (No Duplicates)**:
  - **1st Scan**: Marks student attendance as `Present`, records timestamp, and allows entry.
  - **2nd Scan Attempt**: **BLOCKED IMMEDIATELY**. Alerts staff with exact previous scan time and prevents duplicate entry.
- **Live Attendance Data Sheet**:
  - Interactive table displaying all attendees: Enrollment ID, Name, Department, Year, Phone, Email, Attendance Status, and Scan Timestamp.
  - Real-time search across any column.
  - Filter by Department, Year, and Attendance Status (`Present` vs `Not Scanned`).
  - **Export to CSV**: One-click download of the complete datasheet formatted for Microsoft Excel / Google Sheets.

---

## ☁️ Cloud Database Setup (Python + Cloud PostgreSQL)

This project is built with **Python (SQLAlchemy + FastAPI)** and connects to any **Cloud Database** (such as **Neon.tech**, **Supabase**, **Render**, **AWS RDS**, or **ElephantSQL**). No local database files are required!

### 1. Configure Cloud Database URL in `.env`
Open [`.env`](file:///Users/mridulsikarwar/Desktop/FESTIVE-IOI/.env) and paste your Cloud PostgreSQL connection string:

```ini
PORT=8000

# CLOUD DATABASE CONNECTION STRING (Supports Supabase, Neon.tech, Render, AWS RDS, etc.):
DATABASE_URL=postgresql://user:password@ep-cool-xyz.neon.tech/festive_db?sslmode=require

# Institutional domain restriction for student login
ALLOWED_DOMAIN=college.edu

# Optional: Google OAuth 2.0 Web Client ID
GOOGLE_CLIENT_ID=

# Admin passcode for gate staff
ADMIN_SECRET=admin123
```

### 2. Initialize Cloud Database Schema
Run the Python cloud database initializer to automatically create the tables and seed departments in your cloud instance:
```bash
./venv/bin/python init_cloud_db.py
```

### 3. Start the Python Cloud Server
```bash
./venv/bin/python app.py
```

Open in your browser:
- **👨‍🎓 Student Portal**: [http://localhost:8000](http://localhost:8000)
- **🛡️ Admin Portal**: [http://localhost:8000/admin](http://localhost:8000/admin) *(Passcode: `admin123`)*
- **📚 Interactive Swagger API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🗄️ Database Architecture (Option 2 Normalized Model)

```mermaid
erDiagram
    DEPARTMENT ||--o{ STUDENT : "enrolled in"
    STUDENT ||--o{ ATTENDANCE : "has records"

    DEPARTMENT {
        INT id PK
        TEXT name
        TEXT code
    }

    STUDENT {
        TEXT enrollment_id PK
        TEXT name
        TEXT department
        INTEGER year
        TEXT phone
        TEXT email
        TEXT ticket_token
        DATETIME registered_at
    }

    ATTENDANCE {
        INTEGER attendance_id PK
        TEXT enrollment_id FK
        TEXT status
        DATETIME scanned_at
        TEXT scanned_by
    }
```

---

## 🧪 Verification & Testing
Run the automated test suite to verify domain checking, QR ticket issuance, single-scan enforcement, and datasheet accuracy:
```bash
node test_portal.js
```
