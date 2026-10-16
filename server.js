require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { OAuth2Client } = require('google-auth-library');
const { run, get, all, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'festive_ioi_secret_jwt_key_98765';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'college.edu';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB schema
initDb().catch(console.error);

// Middleware: Student Authentication via JWT
function authenticateStudent(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded || decoded.role !== 'student') {
      return res.status(403).json({ error: 'Invalid or expired student session.' });
    }
    req.studentUser = decoded;
    next();
  });
}

// Middleware: Admin Authentication
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded || decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized admin access.' });
    }
    req.adminUser = decoded;
    next();
  });
}

// --- Public Endpoints ---

// Public Config
app.get('/api/config', (req, res) => {
  res.json({
    allowedDomain: ALLOWED_DOMAIN,
    googleClientId: GOOGLE_CLIENT_ID,
    isGoogleConfigured: Boolean(GOOGLE_CLIENT_ID)
  });
});

// List departments
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await all(`SELECT name, code FROM departments ORDER BY name ASC`);
    res.json({ departments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Google Sign-In & Verification Endpoint
app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken, demoUser } = req.body;
    let email, name, googleId;

    if (idToken) {
      if (!GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google Client ID not configured on server.' });
      }
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      email = payload.email;
      name = payload.name;
      googleId = payload.sub;

      // Domain restriction verification
      const userDomain = email.split('@')[1];
      if (ALLOWED_DOMAIN && ALLOWED_DOMAIN !== '*' && userDomain !== ALLOWED_DOMAIN) {
        return res.status(403).json({
          error: `Access Denied: Only accounts from @${ALLOWED_DOMAIN} are permitted to sign in. (Your email: ${email})`
        });
      }
    } else if (demoUser) {
      // Demo login support for testing when Google OAuth credentials haven't been provided yet
      email = (demoUser.email || '').toLowerCase().trim();
      name = demoUser.name || 'Demo Student';
      googleId = 'demo-' + Date.now();

      const userDomain = email.split('@')[1];
      if (ALLOWED_DOMAIN && ALLOWED_DOMAIN !== '*' && userDomain !== ALLOWED_DOMAIN) {
        return res.status(403).json({
          error: `Domain Restriction: Only email addresses ending with @${ALLOWED_DOMAIN} are allowed. Received: ${email}`
        });
      }
    } else {
      return res.status(400).json({ error: 'Missing token or credentials.' });
    }

    // Check if student is already registered in DB
    const existingStudent = await get(`SELECT * FROM students WHERE email = ?`, [email]);

    // Create session JWT
    const token = jwt.sign(
      {
        email,
        name,
        googleId,
        role: 'student'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      email,
      name,
      isRegistered: Boolean(existingStudent),
      student: existingStudent || null
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Authentication failed: ' + (error.message || 'Invalid token') });
  }
});

// --- Student Endpoints ---

// Get current student registration profile & ticket
app.get('/api/student/me', authenticateStudent, async (req, res) => {
  try {
    const student = await get(
      `SELECT s.*, 
              CASE WHEN a.attendance_id IS NOT NULL THEN 'Present' ELSE 'Pending' END as attendance_status,
              a.scanned_at
       FROM students s
       LEFT JOIN attendance a ON s.enrollment_id = a.enrollment_id
       WHERE s.email = ?`,
      [req.studentUser.email]
    );

    if (!student) {
      return res.json({ registered: false, student: null });
    }

    // Generate QR code data URL
    const qrPayload = JSON.stringify({
      ticket_token: student.ticket_token,
      enrollment_id: student.enrollment_id
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 320,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    });

    res.json({
      registered: true,
      student,
      qrCodeUrl: qrDataUrl
    });
  } catch (err) {
    console.error('Error fetching student:', err);
    res.status(500).json({ error: 'Server error retrieving profile' });
  }
});

// Register student for event
app.post('/api/student/register', authenticateStudent, async (req, res) => {
  try {
    const { enrollment_id, name, department, year, phone } = req.body;
    const email = req.studentUser.email;

    if (!enrollment_id || !name || !department || !year || !phone) {
      return res.status(400).json({ error: 'All fields are mandatory.' });
    }

    const cleanEnrollmentId = enrollment_id.trim().toUpperCase();
    const cleanPhone = phone.trim();

    // Check duplicate enrollment ID
    const existingById = await get(`SELECT enrollment_id FROM students WHERE enrollment_id = ?`, [cleanEnrollmentId]);
    if (existingById) {
      return res.status(400).json({ error: `Enrollment ID '${cleanEnrollmentId}' is already registered.` });
    }

    // Check duplicate email
    const existingByEmail = await get(`SELECT email FROM students WHERE email = ?`, [email]);
    if (existingByEmail) {
      return res.status(400).json({ error: 'Your email is already registered for this event.' });
    }

    // Check duplicate phone
    const existingByPhone = await get(`SELECT phone FROM students WHERE phone = ?`, [cleanPhone]);
    if (existingByPhone) {
      return res.status(400).json({ error: 'This phone number is already registered.' });
    }

    // Generate unique cryptographically secure ticket token
    const ticketToken = 'TKT-' + crypto.randomBytes(8).toString('hex').toUpperCase();

    await run(
      `INSERT INTO students (enrollment_id, name, department, year, phone, email, google_id, ticket_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanEnrollmentId,
        name.trim(),
        department.trim(),
        parseInt(year, 10),
        cleanPhone,
        email,
        req.studentUser.googleId,
        ticketToken
      ]
    );

    const qrPayload = JSON.stringify({
      ticket_token: ticketToken,
      enrollment_id: cleanEnrollmentId
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 320,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      message: 'Event registration successful!',
      student: {
        enrollment_id: cleanEnrollmentId,
        name: name.trim(),
        department: department.trim(),
        year: parseInt(year, 10),
        phone: cleanPhone,
        email,
        ticket_token: ticketToken,
        attendance_status: 'Pending'
      },
      qrCodeUrl: qrDataUrl
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + (err.message || 'Database error') });
  }
});

// --- Admin Endpoints ---

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Invalid admin passcode.' });
  }

  const token = jwt.sign(
    { role: 'admin', user: 'Admin' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ success: true, token });
});

// Admin Ticket Scanner Endpoint
// Crucial Rule: Once a ticket is scanned, it CANNOT be scanned again!
app.post('/api/admin/scan-ticket', authenticateAdmin, async (req, res) => {
  try {
    const { qrData } = req.body;
    if (!qrData) {
      return res.status(400).json({ error: 'No ticket data provided.' });
    }

    let ticketToken = null;
    let enrollmentId = null;

    // Try parsing as JSON or clean string
    if (typeof qrData === 'string') {
      try {
        const parsed = JSON.parse(qrData);
        ticketToken = parsed.ticket_token;
        enrollmentId = parsed.enrollment_id;
      } catch (e) {
        // Fallback: scanned as pure string (token or enrollment id)
        const clean = qrData.trim();
        if (clean.startsWith('TKT-')) {
          ticketToken = clean;
        } else {
          enrollmentId = clean;
        }
      }
    } else if (typeof qrData === 'object') {
      ticketToken = qrData.ticket_token;
      enrollmentId = qrData.enrollment_id;
    }

    // Query student from database
    let student;
    if (ticketToken && enrollmentId) {
      student = await get(`SELECT * FROM students WHERE ticket_token = ? OR enrollment_id = ?`, [ticketToken, enrollmentId]);
    } else if (ticketToken) {
      student = await get(`SELECT * FROM students WHERE ticket_token = ?`, [ticketToken]);
    } else if (enrollmentId) {
      student = await get(`SELECT * FROM students WHERE enrollment_id = ?`, [enrollmentId]);
    }

    if (!student) {
      return res.status(404).json({
        success: false,
        status: 'INVALID',
        message: 'Invalid Ticket! No matching student registration found in database.'
      });
    }

    // CHECK IF TICKET HAS ALREADY BEEN SCANNED
    const existingScan = await get(
      `SELECT * FROM attendance WHERE enrollment_id = ?`,
      [student.enrollment_id]
    );

    if (existingScan) {
      // TICKET ALREADY USED - REJECT!
      return res.status(409).json({
        success: false,
        alreadyScanned: true,
        status: 'ALREADY_SCANNED',
        student,
        scannedAt: existingScan.scanned_at,
        scannedBy: existingScan.scanned_by,
        message: `⚠️ TICKET ALREADY USED! Scanned at ${new Date(existingScan.scanned_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`
      });
    }

    // MARK AS SCANNED (ATOMIC INSERTION)
    const scanTime = new Date().toISOString();
    await run(
      `INSERT INTO attendance (enrollment_id, status, scanned_at, scanned_by)
       VALUES (?, 'Present', ?, ?)`,
      [student.enrollment_id, scanTime, 'Admin Scanner']
    );

    return res.json({
      success: true,
      alreadyScanned: false,
      status: 'VERIFIED',
      student: {
        ...student,
        attendance_status: 'Present'
      },
      scannedAt: scanTime,
      message: `✅ TICKET VERIFIED! Welcome, ${student.name}!`
    });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Scan error: ' + err.message });
  }
});

// Admin Data Sheet Endpoint: Returns all students with live attendance status
app.get('/api/admin/datasheet', authenticateAdmin, async (req, res) => {
  try {
    const rows = await all(
      `SELECT 
          s.enrollment_id,
          s.name,
          s.department,
          s.year,
          s.phone,
          s.email,
          s.registered_at,
          CASE 
            WHEN a.attendance_id IS NOT NULL THEN 'Present' 
            ELSE 'Not Scanned' 
          END as attendance_status,
          a.scanned_at,
          a.scanned_by
       FROM students s
       LEFT JOIN attendance a ON s.enrollment_id = a.enrollment_id
       ORDER BY a.scanned_at DESC NULLS LAST, s.registered_at DESC`
    );

    res.json({ data: rows });
  } catch (err) {
    console.error('Datasheet error:', err);
    res.status(500).json({ error: 'Failed to retrieve datasheet' });
  }
});

// Admin Stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const totalRow = await get(`SELECT COUNT(*) as count FROM students`);
    const presentRow = await get(`SELECT COUNT(*) as count FROM attendance WHERE status = 'Present'`);
    const depts = await all(`
      SELECT s.department, COUNT(s.enrollment_id) as total, COUNT(a.attendance_id) as present
      FROM students s
      LEFT JOIN attendance a ON s.enrollment_id = a.enrollment_id
      GROUP BY s.department
      ORDER BY total DESC
    `);

    const total = totalRow.count || 0;
    const present = presentRow.count || 0;
    const pending = total - present;

    res.json({
      total,
      present,
      pending,
      percent: total > 0 ? Math.round((present / total) * 100) : 0,
      departments: depts
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Admin Export CSV
app.get('/api/admin/export-csv', authenticateAdmin, async (req, res) => {
  try {
    const rows = await all(
      `SELECT 
          s.enrollment_id,
          s.name,
          s.department,
          s.year,
          s.phone,
          s.email,
          s.registered_at,
          CASE 
            WHEN a.attendance_id IS NOT NULL THEN 'Present' 
            ELSE 'Not Scanned' 
          END as attendance_status,
          a.scanned_at
       FROM students s
       LEFT JOIN attendance a ON s.enrollment_id = a.enrollment_id
       ORDER BY s.enrollment_id ASC`
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance_datasheet.csv"');

    // CSV Header
    let csv = 'Enrollment ID,Name,Department,Year,Phone,Email,Registration Date,Attendance Status,Scanned Timestamp\n';

    rows.forEach(r => {
      const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      csv += [
        escape(r.enrollment_id),
        escape(r.name),
        escape(r.department),
        escape(r.year),
        escape(r.phone),
        escape(r.email),
        escape(r.registered_at),
        escape(r.attendance_status),
        escape(r.scanned_at || 'N/A')
      ].join(',') + '\n';
    });

    res.send(csv);
  } catch (err) {
    res.status(500).send('Error exporting CSV: ' + err.message);
  }
});

// Wildcard route to serve index.html for student portal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin page route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Festive Event Portal running on http://localhost:${PORT}`);
  console.log(`👨‍🎓 Student Portal: http://localhost:${PORT}`);
  console.log(`🛡️ Admin Portal:    http://localhost:${PORT}/admin`);
  console.log(`🔒 Allowed Domain:  @${ALLOWED_DOMAIN}`);
  console.log(`🔑 Admin Passcode:  ${ADMIN_SECRET}`);
  console.log(`===============================================`);
});
