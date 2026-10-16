// Student Portal Client Script

let appConfig = {
  allowedDomain: 'college.edu',
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
  await loadConfig();
  await loadDepartments();
  setupEventListeners();
  checkExistingSession();
});

// Load config from server
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();

    document.querySelectorAll('.allowedDomainSpan').forEach(el => el.textContent = appConfig.allowedDomain);
    const domainText = document.getElementById('domainText');
    if (domainText) domainText.textContent = '@' + appConfig.allowedDomain;

    const demoEmailInput = document.getElementById('demoEmail');
    if (demoEmailInput && (!demoEmailInput.value || demoEmailInput.value.includes('@'))) {
      demoEmailInput.value = 'student@' + appConfig.allowedDomain;
    }

    if (appConfig.isGoogleConfigured && window.google) {
      initGoogleSignIn();
    }
  } catch (err) {
    console.error('Failed to load server config:', err);
  }
}

// Initialize Google Identity Services
function initGoogleSignIn() {
  try {
    google.accounts.id.initialize({
      client_id: appConfig.googleClientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false
    });

    google.accounts.id.renderButton(
      document.getElementById('googleBtnWrapper'),
      {
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 280
      }
    );
  } catch (e) {
    console.warn('Google GSI initialization notice:', e);
  }
}

// Handle real Google token response
async function handleGoogleCredentialResponse(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential })
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Google Sign-In failed', 'error');
      return;
    }

    onLoginSuccess(data);
  } catch (err) {
    showAlert('Network error during Google Sign-In', 'error');
  }
}

// Handle Instant / College Email Sign-In
async function handleInstantAuth(e) {
  e.preventDefault();
  const name = document.getElementById('demoName').value.trim();
  const email = document.getElementById('demoEmail').value.trim();

  // Client-side domain preview validation
  const userDomain = email.split('@')[1];
  if (appConfig.allowedDomain && appConfig.allowedDomain !== '*' && userDomain !== appConfig.allowedDomain) {
    showAlert(`Access Denied: Only accounts ending in @${appConfig.allowedDomain} are permitted.`, 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demoUser: { name, email } })
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Login failed', 'error');
      return;
    }

    onLoginSuccess(data);
  } catch (err) {
    showAlert('Server connection error during sign in', 'error');
  }
}

// On successful login
function onLoginSuccess(authData) {
  localStorage.setItem('student_jwt', authData.token);
  localStorage.setItem('student_email', authData.email);
  localStorage.setItem('student_name', authData.name);

  updateHeaderUser(authData.name);

  if (authData.isRegistered) {
    // Already registered, fetch ticket
    fetchStudentProfile();
  } else {
    // Not registered, show registration form
    showRegistrationForm(authData.email, authData.name);
  }
}

// Check if user already has an active session
async function checkExistingSession() {
  const token = localStorage.getItem('student_jwt');
  if (!token) {
    showSection('auth');
    return;
  }

  const savedName = localStorage.getItem('student_name');
  if (savedName) updateHeaderUser(savedName);

  await fetchStudentProfile();
}

// Fetch student profile & ticket
async function fetchStudentProfile() {
  const token = localStorage.getItem('student_jwt');
  if (!token) return;

  try {
    const res = await fetch('/api/student/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (res.status === 401 || res.status === 403) {
      handleSignOut();
      return;
    }

    if (data.registered && data.student) {
      currentStudent = data.student;
      renderTicket(data.student, data.qrCodeUrl);
      showSection('ticket');
    } else {
      const email = localStorage.getItem('student_email') || '';
      const name = localStorage.getItem('student_name') || '';
      showRegistrationForm(email, name);
    }
  } catch (err) {
    console.error('Error fetching profile:', err);
  }
}

// Show Registration Form
function showRegistrationForm(email, name) {
  document.getElementById('regEmail').value = email;
  document.getElementById('regName').value = name;
  showSection('reg');
}

// Populate Departments from API
async function loadDepartments() {
  try {
    const res = await fetch('/api/departments');
    const data = await res.json();
    const select = document.getElementById('regDepartment');
    if (select && data.departments) {
      select.innerHTML = '<option value="">-- Select Department --</option>';
      data.departments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = `${d.name} (${d.code})`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load departments:', err);
  }
}

// Submit registration form
async function handleRegistration(e) {
  e.preventDefault();
  const token = localStorage.getItem('student_jwt');
  if (!token) {
    showAlert('Session expired. Please sign in again.', 'error');
    showSection('auth');
    return;
  }

  const enrollment_id = document.getElementById('regEnrollmentId').value.trim();
  const name = document.getElementById('regName').value.trim();
  const department = document.getElementById('regDepartment').value;
  const year = document.getElementById('regYear').value;
  const phone = document.getElementById('regPhone').value.trim();

  const submitBtn = document.getElementById('submitRegBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i><span>Generating Ticket...</span>';

  try {
    const res = await fetch('/api/student/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ enrollment_id, name, department, year, phone })
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Registration failed', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="ph-bold ph-qr-code text-lg"></i><span>Complete Registration & Generate Ticket</span>';
      return;
    }

    // Trigger celebratory confetti!
    if (window.confetti) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

    currentStudent = data.student;
    renderTicket(data.student, data.qrCodeUrl);
    showSection('ticket');
    showAlert('🎉 Registration complete! Here is your entry pass.', 'success');
  } catch (err) {
    showAlert('Network error while registering', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="ph-bold ph-qr-code text-lg"></i><span>Complete Registration & Generate Ticket</span>';
  }
}

// Render Ticket Details
function renderTicket(student, qrCodeUrl) {
  document.getElementById('tktName').textContent = student.name;
  document.getElementById('tktEnrollment').textContent = student.enrollment_id;
  document.getElementById('tktDeptYear').textContent = `${student.department} (Year ${student.year})`;
  document.getElementById('tktPhone').textContent = student.phone;
  document.getElementById('tktTokenDisplay').textContent = student.ticket_token;

  if (qrCodeUrl) {
    document.getElementById('tktQrImage').src = qrCodeUrl;
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
  localStorage.removeItem('student_jwt');
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
      await fetchStudentProfile();
      showAlert('Ticket status refreshed.', 'info');
    });
  }
}
