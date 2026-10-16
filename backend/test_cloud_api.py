from fastapi.testclient import TestClient
try:
    from app import app
    from cloud_db import init_cloud_database
except ImportError:
    from backend.app import app
    from backend.cloud_db import init_cloud_database
import json

init_cloud_database()
client = TestClient(app)

def test_full_cloud_workflow():
    print("\n--- RUNNING PYTHON CLOUD BACKEND TEST SUITE ---")

    # 1. Config endpoint
    res = client.get("/api/config")
    assert res.status_code == 200
    print("1. Config API OK -> Allowed Domain:", res.json()["allowedDomain"])

    # 2. Reject non-institutional domain
    res = client.post("/api/auth/google", json={
        "demoUser": {"name": "Hacker", "email": "hacker@gmail.com"}
    })
    assert res.status_code == 403
    print("2. Domain Enforcement OK -> Blocked non-college email (Status 403)")

    import time
    test_id = f"TEST{int(time.time()) % 1000000}"
    test_email = f"user.{int(time.time())}@college.edu"

    # 3. Allow valid institutional domain
    res = client.post("/api/auth/google", json={
        "demoUser": {"name": "Aarav Gupta", "email": test_email}
    })
    assert res.status_code == 200
    student_token = res.json()["token"]
    print("3. Institutional Domain Login OK -> Token generated")

    # 4. Student Registration
    res = client.post(
        "/api/student/register",
        headers={"Authorization": f"Bearer {student_token}"},
        json={
            "enrollment_id": test_id,
            "name": "Aarav Gupta",
            "department": "Computer Science and Engineering",
            "year": 2,
            "phone": f"98{int(time.time()) % 100000000:08d}"
        }
    )
    assert res.status_code == 200
    student_data = res.json()["student"]
    ticket_token = student_data["ticket_token"]
    print(f"4. Student Registration OK -> Enrollment: {student_data['enrollment_id']}, Ticket: {ticket_token}")

    # 5. Fetch Profile & QR
    res = client.get("/api/student/me", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200
    assert "data:image/png;base64," in res.json()["qrCodeUrl"]
    print("5. QR Code Generation OK -> High-Res Data URL generated")

    # 6. Admin Login
    res = client.post("/api/admin/login", json={"password": "admin123"})
    assert res.status_code == 200
    admin_token = res.json()["token"]
    print("6. Admin Login OK -> Admin staff authenticated")

    # 7. First Ticket Scan (Should Succeed and Mark Present)
    qr_payload = json.dumps({"ticket_token": ticket_token, "enrollment_id": test_id})
    res = client.post(
        "/api/admin/scan-ticket",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"qrData": qr_payload}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "VERIFIED"
    print("7. 1st Ticket Scan OK -> Entry Approved & Marked Present")

    # 8. CRITICAL REQUIREMENT: Second Ticket Scan (MUST BE REJECTED)
    res = client.post(
        "/api/admin/scan-ticket",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"qrData": qr_payload}
    )
    assert res.status_code == 409
    assert res.json()["alreadyScanned"] is True
    print("8. Duplicate Scan Prevention OK -> Status 409 Conflict (Ticket cannot be scanned twice)")

    # 9. Datasheet
    res = client.get("/api/admin/datasheet", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    rows = res.json()["data"]
    attendee = next((r for r in rows if r["enrollment_id"] == test_id), None)
    assert attendee is not None
    assert attendee["attendance_status"] == "Present"
    print(f"9. Live Datasheet OK -> Attendee {attendee['name']} is '{attendee['attendance_status']}' at {attendee['scanned_at']}")

    print("\n--- ALL PYTHON CLOUD TESTS PASSED SUCCESSFULLY! ---")

if __name__ == "__main__":
    test_full_cloud_workflow()
