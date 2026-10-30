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
from sqlalchemy import func, text
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
    enrollment_id: Optional[str] = None
    name: str
    department: Optional[str] = None
    year: Optional[str] = None
    phone: str
    company: Optional[str] = None
    utr_number: Optional[str] = None

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

    # Determine domain & user type
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    user_domain = email.split("@")[1]
    is_pw_member = bool(ALLOWED_DOMAINS and user_domain in ALLOWED_DOMAINS)
    user_type = "pw_member" if is_pw_member else "guest"

    # Check existing attendee in Cloud DB
    student = db.query(Student).filter(Student.email == email).first()

    token = create_jwt({
        "email": email,
        "name": name,
        "google_id": google_id,
        "role": "student",
        "user_type": user_type
    })

    return {
        "success": True,
        "token": token,
        "email": email,
        "name": name,
        "user_type": user_type,
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
    user_type = auth.get("user_type", "pw_member")

    # Check if registration gates are open
    try:
        cfg = {row[0]: row[1] for row in db.execute(text("SELECT key, value FROM system_config;")).fetchall()}
        if user_type == "pw_member" and cfg.get("pw_registration_open") == "false":
            raise HTTPException(status_code=403, detail="Registrations for PW Community are currently closed by organizers.")
        if user_type == "guest" and cfg.get("guest_registration_open") == "false":
            raise HTTPException(status_code=403, detail="Registrations for external attendees are currently closed by organizers.")
    except HTTPException:
        raise
    except Exception as e:
        print("Config check note:", e)

    clean_enrollment = (body.enrollment_id or "").strip().upper()
    if not clean_enrollment:
        clean_enrollment = f"GST-{secrets.token_hex(3).upper()}"
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

    # Validate UTR if guest
    if user_type == "guest" and body.utr_number:
        clean_utr = body.utr_number.strip()
        if db.query(Student).filter(Student.utr_number == clean_utr).first():
            raise HTTPException(status_code=400, detail="This 12-digit UTR has already been submitted.")

    # Generate cryptographically secure ticket token
    ticket_token = f"TKT-{secrets.token_hex(8).upper()}"

    new_student = Student(
        enrollment_id=clean_enrollment,
        name=body.name.strip(),
        department=body.department.strip() if body.department else ("External Guest" if user_type == "guest" else "General"),
        year=str(body.year) if body.year else ("Guest" if user_type == "guest" else "Faculty"),
        phone=clean_phone,
        email=email,
        google_id=auth.get("google_id"),
        ticket_token=ticket_token,
        user_type=user_type,
        company=body.company.strip() if body.company else None,
        amount_paid=500 if user_type == "guest" else 0,
        utr_number=body.utr_number.strip() if body.utr_number else None,
        payment_status="pending_verification" if user_type == "guest" else "approved"
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

# Registration Gateway Controls
@app.get("/api/system-config")
def get_system_config(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text("SELECT key, value FROM system_config;")).fetchall()
        return {"config": {r[0]: r[1] for r in rows}}
    except Exception as e:
        return {"config": {"pw_registration_open": "true", "guest_registration_open": "true"}}

@app.post("/api/admin/toggle-registration/{key}")
def toggle_reg_gateway(key: str, admin: dict = Depends(verify_admin_token), db: Session = Depends(get_db)):
    if key not in ["pw_registration_open", "guest_registration_open"]:
        raise HTTPException(status_code=400, detail="Invalid config key")
    try:
        current = db.execute(text("SELECT value FROM system_config WHERE key=:k"), {"k": key}).scalar()
        new_val = "false" if current != "false" else "true"
        db.execute(text("UPDATE system_config SET value=:v, updated_at=NOW() WHERE key=:k"), {"v": new_val, "k": key})
        db.commit()
        return {"success": True, "key": key, "value": new_val}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 1-Click Payment Approval for External Guests
@app.post("/api/admin/verify-payment/{enrollment_id}")
def verify_payment(
    enrollment_id: str,
    admin: dict = Depends(verify_admin_token),
    db: Session = Depends(get_db)
):
    student = db.query(Student).filter(Student.enrollment_id == enrollment_id.strip().upper()).first()
    if not student:
        raise HTTPException(status_code=404, detail="Attendee record not found.")

    student.payment_status = "approved"
    db.commit()
    return {"success": True, "message": f"Payment for {student.enrollment_id} approved.", "student": student.to_dict()}

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
    raw_search = qr_data.strip()

    # Parse QR content (JSON object, primitive roll number, URL, or plain token)
    try:
        json_candidate = raw_search
        if json_candidate.startswith("{") and json_candidate.endswith("}"):
            if '"' not in json_candidate and "'" in json_candidate:
                json_candidate = json_candidate.replace("'", '"')
        parsed = json.loads(json_candidate)
        if isinstance(parsed, dict):
            ticket_token = parsed.get("ticket_token") or parsed.get("ticketToken") or parsed.get("token") or parsed.get("ticket")
            enrollment_id = parsed.get("enrollment_id") or parsed.get("enrollmentId") or parsed.get("roll_no") or parsed.get("rollNo") or parsed.get("id")
        else:
            # Primitive number/string (e.g. 2501030001)
            if raw_search.upper().startswith("TKT-"):
                ticket_token = raw_search.upper()
            else:
                enrollment_id = raw_search
    except Exception:
        if raw_search.startswith("http://") or raw_search.startswith("https://"):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(raw_search)
            params = parse_qs(parsed_url.query)
            ticket_token = (params.get("ticket_token") or params.get("token") or params.get("ticket") or [None])[0]
            enrollment_id = (params.get("enrollment_id") or params.get("id") or params.get("roll") or params.get("roll_no") or [None])[0]
        if not ticket_token and not enrollment_id:
            if raw_search.upper().startswith("TKT-"):
                ticket_token = raw_search.upper()
            else:
                enrollment_id = raw_search

    # Clean strings
    if ticket_token:
        ticket_token = str(ticket_token).strip().upper()
    if enrollment_id:
        enrollment_id = str(enrollment_id).strip()

    # Find student in Cloud Database (Enrollment ID takes TOP priority)
    student = None
    if enrollment_id:
        student = db.query(Student).filter(
            (Student.enrollment_id == enrollment_id) | (Student.enrollment_id == enrollment_id.upper())
        ).first()
    if not student and ticket_token:
        student = db.query(Student).filter(Student.ticket_token == ticket_token).first()
    if not student and raw_search:
        student = db.query(Student).filter(
            (Student.enrollment_id == raw_search) | (Student.enrollment_id == raw_search.upper())
        ).first()
    if not student and "@" in raw_search:
        student = db.query(Student).filter(Student.email == raw_search.lower()).first()
    if not student and raw_search.isdigit() and len(raw_search) == 10:
        student = db.query(Student).filter(Student.phone == raw_search).first()

    if not student:
        raise HTTPException(
            status_code=404,
            detail="Invalid Ticket! No matching attendee record found in cloud database."
        )

    # CHECK PAYMENT STATUS
    if student.payment_status == "pending_verification":
        raise HTTPException(
            status_code=400,
            detail=f"⚠️ PAYMENT PENDING: Attendee's ₹500 payment (UTR: {student.utr_number or 'N/A'}) has not been verified yet."
        )
    if student.payment_status == "rejected":
        raise HTTPException(
            status_code=403,
            detail="⚠️ PAYMENT REJECTED: The payment submission for this pass was rejected."
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
        "Enrollment/Ref ID", "Name", "Department/Company", "Role/Year", "Phone",
        "Email", "Fee Paid", "UTR Number", "Payment Status",
        "Registration Date", "Attendance Status", "Scanned Timestamp"
    ])

    for s in students:
        writer.writerow([
            s.enrollment_id,
            s.name,
            s.company if s.company else s.department,
            s.year,
            s.phone,
            s.email,
            float(s.amount_paid) if s.amount_paid is not None else 0,
            s.utr_number or "N/A",
            s.payment_status or "approved",
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
