#!/usr/bin/env python3
"""
CLI utility to initialize the cloud database tables and seed initial data.
Usage:
    python init_cloud_db.py
"""
import sys
try:
    from cloud_db import init_cloud_database, DATABASE_URL
except ImportError:
    from backend.cloud_db import init_cloud_database, DATABASE_URL

def main():
    print("="*60)
    print("🚀 FESTIVE IOI - Cloud Database Schema Initialization")
    print("="*60)
    
    if not DATABASE_URL or "sqlite" in DATABASE_URL:
        print("⚠️ Warning: No remote PostgreSQL DATABASE_URL found in .env.")
        print("👉 Set DATABASE_URL in your .env file to target your Cloud Database:")
        print("   Example: DATABASE_URL=postgresql://user:pass@ep-cool-db.neon.tech/festive?sslmode=require\n")
    else:
        # Hide password in logs for security
        masked_url = DATABASE_URL
        if "@" in masked_url:
            creds, host = masked_url.split("@", 1)
            masked_url = creds.split(":")[0] + ":****@" + host
        print(f"🎯 Target Cloud Host: {masked_url}")

    try:
        init_cloud_database()
        print("\n🎉 Cloud Database is ready for production use!")
        print("="*60)
    except Exception as e:
        print(f"\n❌ Error initializing cloud database: {e}", file=sys.stderr)
        print("Please check your cloud connection string, network, and credentials.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
