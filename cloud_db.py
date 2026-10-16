import os
from contextlib import contextmanager
from dotenv import load_dotenv
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker
from models import Base, Department

load_dotenv()

# Get Cloud Database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# Common cloud fix: Neon/Supabase/Render often use 'postgres://' which SQLAlchemy requires as 'postgresql://'
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Default to warning if user has not yet pasted their cloud URL
if not DATABASE_URL:
    print("\n" + "="*70)
    print("⚠️  DATABASE_URL is not set in your .env file!")
    print("👉 Please add your Cloud PostgreSQL connection string to .env:")
    print("   DATABASE_URL=postgresql://user:password@ep-cloud-host.neon.tech/festive_db?sslmode=require")
    print("   (Supports Supabase, Neon.tech, AWS RDS, Render, ElephantSQL, etc.)")
    print("="*70 + "\n")

# Engine initialization with SSL and connection pooling for Cloud databases
engine_kwargs = {
    "pool_pre_ping": True, # Automatically recycle dead connections across internet drops
    "pool_recycle": 300,
    "pool_size": 10,
    "max_overflow": 20
}

# Only add sslmode if not already in URL for PostgreSQL
if DATABASE_URL and "sslmode" not in DATABASE_URL and "sqlite" not in DATABASE_URL:
    connect_args = {"sslmode": "require"}
    engine_kwargs["connect_args"] = connect_args

# Create the SQLAlchemy engine (fallback to memory if not set for testing)
effective_url = DATABASE_URL or "sqlite:///festive_cloud_fallback.db"
engine = create_engine(effective_url, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency / context manager for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_cloud_database():
    """
    Connects to the cloud database, creates all required tables
    (departments, students, attendance), and seeds default academic departments.
    """
    print(f"📡 Connecting to Cloud Database...")
    Base.metadata.create_all(bind=engine)
    print("✅ Cloud database tables verified/created successfully.")

    # Seed default departments if table is empty
    with SessionLocal() as db:
        count = db.query(func.count(Department.id)).scalar()
        if count == 0:
            print("🌱 Seeding default academic departments into cloud database...")
            default_departments = [
                ("Computer Science and Engineering", "CSE"),
                ("Information Technology", "IT"),
                ("Electronics and Communication", "ECE"),
                ("Electrical Engineering", "EE"),
                ("Mechanical Engineering", "ME"),
                ("Civil Engineering", "CE"),
                ("Biotechnology", "BT"),
                ("Management / MBA", "MGMT")
            ]
            for name, code in default_departments:
                dept = Department(name=name, code=code)
                db.add(dept)
            db.commit()
            print("✅ Default departments seeded.")
        else:
            print(f"ℹ️ Cloud database already has {count} departments configured.")
