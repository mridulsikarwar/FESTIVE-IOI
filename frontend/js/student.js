// Student Portal Client Script (Direct Supabase Integration & Google OAuth)

let appConfig = {
  allowedDomains: APP_CONFIG.allowedDomains || [APP_CONFIG.allowedDomain || 'pwioi.com'],
  allowedDomain: APP_CONFIG.allowedDomain || 'pwioi.com',
  googleClientId: APP_CONFIG.googleClientId || '',
  isGoogleConfigured: Boolean(APP_CONFIG.googleClientId)
};

let currentStudent = null;

// Domain validation helpers
function isDomainAllowed(email) {
  if (!email || !email.includes('@')) return false;
  if (!appConfig.allowedDomains || appConfig.allowedDomains.length === 0) return true;
  if (appConfig.allowedDomains.includes('*')) return true;
  const userDomain = email.split('@')[1].toLowerCase().trim();
  return appConfig.allowedDomains.some(d => d.toLowerCase().trim() === userDomain);
}

function getAllowedDomainsLabel() {
  if (!appConfig.allowedDomains || appConfig.allowedDomains.includes('*')) return 'All domains';
  return appConfig.allowedDomains.map(d => '@' + d).join(' or ');
}

// DOM Elements
const authSection = document.getElementById('authSection');
const regSection = document.getElementById('regSection');
const ticketSection = document.getElementById('ticketSection');
const alertBox = document.getElementById('alertBox');
const userHeaderProfile = document.getElementById('userHeaderProfile');
const headerUserName = document.getElementById('headerUserName');
const signOutBtn = document.getElementById('signOutBtn');
const googleSignInBtn = document.getElementById('googleSignInBtn');

// Check for OAuth errors in URL returned by provider
function checkUrlAuthErrors() {
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const params = new URLSearchParams(search.substring(1));
  const hashParams = new URLSearchParams(hash.substring(1));

  const errorDesc = params.get('error_description') || hashParams.get('error_description') || params.get('error') || hashParams.get('error');
  if (errorDesc) {
    const msg = decodeURIComponent(errorDesc).replace(/\+/g, ' ');
    showAlert(`Authentication notice: ${msg}`, 'error');
    const errBox = document.getElementById('googleAuthError');
    if (errBox) {
      errBox.textContent = `Google Auth Notice: ${msg}`;
      errBox.classList.remove('hidden');
    }
  }
}

// Initialize application
function initApp() {
  console.log("FESTIVE-IOI initializing... readyState:", document.readyState, "URL hash:", window.location.hash ? "present" : "none");
  checkUrlAuthErrors();
  setupEventListeners();
  setupDomainDisplay();
  loadDepartments();
  initAuth();
  initGoogleGis();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Setup allowed domain labels
function setupDomainDisplay() {
  const label = getAllowedDomainsLabel();
  document.querySelectorAll('.allowedDomainSpan').forEach(el => el.textContent = label);
  const domainText = document.getElementById('domainText');
  if (domainText) domainText.textContent = label;

  const demoEmailInput = document.getElementById('demoEmail');
  if (demoEmailInput && (!demoEmailInput.value || demoEmailInput.value.includes('@'))) {
    demoEmailInput.value = 'student@' + (appConfig.allowedDomains[0] || 'pwioi.com');
  }
}

// Populate Departments directly from Supabase
async function loadDepartments() {
  const fallbackDepartments = [
    { name: "School of Technology", code: "SOT" },
    { name: "School of Management", code: "SOM" },
    { name: "School of Humanities", code: "SOH" }
  ];

  try {
    const { data: departments, error } = await supabase
      .from('departments')
      .select('name, code')
      .order('name', { ascending: true });

    const list = (departments && departments.length > 0) ? departments : fallbackDepartments;
    const select = document.getElementById('regDepartment');
    if (select) {
      select.innerHTML = '<option value="">-- Select Department --</option>';
      list.forEach(d => {
        const opt = document.createElement('option');
        const label = `${d.name} (${d.code})`;
        opt.value = label;
        opt.textContent = label;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load departments from Supabase:', err);
    const select = document.getElementById('regDepartment');
    if (select) {
      select.innerHTML = '<option value="">-- Select Department --</option>';
      fallbackDepartments.forEach(d => {
        const opt = document.createElement('option');
        const label = `${d.name} (${d.code})`;
        opt.value = label;
        opt.textContent = label;
        select.appendChild(opt);
      });
    }
  }
}

// Calculate direct Supabase Authorize URL
function getGoogleAuthUrl() {
  const redirectUrl = window.location.origin + window.location.pathname;
  return `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
}

// Sign in with Google (Direct Navigation OAuth flow)
function signInWithGoogle(e) {
  if (e) e.preventDefault();

  if (window.location.protocol === 'file:') {
    showAlert("Google OAuth cannot run from a local file:// address. Open http://localhost:8080 or your live Vercel URL.", "error");
    return;
  }

  const authUrl = getGoogleAuthUrl();
  console.log("Redirecting directly to Supabase Google Authorize URL:", authUrl);

  const btn = document.getElementById('googleSignInBtn');
  if (btn) {
    btn.innerHTML = `<i class="ph-bold ph-spinner animate-spin text-lg text-indigo-600"></i><span class="text-slate-700">Redirecting to Google...</span>`;
  }

  window.location.href = authUrl;
}

// Handle Authenticated User (from Supabase OAuth or Google Identity Services)
async function handleAuthenticatedUser(user) {
  const email = (user.email || '').toLowerCase().trim();
  const metadata = user.user_metadata || {};
  const name = metadata.full_name || metadata.name || user.displayName || (email.split('@')[0]);

  if (!email) {
    showAlert('Could not retrieve email from Google authentication.', 'error');
    return;
  }

  // 1. Strict Domain Restriction Check
  if (!isDomainAllowed(email)) {
    const label = getAllowedDomainsLabel();
    const errMsg = `Access Denied: Only accounts ending in ${label} are permitted.`;
    console.warn(errMsg, "Signed in as:", email);
    showAlert(`${errMsg} (Signed in as: ${email})`, 'error');

    const errBox = document.getElementById('googleAuthError');
    if (errBox) {
      errBox.innerHTML = `
        <div class="space-y-1">
          <p class="font-bold text-rose-300">❌ Access Denied: Unauthorized Domain</p>
          <p>Only accounts ending in <strong>${label}</strong> are permitted.</p>
          <p class="text-[11px] text-slate-300">You signed in with: <code class="text-rose-200 bg-rose-900/50 px-1 py-0.5 rounded">${email}</code></p>
          <p class="text-[11px] text-slate-400 mt-1">Please sign out from Google or choose your @pwioi.com / @pw.live account.</p>
        </div>
      `;
      errBox.classList.remove('hidden');
    }

    if (supabase) {
      try { await supabase.auth.signOut(); } catch (e) {}
    }
    localStorage.removeItem('student_email');
    localStorage.removeItem('student_name');
    updateHeaderUser(null);
    showSection('auth');
    return;
  }

  // 2. Persist locally
  localStorage.setItem('student_email', email);
  localStorage.setItem('student_name', name);
  updateHeaderUser(name);

  // Clean URL hash or query if present from OAuth redirect
  if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('id_token') || window.location.hash.includes('error'))) {
    history.replaceState(null, '', window.location.pathname);
  }
  if (window.location.search && (window.location.search.includes('code=') || window.location.search.includes('error='))) {
    history.replaceState(null, '', window.location.pathname);
  }

  // 3. Check if student already exists in Supabase
  await loadStudentProfile(email, name);
}

// Query Supabase for student record
async function loadStudentProfile(email, name) {
  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('*, attendance(*)')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    if (student) {
      // In PostgREST, related tables are returned as an array [] (which is truthy in JS!)
      // Must check length > 0 to determine if ticket was actually scanned at gate
      const isScanned = Array.isArray(student.attendance) ? student.attendance.length > 0 : !!student.attendance;
      const scanRecord = Array.isArray(student.attendance) ? student.attendance[0] : student.attendance;

      currentStudent = {
        ...student,
        attendance_status: isScanned ? 'Present' : 'Pending',
        scanned_at: isScanned && scanRecord ? scanRecord.scanned_at : null
      };
      await renderTicket(currentStudent);
      showSection('ticket');
      subscribeToAttendanceUpdates(student.enrollment_id);
    } else {
      showRegistrationForm(email, name);
    }
  } catch (err) {
    console.error('Supabase query error:', err);
    showRegistrationForm(email, name);
  }
}

// Initialize Auth listeners & session checks
async function initAuth() {
  if (supabase) {
    // 1. Check if URL search has ?code= (PKCE flow return)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      console.log("Detected OAuth code in URL. Exchanging for session...");
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (data && data.user) {
          console.log("PKCE code exchanged successfully for user:", data.user.email);
          await handleAuthenticatedUser(data.user);
          return;
        }
      } catch (err) {
        console.warn("exchangeCodeForSession error:", err);
      }
    }

    // 2. Check if URL hash has #access_token= (Implicit flow return)
    const hash = window.location.hash || '';
    if (hash && hash.includes('access_token=')) {
      console.log("Detected access token in URL hash. Decoding and setting session...");
      try {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken) {
          const payload = decodeJwt(accessToken);
          try {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || ''
            });
          } catch (setErr) {
            console.warn("supabase.auth.setSession notice:", setErr);
          }

          if (payload && payload.email) {
            console.log("Authenticated user extracted from URL token:", payload.email);
            await handleAuthenticatedUser({
              email: payload.email,
              user_metadata: payload.user_metadata || { full_name: payload.name }
            });
            return;
          }
        }
      } catch (err) {
        console.warn("Hash token parsing error:", err);
      }
    }

    // 3. Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth State Changed:", event, session?.user?.email);
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session && session.user) {
        await handleAuthenticatedUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        currentStudent = null;
        updateHeaderUser(null);
        showSection('auth');
      }
    });

    // 4. Check active Supabase session
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!error && session && session.user) {
        console.log("Active Supabase session detected:", session.user.email);
        await handleAuthenticatedUser(session.user);
        return;
      }
    } catch (e) {
      console.warn('Error reading Supabase session:', e);
    }
  }

  // 5. Fallback to cached student session in localStorage
  await checkExistingSession();
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
  await loadStudentProfile(savedEmail, savedName || '');
}

// Helper: Decode JWT from GIS
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

// Optional Google Identity Services (GIS) One Tap / Button
function initGoogleGis() {
  if (window.google && appConfig.googleClientId) {
    try {
      google.accounts.id.initialize({
        client_id: appConfig.googleClientId,
        callback: async (response) => {
          if (response.credential) {
            const payload = decodeJwt(response.credential);
            if (payload && payload.email) {
              await handleAuthenticatedUser({
                email: payload.email,
                user_metadata: {
                  full_name: payload.name || payload.given_name,
                  picture: payload.picture
                }
              });
            }
          }
        }
      });

      const wrapper = document.getElementById('googleBtnWrapper');
      if (wrapper) {
        google.accounts.id.renderButton(wrapper, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with'
        });
      }
    } catch (e) {
      console.warn('Google Identity Services init notice:', e);
    }
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
      attendance_status: 'Pending',
      scanned_at: null
    };

    await renderTicket(currentStudent);
    showSection('ticket');
    subscribeToAttendanceUpdates(newStudent.enrollment_id);
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
    const scanTimeStr = student.scanned_at ? ` at ${new Date(student.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    text.textContent = `✅ CHECKED IN (ATTENDANCE VERIFIED${scanTimeStr.toUpperCase()})`;
  } else {
    badge.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 bg-amber-100 text-amber-900 border border-amber-300';
    icon.className = 'ph-bold ph-clock text-amber-600 text-sm';
    text.textContent = '🎟️ VALID TICKET (PENDING GATE SCAN)';
  }
}

// Real-time listener: As soon as admin scans ticket at the gate, student screen updates instantly!
let attendanceSubscription = null;
function subscribeToAttendanceUpdates(enrollmentId) {
  if (!supabase || !enrollmentId) return;
  try {
    if (attendanceSubscription) {
      supabase.removeChannel(attendanceSubscription);
      attendanceSubscription = null;
    }

    attendanceSubscription = supabase
      .channel(`student-gate-${enrollmentId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'attendance',
        filter: `enrollment_id=eq.${enrollmentId}`
      }, (payload) => {
        console.log('Gate scan event received:', payload);
        if (currentStudent && currentStudent.enrollment_id === enrollmentId) {
          currentStudent.attendance_status = 'Present';
          currentStudent.scanned_at = payload.new ? payload.new.scanned_at : new Date().toISOString();
          renderTicket(currentStudent);
          if (window.confetti) {
            confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
          }
          showAlert('🎉 Welcome to FESTIVE IOI! Attendance verified at entrance gate.', 'success');
        }
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription notice:', e);
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
async function handleSignOut() {
  try {
    if (attendanceSubscription && supabase) {
      supabase.removeChannel(attendanceSubscription);
      attendanceSubscription = null;
    }
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch (e) {
    console.warn('Sign out error:', e);
  }
  localStorage.removeItem('student_email');
  localStorage.removeItem('student_name');
  currentStudent = null;
  updateHeaderUser(null);
  showSection('auth');
  showAlert('You have been signed out successfully.', 'info');
}

// Manual Test Auth
async function handleInstantAuth(e) {
  e.preventDefault();
  const name = document.getElementById('demoName').value.trim();
  const email = document.getElementById('demoEmail').value.trim().toLowerCase();

  // 1. Strict Domain Restriction Check
  if (!isDomainAllowed(email)) {
    const label = getAllowedDomainsLabel();
    showAlert(`Access Denied: Only accounts ending in ${label} are permitted.`, 'error');
    return;
  }

  // 2. Save session locally
  localStorage.setItem('student_email', email);
  localStorage.setItem('student_name', name);
  updateHeaderUser(name);

  // 3. Load profile
  await loadStudentProfile(email, name);
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
  if (googleSignInBtn) {
    googleSignInBtn.href = getGoogleAuthUrl();
    googleSignInBtn.addEventListener('click', signInWithGoogle);
  }

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
