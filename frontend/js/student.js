// Student Portal Client Script (Direct Supabase Integration)

let appConfig = {
  allowedDomain: APP_CONFIG.allowedDomain,
  googleClientId: '',
  isGoogleConfigured: false
};

let currentStudent = null;

// DOM Elements
const authSection = document.getElementById('authSection');
const regSection = document.getElementById('regSection');
const ticketSection = document.getElementById('ticketSection');
const alertBox = document.getElementById('alertBox');
const userHeaderProfile = document.getElementById('userHeaderProfile');
const headerUserName = document.getElementById('headerUserName');
const signOutBtn = document.getElementById('signOutBtn');

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
  setupDomainDisplay();
  await loadDepartments();
  setupEventListeners();
  checkExistingSession();
});

// Setup allowed domain labels
function setupDomainDisplay() {
  document.querySelectorAll('.allowedDomainSpan').forEach(el => el.textContent = appConfig.allowedDomain);
  const domainText = document.getElementById('domainText');
  if (domainText) domainText.textContent = '@' + appConfig.allowedDomain;

  const demoEmailInput = document.getElementById('demoEmail');
  if (demoEmailInput && (!demoEmailInput.value || demoEmailInput.value.includes('@'))) {
    demoEmailInput.value = 'student@' + appConfig.allowedDomain;
  }
}

// Populate Departments directly from Supabase
async function loadDepartments() {
  try {
    const { data: departments, error } = await supabase
      .from('departments')
      .select('name, code')
      .order('name', { ascending: true });

    if (error) throw error;

    const select = document.getElementById('regDepartment');
    if (select && departments) {
      select.innerHTML = '<option value="">-- Select Department --</option>';
      departments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = `${d.name} (${d.code})`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load departments from Supabase:', err);
  }
}

// Handle Student Sign-In with Domain Enforcement
async function handleInstantAuth(e) {
  e.preventDefault();
  const name = document.getElementById('demoName').value.trim();
  const email = document.getElementById('demoEmail').value.trim().toLowerCase();

  // 1. Strict Domain Restriction Check
  const userDomain = email.split('@')[1];
  if (appConfig.allowedDomain && appConfig.allowedDomain !== '*' && userDomain !== appConfig.allowedDomain) {
    showAlert(`Access Denied: Only accounts ending in @${appConfig.allowedDomain} are permitted.`, 'error');
    return;
  }

  // 2. Save session locally
  localStorage.setItem('student_email', email);
  localStorage.setItem('student_name', name);
  updateHeaderUser(name);

  // 3. Check if student already exists in Supabase
  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('*, attendance(*)')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    if (student) {
      currentStudent = {
        ...student,
        attendance_status: student.attendance ? 'Present' : 'Pending',
        scanned_at: student.attendance ? student.attendance.scanned_at : null
      };
      await renderTicket(currentStudent);
      showSection('ticket');
    } else {
      showRegistrationForm(email, name);
    }
  } catch (err) {
    console.error('Supabase query error:', err);
    showRegistrationForm(email, name);
  }
}

// Check existing session on page load
async function checkExistingSession() {
  const savedEmail = localStorage.getItem('student_email');
  const savedName = localStorage.getItem('student_name');

  if (!savedEmail) {
    showSection('auth');
    return;
  }

  updateHeaderUser(savedName || 'Student');

  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('*, attendance(*)')
      .eq('email', savedEmail)
      .maybeSingle();

    if (!error && student) {
      currentStudent = {
        ...student,
        attendance_status: student.attendance ? 'Present' : 'Pending',
        scanned_at: student.attendance ? student.attendance.scanned_at : null
      };
      await renderTicket(currentStudent);
      showSection('ticket');
    } else {
      showRegistrationForm(savedEmail, savedName || '');
    }
  } catch (e) {
    showSection('auth');
  }
}

// Show Registration Form
function showRegistrationForm(email, name) {
  document.getElementById('regEmail').value = email;
  document.getElementById('regName').value = name;
  showSection('reg');
}

// Handle Student Event Registration in Supabase
async function handleRegistration(e) {
  e.preventDefault();
  const email = localStorage.getItem('student_email') || document.getElementById('regEmail').value.trim();
  const enrollment_id = document.getElementById('regEnrollmentId').value.trim().toUpperCase();
  const name = document.getElementById('regName').value.trim();
  const department = document.getElementById('regDepartment').value;
  const year = parseInt(document.getElementById('regYear').value, 10);
  const phone = document.getElementById('regPhone').value.trim();

  const submitBtn = document.getElementById('submitRegBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i><span>Registering in Cloud DB...</span>';

  try {
    // 1. Check duplicate enrollment ID (Primary Key)
    const { data: dupId } = await supabase
      .from('students')
      .select('enrollment_id')
      .eq('enrollment_id', enrollment_id)
      .maybeSingle();

    if (dupId) {
      showAlert(`Enrollment ID '${enrollment_id}' is already registered!`, 'error');
      resetSubmitBtn(submitBtn);
      return;
    }

    // 2. Check duplicate phone
    const { data: dupPhone } = await supabase
      .from('students')
      .select('phone')
      .eq('phone', phone)
      .maybeSingle();

    if (dupPhone) {
      showAlert(`Phone number '${phone}' is already registered!`, 'error');
      resetSubmitBtn(submitBtn);
      return;
    }

    // 3. Generate secure ticket token
    const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
    const ticketToken = `TKT-${randomHex}`;

    // 4. Insert into Supabase 'students' table
    const { data: newStudent, error: insertError } = await supabase
      .from('students')
      .insert({
        enrollment_id,
        name,
        department,
        year,
        phone,
        email,
        ticket_token: ticketToken,
        registered_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // 5. Trigger celebratory confetti!
    if (window.confetti) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }

    currentStudent = {
      ...newStudent,
      attendance_status: 'Pending'
    };

    await renderTicket(currentStudent);
    showSection('ticket');
    showAlert('🎉 Registration complete! Here is your entry pass.', 'success');
  } catch (err) {
    console.error('Registration error:', err);
    showAlert('Registration error: ' + (err.message || 'Database error'), 'error');
  } finally {
    resetSubmitBtn(submitBtn);
  }
}

function resetSubmitBtn(btn) {
  btn.disabled = false;
  btn.innerHTML = '<i class="ph-bold ph-qr-code text-lg"></i><span>Complete Registration & Generate Ticket</span>';
}

// Generate QR Code using client-side QRCode generator
async function generateQrDataUrl(text) {
  return new Promise((resolve) => {
    const tempDiv = document.createElement('div');
    new QRCode(tempDiv, {
      text: text,
      width: 280,
      height: 280,
      colorDark: "#1e1b4b",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    setTimeout(() => {
      const img = tempDiv.querySelector('img');
      if (img && img.src) {
        resolve(img.src);
      } else {
        const canvas = tempDiv.querySelector('canvas');
        resolve(canvas ? canvas.toDataURL() : '');
      }
    }, 100);
  });
}

// Render Ticket Details
async function renderTicket(student) {
  document.getElementById('tktName').textContent = student.name;
  document.getElementById('tktEnrollment').textContent = student.enrollment_id;
  document.getElementById('tktDeptYear').textContent = `${student.department} (Year ${student.year})`;
  document.getElementById('tktPhone').textContent = student.phone;
  document.getElementById('tktTokenDisplay').textContent = student.ticket_token;

  // Generate QR payload
  const qrPayload = JSON.stringify({
    ticket_token: student.ticket_token,
    enrollment_id: student.enrollment_id
  });

  const qrDataUrl = await generateQrDataUrl(qrPayload);
  if (qrDataUrl) {
    document.getElementById('tktQrImage').src = qrDataUrl;
  }

  // Update status badge
  const badge = document.getElementById('tktStatusBadge');
  const icon = document.getElementById('tktStatusIcon');
  const text = document.getElementById('tktStatusText');

  if (student.attendance_status === 'Present') {
    badge.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300';
    icon.className = 'ph-bold ph-check-circle text-emerald-600 text-sm';
    text.textContent = '✅ CHECKED IN (ATTENDANCE VERIFIED)';
  } else {
    badge.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 bg-amber-100 text-amber-900 border border-amber-300';
    icon.className = 'ph-bold ph-clock text-amber-600 text-sm';
    text.textContent = '🎟️ VALID TICKET (PENDING GATE SCAN)';
  }
}

// Section Switcher
function showSection(section) {
  authSection.classList.add('hidden');
  regSection.classList.add('hidden');
  ticketSection.classList.add('hidden');

  if (section === 'auth') authSection.classList.remove('hidden');
  if (section === 'reg') regSection.classList.remove('hidden');
  if (section === 'ticket') ticketSection.classList.remove('hidden');
}

// Update Header User Profile
function updateHeaderUser(name) {
  if (name) {
    headerUserName.textContent = name;
    userHeaderProfile.classList.remove('hidden');
    userHeaderProfile.classList.add('flex');
  } else {
    userHeaderProfile.classList.add('hidden');
    userHeaderProfile.classList.remove('flex');
  }
}

// Sign out
function handleSignOut() {
  localStorage.removeItem('student_email');
  localStorage.removeItem('student_name');
  currentStudent = null;
  updateHeaderUser(null);
  showSection('auth');
  showAlert('You have been signed out successfully.', 'info');
}

// Alerts helper
function showAlert(message, type = 'info') {
  alertBox.classList.remove('hidden', 'bg-rose-950/80', 'border-rose-700/60', 'text-rose-200', 'bg-emerald-950/80', 'border-emerald-700/60', 'text-emerald-200', 'bg-indigo-950/80', 'border-indigo-700/60', 'text-indigo-200');

  let iconHtml = '<i class="ph-bold ph-info text-base mt-0.5"></i>';
  if (type === 'error') {
    alertBox.classList.add('bg-rose-950/80', 'border', 'border-rose-700/60', 'text-rose-200');
    iconHtml = '<i class="ph-bold ph-x-circle text-base text-rose-400 mt-0.5"></i>';
  } else if (type === 'success') {
    alertBox.classList.add('bg-emerald-950/80', 'border', 'border-emerald-700/60', 'text-emerald-200');
    iconHtml = '<i class="ph-bold ph-check-circle text-base text-emerald-400 mt-0.5"></i>';
  } else {
    alertBox.classList.add('bg-indigo-950/80', 'border', 'border-indigo-700/60', 'text-indigo-200');
  }

  alertBox.innerHTML = `${iconHtml}<span>${message}</span>`;
  alertBox.scrollIntoView({ behavior: 'smooth' });

  setTimeout(() => {
    alertBox.classList.add('hidden');
  }, 7000);
}

// Setup Event Listeners
function setupEventListeners() {
  const instantAuthForm = document.getElementById('instantAuthForm');
  if (instantAuthForm) instantAuthForm.addEventListener('submit', handleInstantAuth);

  const regForm = document.getElementById('registrationForm');
  if (regForm) regForm.addEventListener('submit', handleRegistration);

  if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);

  const printBtn = document.getElementById('downloadTicketBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  const refreshBtn = document.getElementById('refreshTicketStatusBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await checkExistingSession();
      showAlert('Ticket status refreshed from Supabase.', 'info');
    });
  }
}
