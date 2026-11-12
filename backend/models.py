from datetime import datetime
from sqlalchemy import Column, String, Integer, BigInteger, Numeric, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    code = Column(String(10), nullable=False, unique=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code
        }


class Student(Base):
    __tablename__ = "students"

    enrollment_id = Column(String(50), primary_key=True, index=True) # PRIMARY KEY (Roll No or GST-XXXX)
    name = Column(String(100), nullable=False)
    department = Column(String(100), nullable=True)
    year = Column(String(20), nullable=True)
    phone = Column(String(20), nullable=False, unique=True, index=True)
    email = Column(String(100), nullable=False, unique=True, index=True)
    google_id = Column(String(100), nullable=True)
    ticket_token = Column(String(100), nullable=False, unique=True, index=True)
    registered_at = Column(DateTime, default=datetime.utcnow)
    user_type = Column(String(20), default="pw_member") # pw_member | guest
    company = Column(String(100), nullable=True) # UpGrad, News nation, Silver Spring, Others
    amount_paid = Column(Numeric, default=0)
    utr_number = Column(String(50), nullable=True, unique=True)
    payment_status = Column(String(20), default="approved") # approved | pending_verification

    # 1-to-1 relationship with attendance check-in
    attendance = relationship("Attendance", back_populates="student", uselist=False, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "enrollment_id": self.enrollment_id,
            "name": self.name,
            "department": self.department or "External Attendee",
            "year": self.year or "N/A",
            "phone": self.phone,
            "email": self.email,
            "ticket_token": self.ticket_token,
            "user_type": self.user_type,
            "company": self.company,
            "amount_paid": float(self.amount_paid) if self.amount_paid is not None else 0,
            "utr_number": self.utr_number,
            "payment_status": self.payment_status,
            "registered_at": self.registered_at.isoformat() if self.registered_at else None,
            "attendance_status": "Present" if self.attendance else "Not Scanned",
            "scanned_at": self.attendance.scanned_at.isoformat() if self.attendance else None
        }


class Attendance(Base):
    __tablename__ = "attendance"

    attendance_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # UNIQUE constraint on enrollment_id strictly guarantees at cloud database level 
    # that a ticket CANNOT be scanned more than once
    enrollment_id = Column(
        String(50), 
        ForeignKey("students.enrollment_id", ondelete="CASCADE"), 
        nullable=False, 
        unique=True,
        index=True
    )
    status = Column(String(20), default="Present", nullable=False)
    scanned_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    scanned_by = Column(String(50), default="Admin Scanner")

    student = relationship("Student", back_populates="attendance")

    def to_dict(self):
        return {
            "attendance_id": self.attendance_id,
            "enrollment_id": self.enrollment_id,
            "status": self.status,
            "scanned_at": self.scanned_at.isoformat() if self.scanned_at else None,
            "scanned_by": self.scanned_by
        }


class AdminUser(Base):
    __tablename__ = "admin_users"

    email = Column(String(100), primary_key=True)
    role = Column(String(30), nullable=False, default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)
