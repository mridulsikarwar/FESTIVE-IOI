# FESTIVE IOI 2026 - Event Registration & Secure QR Check-in System

A complete event registration and gate attendance platform built with **Python (FastAPI + SQLAlchemy)** and **Supabase Cloud PostgreSQL**.

---

## 📁 Project Structure

```text
FESTIVE-IOI/
├── backend/                       # Python Cloud Backend
│   ├── app.py                    # FastAPI server & REST API
│   ├── models.py                 # SQLAlchemy models (Student, Attendance, Department)
│   ├── cloud_db.py               # Supabase connection pooler & SSL configuration
│   ├── init_cloud_db.py          # Database schema creator & department seeder
│   ├── test_cloud_api.py         # Automated cloud test suite
│   └── requirements.txt          # Python dependencies
│
├── frontend/                      # Web Client
│   ├── index.html                # Student Portal (Google Sign-In, Registration, Ticket QR)
│   ├── admin.html                # Admin Portal (Camera Scanner, Attendance Data Sheet)
│   ├── css/
│   │   └── styles.css            # Custom ticket styling & glassmorphism theme
│   └── js/
│       ├── student.js            # Student logic & QR generation
│       └── admin.js              # Camera QR scanner & real-time datasheet filters
│
├── run.sh                         # 1-click startup script
├── .env.example                   # Environment configuration template
├── .gitignore                     # Protects .env credentials from git commits
└── README.md
```

---

## 🌟 Key Features

### 👨‍🎓 1. Student Portal (`/`)
- **Domain-Restricted Google Sign-In**: Only allows accounts with `@college.edu` domain. Others are blocked.
- **Academic Registration Form**:
  - `enrollment_id` (**Primary Key**, college roll number)
  - `name`, `department`, `year` (1st to 5th Year), `phone`, `email` (locked to Google account).
- **Unique Event Pass (QR Code Ticket)**:
  - High-resolution, cryptographically signed ticket QR code.
  - Live check-in status badge: `🎟️ VALID TICKET` vs `✅ CHECKED IN`.
  - Print / Save Ticket option with celebratory confetti animation.

### 🛡️ 2. Admin Portal (`/admin`)
- **Passcode Protected Gate Control**: Staff authenticate with admin passkey (default: `admin123`).
- **Live Camera QR Scanner**:
  - Camera scanner for mobile phones or laptop webcams.
  - Audio feedback: Pleasant chime on valid entry, sharp buzzer on duplicate/invalid.
- **Strict Single-Scan Rule (No Duplicates)**:
  - **1st Scan**: Marks attendance as `Present` in Supabase with exact timestamp.
  - **2nd Scan Attempt**: **BLOCKED IMMEDIATELY** with `409 Conflict` (cannot be scanned twice).
- **Live Attendance Data Sheet**:
  - Search across any column in real time.
  - Filter by Department, Year, and Attendance Status (`Present` vs `Not Scanned`).
  - **Export to CSV**: Download full spreadsheet formatted for Microsoft Excel / Google Sheets.

---

## 🚀 How to Run

### 1. Configure Cloud Database in `.env`
Your Supabase Cloud PostgreSQL connection string is set in `.env`:
```ini
PORT=8080
DATABASE_URL=postgresql://postgres.nodwynlqtqtmzqjhvnns:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require
ALLOWED_DOMAIN=college.edu
ADMIN_SECRET=admin123
```

### 2. Start the Server
Run the startup script:
```bash
./run.sh
```
*(Or `./venv/bin/python backend/app.py`)*

Open in your browser:
- **👨‍🎓 Student Portal**: [http://localhost:8080](http://localhost:8080)
- **🛡️ Admin Gate Portal**: [http://localhost:8080/admin](http://localhost:8080/admin) *(Passcode: `admin123`)*
- **📚 Interactive Swagger API Docs**: [http://localhost:8080/docs](http://localhost:8080/docs)

---

## 🧪 Run Automated Tests
Test the complete live cloud workflow (registration, QR generation, single-scan, duplicate rejection):
```bash
./venv/bin/python backend/test_cloud_api.py
```
