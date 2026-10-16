import os
import io
import csv
import json
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, status, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func
from dotenv import load_dotenv
import jwt
import qrcode
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"

load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env")

try:
    from cloud_db import get_db, init_cloud_database, DATABASE_URL
    from models import Department, Student, Attendance
except ImportError:
    from backend.cloud_db import get_db, init_cloud_database, DATABASE_URL
    from backend.models import Department, Student, Attendance

# App Configuration
PORT = int(os.getenv("PORT", 8000))
ALLOWED_DOMAIN = os.getenv("ALLOWED_DOMAIN", "pwioi.com,pw.live").strip()
ALLOWED_DOMAINS = [d.strip().lower() for d in ALLOWED_DOMAIN.split(",") if d.strip()]
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "admin123").strip()
JWT_SECRET = os.getenv("JWT_SECRET", "cloud_festive_jwt_secret_key_2026").strip()
JWT_ALGORITHM = "HS256"

app = FastAPI(
    title="FESTIVE IOI Cloud Event Management System",
    description="Python Cloud Database backend for Student Registration, Domain Google Auth, and Gate Attendance Scanner",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup: Initialize Cloud Database Schema
@app.on_event("startup")
def on_startup():
    try:
        init_cloud_database()
    except Exception as e:
        print(f"⚠️ Warning during cloud DB initialization: {e}")

# Helper: Create QR Code Data URL in Base64
def generate_qr_base64(data_payload: str) -> str:
    import base64
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(data_payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1e1b4b", back_color="#ffffff")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"

# Authentication Helpers
def create_jwt(payload: dict, expires_hours: int = 48) -> str:
    to_encode = payload.copy()
    expire = datetime.utcnow() + timedelta(hours=expires_hours)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_student_token(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication token required")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "student":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid student session")
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expired or invalid token")

def verify_admin_token(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin token required")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin authorization required")
        return payload
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expired or invalid admin session")

# Pydantic Schemas
class GoogleAuthRequest(BaseModel):
    idToken: Optional[str] = None
    demoUser: Optional[dict] = None

class StudentRegisterRequest(BaseModel):
    enrollment_id: str
    name: str
    department: str
    year: int
    phone: str

class AdminLoginRequest(BaseModel):
    password: str

class TicketScanRequest(BaseModel):
    qrData: str

# --- Endpoints ---

@app.get("/api/config")
def get_config():
    return {
        "allowedDomain": ALLOWED_DOMAIN,
        "googleClientId": GOOGLE_CLIENT_ID,
        "isGoogleConfigured": bool(GOOGLE_CLIENT_ID),
        "databaseType": "Cloud PostgreSQL" if "postgresql" in DATABASE_URL else "Cloud-ready DB"
    }

@app.get("/api/departments")
def list_departments(db: Session = Depends(get_db)):
    depts = db.query(Department).order_by(Department.name.asc()).all()
    return {"departments": [d.to_dict() for d in depts]}

@app.post("/api/auth/google")
def auth_google(req: GoogleAuthRequest, db: Session = Depends(get_db)):
    email = None
    name = None
    google_id = None

    if req.idToken:
        if not GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=500, detail="Google Client ID not configured on server.")
        try:
            idinfo = id_token.verify_oauth2_token(
                req.idToken, google_requests.Request(), GOOGLE_CLIENT_ID
            )
            email = idinfo.get("email", "").lower().strip()
            name = idinfo.get("name", "Student")
            google_id = idinfo.get("sub")
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Google token verification failed: {str(e)}")
    elif req.demoUser:
        email = req.demoUser.get("email", "").lower().strip()
        name = req.demoUser.get("name", "Student")
        google_id = f"demo-{secrets.token_hex(4)}"
    else:
        raise HTTPException(status_code=400, detail="Missing credential or token.")

    # ENFORCE DOMAIN RESTRICTION
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    user_domain = email.split("@")[1]
    if ALLOWED_DOMAINS and "*" not in ALLOWED_DOMAINS and user_domain not in ALLOWED_DOMAINS:
        allowed_str = " or ".join(["@" + d for d in ALLOWED_DOMAINS])
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Domain Restriction: Only email addresses ending with {allowed_str} are permitted. (Received: {email})"
        )

    # Check existing student in Cloud DB
    student = db.query(Student).filter(Student.email == email).first()

    token = create_jwt({
        "email": email,
        "name": name,
        "google_id": google_id,
        "role": "student"
    })

    return {
        "success": True,
        "token": token,
        "email": email,
        "name": name,
        "isRegistered": student is not None,
        "student": student.to_dict() if student else None
    }

@app.get("/api/student/me")
def get_student_profile(auth: dict = Depends(verify_student_token), db: Session = Depends(get_db)):
    email = auth["email"]
    student = db.query(Student).filter(Student.email == email).first()

    if not student:
        return {"registered": False, "student": None}

    # Generate QR Code Data URL
    qr_payload = json.dumps({
        "ticket_token": student.ticket_token,
        "enrollment_id": student.enrollment_id
    })
    qr_data_url = generate_qr_base64(qr_payload)

    return {
        "registered": True,
        "student": student.to_dict(),
        "qrCodeUrl": qr_data_url
    }

@app.post("/api/student/register")
def register_student(
    body: StudentRegisterRequest,
    auth: dict = Depends(verify_student_token),
    db: Session = Depends(get_db)
):
    email = auth["email"]
    clean_enrollment = body.enrollment_id.strip().upper()
    clean_phone = body.phone.strip()

    # Validate duplicate enrollment ID (Primary Key)
    if db.query(Student).filter(Student.enrollment_id == clean_enrollment).first():
        raise HTTPException(status_code=400, detail=f"Enrollment ID '{clean_enrollment}' is already registered.")

    # Validate duplicate email
    if db.query(Student).filter(Student.email == email).first():
        raise HTTPException(status_code=400, detail="Your email is already registered.")

    # Validate duplicate phone
    if db.query(Student).filter(Student.phone == clean_phone).first():
        raise HTTPException(status_code=400, detail="This phone number is already registered.")

    # Generate cryptographically secure ticket token
    ticket_token = f"TKT-{secrets.token_hex(8).upper()}"

    new_student = Student(
        enrollment_id=clean_enrollment,
        name=body.name.strip(),
        department=body.department.strip(),
        year=body.year,
        phone=clean_phone,
        email=email,
        google_id=auth.get("google_id"),
        ticket_token=ticket_token
    )

    db.add(new_student)
    db.commit()
    db.refresh(new_student)

    # Generate QR
    qr_payload = json.dumps({
        "ticket_token": ticket_token,
        "enrollment_id": clean_enrollment
    })
    qr_data_url = generate_qr_base64(qr_payload)

    return {
        "success": True,
        "message": "Event registration successful in cloud database!",
        "student": new_student.to_dict(),
        "qrCodeUrl": qr_data_url
    }

# --- Admin Endpoints ---

@app.post("/api/admin/login")
def admin_login(body: AdminLoginRequest):
    if body.password != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Invalid admin passcode.")

    token = create_jwt({"role": "admin", "user": "Staff Admin"}, expires_hours=24)
    return {"success": True, "token": token}

# CRITICAL RULE: Once a ticket is scanned, it CANNOT be scanned again!
@app.post("/api/admin/scan-ticket")
def scan_ticket(
    body: TicketScanRequest,
    admin: dict = Depends(verify_admin_token),
    db: Session = Depends(get_db)
):
    qr_data = body.qrData.strip()
    ticket_token = None
    enrollment_id = None

    # Parse QR content
    try:
        parsed = json.loads(qr_data)
        ticket_token = parsed.get("ticket_token")
        enrollment_id = parsed.get("enrollment_id")
    except Exception:
        if qr_data.startswith("TKT-"):
            ticket_token = qr_data
        else:
            enrollment_id = qr_data.upper()

    # Find student in Cloud Database
    query = db.query(Student)
    if ticket_token and enrollment_id:
        student = query.filter((Student.ticket_token == ticket_token) | (Student.enrollment_id == enrollment_id)).first()
    elif ticket_token:
        student = query.filter(Student.ticket_token == ticket_token).first()
    else:
        student = query.filter(Student.enrollment_id == enrollment_id).first()

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Invalid Ticket! No matching student record found in cloud database."
        )

    # CHECK IF TICKET HAS ALREADY BEEN SCANNED
    existing_attendance = db.query(Attendance).filter(Attendance.enrollment_id == student.enrollment_id).first()

    if existing_attendance:
        # DUPLICATE SCAN REJECTED!
        return Response(
            content=json.dumps({
                "success": False,
                "alreadyScanned": True,
                "status": "ALREADY_SCANNED",
                "student": student.to_dict(),
                "scannedAt": existing_attendance.scanned_at.isoformat(),
                "scannedBy": existing_attendance.scanned_by,
                "message": f"⚠️ TICKET ALREADY USED! Scanned on {existing_attendance.scanned_at.strftime('%Y-%m-%d %H:%M:%S')} UTC"
            }),
            status_code=status.HTTP_409_CONFLICT,
            media_type="application/json"
        )

    # RECORD FRESH ATTENDANCE IN CLOUD DATABASE
    scan_time = datetime.utcnow()
    new_attendance = Attendance(
        enrollment_id=student.enrollment_id,
        status="Present",
        scanned_at=scan_time,
        scanned_by="Admin Scanner"
    )
    db.add(new_attendance)
    db.commit()

    student_data = student.to_dict()
    student_data["attendance_status"] = "Present"
    student_data["scanned_at"] = scan_time.isoformat()

    return {
        "success": True,
        "alreadyScanned": False,
        "status": "VERIFIED",
        "student": student_data,
        "scannedAt": scan_time.isoformat(),
        "message": f"✅ TICKET VERIFIED! Welcome, {student.name}!"
    }

@app.get("/api/admin/datasheet")
def get_datasheet(admin: dict = Depends(verify_admin_token), db: Session = Depends(get_db)):
    students = db.query(Student).order_by(Student.registered_at.desc()).all()
    data = [s.to_dict() for s in students]
    return {"data": data}

@app.get("/api/admin/stats")
def get_stats(admin: dict = Depends(verify_admin_token), db: Session = Depends(get_db)):
    total = db.query(func.count(Student.enrollment_id)).scalar() or 0
    present = db.query(func.count(Attendance.attendance_id)).scalar() or 0
    pending = total - present
    rate = round((present / total) * 100) if total > 0 else 0

    return {
        "total": total,
        "present": present,
        "pending": pending,
        "percent": rate
    }

@app.get("/api/admin/export-csv")
def export_csv(admin: dict = Depends(verify_admin_token), db: Session = Depends(get_db)):
    students = db.query(Student).order_by(Student.enrollment_id.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Enrollment ID", "Name", "Department", "Year", "Phone",
        "Email", "Registration Date", "Attendance Status", "Scanned Timestamp"
    ])

    for s in students:
        writer.writerow([
            s.enrollment_id,
            s.name,
            s.department,
            s.year,
            s.phone,
            s.email,
            s.registered_at.strftime("%Y-%m-%d %H:%M:%S") if s.registered_at else "",
            "Present" if s.attendance else "Not Scanned",
            s.attendance.scanned_at.strftime("%Y-%m-%d %H:%M:%S") if s.attendance else "N/A"
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cloud_attendance_datasheet.csv"}
    )

# Static files & Frontend Serving
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")

@app.get("/")
def serve_student_ui():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

@app.get("/admin")
def serve_admin_ui():
    return FileResponse(str(FRONTEND_DIR / "admin.html"))

if __name__ == "__main__":
    import uvicorn
    print("="*65)
    print(f"🚀 FESTIVE IOI Python Cloud App running on http://localhost:{PORT}")
    print(f"👨‍🎓 Student Portal: http://localhost:{PORT}")
    print(f"🛡️ Admin Portal:    http://localhost:{PORT}/admin")
    print(f"📚 Swagger API Docs: http://localhost:{PORT}/docs")
    print("="*65)
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
