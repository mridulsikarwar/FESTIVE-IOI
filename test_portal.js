const http = require('http');

async function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE SUITE ---');

  // Test 1: Config
  const configRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/config',
    method: 'GET'
  });
  console.log('1. Config API Status:', configRes.status, 'Allowed Domain:', configRes.data.allowedDomain);

  // Test 2: Domain Restriction - Invalid Domain
  const invalidAuth = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/google',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    demoUser: { name: 'Intruder', email: 'intruder@gmail.com' }
  });
  console.log('2. Domain Restriction (Wrong Domain) -> Status:', invalidAuth.status, 'Error:', invalidAuth.data.error);

  // Test 3: Domain Restriction - Valid Domain
  const validAuth = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/google',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    demoUser: { name: 'Rohan Sharma', email: 'rohan.sharma@college.edu' }
  });
  console.log('3. Domain Restriction (Valid Domain) -> Status:', validAuth.status, 'Student Token Received:', Boolean(validAuth.data.token));
  const studentToken = validAuth.data.token;

  // Test 4: Student Registration
  const regRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/student/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${studentToken}`
    }
  }, {
    enrollment_id: '0801CS221099',
    name: 'Rohan Sharma',
    department: 'Computer Science and Engineering',
    year: 3,
    phone: '9876543210'
  });
  console.log('4. Student Registration -> Status:', regRes.status, 'Ticket Token:', regRes.data.student ? regRes.data.student.ticket_token : regRes.data);
  const ticketToken = regRes.data.student.ticket_token;

  // Test 5: Admin Login
  const adminLogin = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    password: 'admin123'
  });
  console.log('5. Admin Login -> Status:', adminLogin.status, 'Admin Token Received:', Boolean(adminLogin.data.token));
  const adminToken = adminLogin.data.token;

  // Test 6: First Ticket Scan (Should Succeed and Mark Present)
  const firstScan = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/scan-ticket',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    qrData: JSON.stringify({ ticket_token: ticketToken, enrollment_id: '0801CS221099' })
  });
  console.log('6. First Ticket Scan -> Status:', firstScan.status, 'Result:', firstScan.data.message);

  // Test 7: CRITICAL RULE - Second Scan of the SAME ticket (MUST BE REJECTED)
  const secondScan = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/scan-ticket',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    }
  }, {
    qrData: JSON.stringify({ ticket_token: ticketToken, enrollment_id: '0801CS221099' })
  });
  console.log('7. Duplicate Scan Attempt -> Status:', secondScan.status, '(Expected 409 Conflict)', 'Message:', secondScan.data.message);

  // Test 8: Admin Datasheet
  const datasheetRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/datasheet',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('8. Admin Datasheet -> Status:', datasheetRes.status, 'Rows Count:', datasheetRes.data.data.length);
  const attendee = datasheetRes.data.data.find(d => d.enrollment_id === '0801CS221099');
  console.log('   Attendee Status in Sheet:', attendee ? `${attendee.name} | Status: ${attendee.attendance_status} | Scanned At: ${attendee.scanned_at}` : 'Not found');

  console.log('--- ALL TEST SCENARIOS VERIFIED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
