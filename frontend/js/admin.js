// Admin Portal Client Script (Direct Supabase Integration)

let isAdminLoggedIn = localStorage.getItem('admin_logged_in') === 'true';
let html5QrScanner = null;
let isScannerRunning = false;
let datasheetData = [];
let audioCtx = null;
let recentScans = [];

// DOM Elements
const adminLoginSection = document.getElementById('adminLoginSection');
const adminDashboardSection = document.getElementById('adminDashboardSection');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminAlert = document.getElementById('adminAlert');
const adminControls = document.getElementById('adminControls');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

const tabScannerBtn = document.getElementById('tabScannerBtn');
const tabPaymentsBtn = document.getElementById('tabPaymentsBtn');
const tabDataSheetBtn = document.getElementById('tabDataSheetBtn');
const scannerView = document.getElementById('scannerView');
const paymentsView = document.getElementById('paymentsView');
const datasheetView = document.getElementById('datasheetView');

const pendingPaymentsCountBadge = document.getElementById('pendingPaymentsCountBadge');
const paymentsBody = document.getElementById('paymentsBody');
const paymentSearch = document.getElementById('paymentSearch');
const filterPaymentStatus = document.getElementById('filterPaymentStatus');
const statGuestTotal = document.getElementById('statGuestTotal');
const statGuestPending = document.getElementById('statGuestPending');
const statGuestApproved = document.getElementById('statGuestApproved');

const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const manualScanForm = document.getElementById('manualScanForm');
const manualInput = document.getElementById('manualInput');
const scanResultBox = document.getElementById('scanResultBox');
const recentScansList = document.getElementById('recentScansList');

const refreshDataBtn = document.getElementById('refreshDataBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const tableSearch = document.getElementById('tableSearch');
const filterStatus = document.getElementById('filterStatus');
const filterDept = document.getElementById('filterDept');
const filterYear = document.getElementById('filterYear');
const datasheetBody = document.getElementById('datasheetBody');
const recordCount = document.getElementById('recordCount');

let paymentsData = [];

// System Config for Live Registration Gates
let systemConfig = {
  pw_registration_open: 'true',
  guest_registration_open: 'true'
};

// Initialize
function initAdmin() {
  setupEventListeners();
  checkAdminSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}

// Audio Feedback System using Web Audio API
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSuccessChime() {
  try {
    initAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, now + 0.15); // G5
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.45);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

function playErrorBuzzer() {
  try {
    initAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.35);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// Session Check
async function checkAdminSession() {
  if (isAdminLoggedIn) {
    showDashboard();
    await loadDepartmentsFilter();
    await loadStats();
    await loadSystemConfig();
    await loadPayments();
    await loadDatasheet();
    setupRealtimeSubscription();
  } else {
    showLogin();
  }
}

// Login Handler
async function handleAdminLogin(e) {
  e.preventDefault();
  const password = document.getElementById('adminPasscode').value;

  if (password === APP_CONFIG.adminPasscode) {
    isAdminLoggedIn = true;
    localStorage.setItem('admin_logged_in', 'true');
    showAdminAlert('Authenticated successfully! Welcome, Staff.', 'success');
    showDashboard();
    await loadDepartmentsFilter();
    await loadStats();
    await loadSystemConfig();
    await loadPayments();
    await loadDatasheet();
    setupRealtimeSubscription();
  } else {
    showAdminAlert('Invalid admin passcode.', 'error');
  }
}

function handleAdminLogout() {
  stopCamera();
  localStorage.removeItem('admin_logged_in');
  isAdminLoggedIn = false;
  showLogin();
  showAdminAlert('Logged out of Admin Gate.', 'info');
}

// View Switches
function showLogin() {
  adminLoginSection.classList.remove('hidden');
  adminDashboardSection.classList.add('hidden');
  adminControls.classList.add('hidden');
  adminControls.classList.remove('flex');
}

function showDashboard() {
  adminLoginSection.classList.add('hidden');
  adminDashboardSection.classList.remove('hidden');
  adminControls.classList.remove('hidden');
  adminControls.classList.add('flex');
}

function switchTab(tab) {
  const activeClass = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm';
  const inactiveClass = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200';

  if (tab === 'scanner') {
    tabScannerBtn.className = activeClass;
    if (tabPaymentsBtn) tabPaymentsBtn.className = inactiveClass;
    tabDataSheetBtn.className = inactiveClass;
    scannerView.classList.remove('hidden');
    if (paymentsView) paymentsView.classList.add('hidden');
    datasheetView.classList.add('hidden');
  } else if (tab === 'payments') {
    if (tabPaymentsBtn) tabPaymentsBtn.className = activeClass;
    tabScannerBtn.className = inactiveClass;
    tabDataSheetBtn.className = inactiveClass;
    scannerView.classList.add('hidden');
    if (paymentsView) paymentsView.classList.remove('hidden');
    datasheetView.classList.add('hidden');
    loadPayments();
  } else {
    tabDataSheetBtn.className = activeClass;
    tabScannerBtn.className = inactiveClass;
    if (tabPaymentsBtn) tabPaymentsBtn.className = inactiveClass;
    scannerView.classList.add('hidden');
    if (paymentsView) paymentsView.classList.add('hidden');
    datasheetView.classList.remove('hidden');
    loadDatasheet();
  }
}

// Live Camera Scanner using Html5Qrcode
async function toggleCamera() {
  if (isScannerRunning) {
    stopCamera();
  } else {
    startCamera();
  }
}

async function startCamera() {
  try {
    initAudio();
    if (!html5QrScanner) {
      html5QrScanner = new Html5Qrcode("reader");
    }

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await html5QrScanner.start(
      { facingMode: "environment" },
      config,
      onQrCodeSuccess,
      () => {}
    );

    isScannerRunning = true;
    toggleCameraBtn.textContent = 'Stop Camera';
    toggleCameraBtn.className = 'px-2.5 py-1 rounded-md text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white transition';
  } catch (err) {
    console.error('Camera start error:', err);
    showAdminAlert('Could not start camera: ' + (err.message || 'Check camera permissions'), 'error');
  }
}

async function stopCamera() {
  if (html5QrScanner && isScannerRunning) {
    try {
      await html5QrScanner.stop();
      isScannerRunning = false;
      toggleCameraBtn.textContent = 'Start Camera';
      toggleCameraBtn.className = 'px-2.5 py-1 rounded-md text-xs font-medium bg-white hover:bg-zinc-200 text-zinc-950 transition';
    } catch (err) {
      console.warn('Camera stop notice:', err);
    }
  }
}

// Throttle scan triggers
let isProcessingScan = false;
async function onQrCodeSuccess(decodedText) {
  if (isProcessingScan) return;
  isProcessingScan = true;

  await verifyAndMarkTicket(decodedText);

  setTimeout(() => {
    isProcessingScan = false;
  }, 2500);
}

// Verify Ticket with Supabase (CRITICAL: Once scanned, CANNOT be scanned again!)
async function verifyAndMarkTicket(qrData) {
  try {
    let ticketToken = null;
    let enrollmentId = null;
    let rawSearch = '';

    if (typeof qrData === 'object' && qrData !== null) {
      ticketToken = qrData.ticket_token || qrData.ticketToken || qrData.token || qrData.ticket || null;
      enrollmentId = qrData.enrollment_id || qrData.enrollmentId || qrData.roll_no || qrData.rollNo || qrData.id || null;
    } else if (typeof qrData === 'string' || typeof qrData === 'number') {
      const clean = String(qrData).trim();
      rawSearch = clean;

      let parsed = null;
      try {
        let jsonCandidate = clean;
        if (jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}')) {
          if (!jsonCandidate.includes('"') && jsonCandidate.includes("'")) {
            jsonCandidate = jsonCandidate.replace(/'/g, '"');
          }
        }
        parsed = JSON.parse(jsonCandidate);
      } catch (e) {
        parsed = null;
      }

      // ONLY treat as JSON payload if it parsed into a non-null object (not a primitive number like 2501030001!)
      if (parsed && typeof parsed === 'object') {
        ticketToken = parsed.ticket_token || parsed.ticketToken || parsed.token || parsed.ticket || null;
        enrollmentId = parsed.enrollment_id || parsed.enrollmentId || parsed.roll_no || parsed.rollNo || parsed.id || null;
      } else {
        // Primitive string, numeric roll number (e.g. 2501030001), URL, or ticket token
        if (clean.startsWith('http://') || clean.startsWith('https://')) {
          try {
            const urlObj = new URL(clean);
            ticketToken = urlObj.searchParams.get('ticket_token') || urlObj.searchParams.get('token') || urlObj.searchParams.get('ticket') || urlObj.searchParams.get('tkt');
            enrollmentId = urlObj.searchParams.get('enrollment_id') || urlObj.searchParams.get('id') || urlObj.searchParams.get('roll') || urlObj.searchParams.get('roll_no');
          } catch (urlErr) {}
        }
        if (!ticketToken && !enrollmentId) {
          if (clean.toUpperCase().startsWith('TKT-')) {
            ticketToken = clean.toUpperCase();
          } else {
            enrollmentId = clean;
          }
        }
      }
    }

    ticketToken = ticketToken ? String(ticketToken).trim().toUpperCase() : null;
    enrollmentId = enrollmentId ? String(enrollmentId).trim() : null;

    console.log('[Scanner] Resolving ticket:', { ticketToken, enrollmentId, rawSearch });

    // 1. Find Student in Supabase using resilient multi-strategy lookup
    let student = null;

    // Strategy 1: Look up by ticketToken
    if (ticketToken) {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('ticket_token', ticketToken)
        .maybeSingle();
      if (!error && data) student = data;
    }

    // Strategy 2: Look up by enrollmentId (direct match or uppercase)
    if (!student && enrollmentId) {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('enrollment_id', enrollmentId)
        .maybeSingle();
      if (!error && data) {
        student = data;
      } else {
        const upperId = enrollmentId.toUpperCase();
        if (upperId !== enrollmentId) {
          const resUpper = await supabase
            .from('students')
            .select('*')
            .eq('enrollment_id', upperId)
            .maybeSingle();
          if (!resUpper.error && resUpper.data) student = resUpper.data;
        }
      }
    }

    // Strategy 3: Fallback lookup by email or phone
    if (!student && rawSearch) {
      if (rawSearch.includes('@')) {
        const { data } = await supabase
          .from('students')
          .select('*')
          .eq('email', rawSearch.toLowerCase())
          .maybeSingle();
        if (data) student = data;
      } else if (/^\d{10}$/.test(rawSearch)) {
        const { data } = await supabase
          .from('students')
          .select('*')
          .eq('phone', rawSearch)
          .maybeSingle();
        if (data) student = data;
      }
    }

    if (!student) {
      console.warn('[Scanner] No matching attendee found for query:', { ticketToken, enrollmentId, rawSearch });
      playErrorBuzzer();
      renderScanResult('invalid', { message: 'Ticket not found in cloud database.' });
      return;
    }

    // 2. CHECK PAYMENT STATUS (For External Guests)
    if (student.payment_status === 'pending_verification') {
      playErrorBuzzer();
      renderScanResult('payment_pending', { student });
      addRecentScan(student, 'PAYMENT UNVERIFIED', new Date().toISOString());
      return;
    }

    if (student.payment_status === 'rejected') {
      playErrorBuzzer();
      renderScanResult('payment_rejected', { student });
      addRecentScan(student, 'PAYMENT REJECTED', new Date().toISOString());
      return;
    }

    // 3. CHECK IF TICKET HAS ALREADY BEEN SCANNED
    const { data: existingScan } = await supabase
      .from('attendance')
      .select('*')
      .eq('enrollment_id', student.enrollment_id)
      .maybeSingle();

    if (existingScan) {
      // DUPLICATE SCAN REJECTED!
      playErrorBuzzer();
      renderScanResult('already_scanned', {
        student,
        scannedAt: existingScan.scanned_at
      });
      addRecentScan(student, 'DUPLICATE REJECTED', existingScan.scanned_at);
      return;
    }

    // 4. RECORD FRESH ATTENDANCE IN SUPABASE
    const scanTime = new Date().toISOString();
    const { error: insertError } = await supabase
      .from('attendance')
      .insert({
        enrollment_id: student.enrollment_id,
        status: 'Present',
        scanned_at: scanTime,
        scanned_by: 'Admin Scanner'
      });

    if (insertError) {
      playErrorBuzzer();
      renderScanResult('already_scanned', { student, scannedAt: scanTime });
      return;
    }

    // 5. ENTRY APPROVED!
    playSuccessChime();
    renderScanResult('success', {
      student,
      scannedAt: scanTime
    });
    addRecentScan(student, 'VERIFIED', scanTime);
    await loadStats();
    await loadDatasheet();
  } catch (err) {
    playErrorBuzzer();
    renderScanResult('error', { message: 'Network communication failure during verification' });
  }
}

// Render Result Card in Scanner View
function renderScanResult(type, data) {
  if (type === 'success') {
    const s = data.student;
    const roleLabel = s.user_type === 'guest'
      ? `${s.company || 'External'} (Guest Pass)`
      : (s.year === 'Faculty' ? `${s.department} (Faculty)` : `${s.department} (Yr ${s.year})`);

    scanResultBox.className = 'solid-card rounded-xl p-6 transition-all border border-emerald-600/50 bg-emerald-950/20 text-center';
    scanResultBox.innerHTML = `
      <div class="w-12 h-12 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-2xl mx-auto mb-3 border border-emerald-500/20">
        <i class="ph-bold ph-check-circle"></i>
      </div>
      <span class="px-2.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider inline-block mb-1.5">
        Entry Approved
      </span>
      <h3 class="text-base font-semibold text-zinc-100">${s.name}</h3>
      <p class="text-xs font-mono text-zinc-400 mt-0.5">${s.enrollment_id}</p>
      
      <div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-zinc-800 text-xs text-left">
        <div>
          <span class="text-zinc-500 block text-[10px]">Affiliation / Role</span>
          <span class="text-zinc-300 font-medium truncate">${roleLabel}</span>
        </div>
        <div>
          <span class="text-zinc-500 block text-[10px]">Contact</span>
          <span class="text-zinc-300 font-medium">${s.phone}</span>
        </div>
      </div>
      <p class="text-[11px] text-zinc-400 mt-3 flex items-center justify-center space-x-1">
        <i class="ph ph-clock"></i>
        <span>Marked Present at ${new Date(data.scannedAt).toLocaleTimeString()}</span>
      </p>
    `;
  } else if (type === 'payment_pending') {
    const s = data.student;
    scanResultBox.className = 'solid-card rounded-xl p-6 transition-all border border-amber-600/50 bg-amber-950/20 text-center';
    scanResultBox.innerHTML = `
      <div class="w-12 h-12 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center text-2xl mx-auto mb-3 border border-amber-500/20">
        <i class="ph-bold ph-hourglass-high"></i>
      </div>
      <span class="px-2.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider inline-block mb-1.5">
        Payment Pending Verification
      </span>
      <h3 class="text-base font-semibold text-zinc-100">${s.name}</h3>
      <p class="text-xs font-mono text-amber-300 mt-0.5">${s.enrollment_id} &bull; ${s.company || 'External Guest'}</p>

      <div class="p-3 mt-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-left space-y-1.5">
        <div class="flex justify-between">
          <span class="text-zinc-500">Amount Due:</span>
          <span class="font-bold text-emerald-400">₹500.00</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-zinc-500">Submitted UTR:</span>
          <span class="font-mono font-bold text-amber-300 select-all">${s.utr_number || 'N/A'}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-zinc-500">Contact:</span>
          <span class="text-zinc-300">${s.phone}</span>
        </div>
      </div>

      <button onclick="approveAndCheckIn('${s.enrollment_id}')"
              class="btn-primary w-full py-2.5 px-3 mt-3.5 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-md">
        <i class="ph-bold ph-check"></i>
        <span>Confirm Payment & Check In Now</span>
      </button>
    `;
  } else if (type === 'payment_rejected') {
    const s = data.student;
    scanResultBox.className = 'solid-card rounded-xl p-6 transition-all border border-rose-600/50 bg-rose-950/20 text-center';
    scanResultBox.innerHTML = `
      <div class="w-12 h-12 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center text-2xl mx-auto mb-3 border border-rose-500/20">
        <i class="ph-bold ph-x-circle"></i>
      </div>
      <span class="px-2.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider inline-block mb-1.5">
        Payment Rejected
      </span>
      <h3 class="text-base font-semibold text-zinc-100">${s ? s.name : 'Unknown Attendee'}</h3>
      <p class="text-xs font-mono text-rose-300 mt-0.5">${s ? s.enrollment_id : ''}</p>
      <p class="text-xs text-zinc-400 mt-2">The ₹500 payment submission for this pass was rejected by staff.</p>
    `;
  } else if (type === 'already_scanned') {
    const s = data.student;
    const formattedTime = new Date(data.scannedAt).toLocaleString();
    scanResultBox.className = 'solid-card rounded-xl p-6 transition-all border border-rose-600/50 bg-rose-950/20 text-center';
    scanResultBox.innerHTML = `
      <div class="w-12 h-12 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center text-2xl mx-auto mb-3 border border-rose-500/20">
        <i class="ph-bold ph-prohibit"></i>
      </div>
      <span class="px-2.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider inline-block mb-1.5">
        Duplicate Scan Rejected
      </span>
      <h3 class="text-base font-semibold text-zinc-100">${s ? s.name : 'Unknown Attendee'}</h3>
      <p class="text-xs font-mono text-rose-300 mt-0.5">${s ? s.enrollment_id : ''}</p>
      
      <div class="p-3 mt-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
        <p class="font-medium text-rose-300">Ticket has already been used</p>
        <p class="text-[11px] mt-1 text-zinc-400">
          Scanned on: <strong>${formattedTime}</strong>
        </p>
      </div>
    `;
  } else {
    scanResultBox.className = 'solid-card rounded-xl p-6 transition-all border border-amber-600/50 bg-amber-950/20 text-center';
    scanResultBox.innerHTML = `
      <div class="w-12 h-12 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center text-2xl mx-auto mb-3 border border-amber-500/20">
        <i class="ph-bold ph-warning-circle"></i>
      </div>
      <span class="px-2.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider inline-block mb-1.5">
        Invalid Ticket
      </span>
      <p class="text-xs text-zinc-300 font-medium mt-1">${data.message || 'Ticket not found in cloud database.'}</p>
      <p class="text-[11px] text-zinc-500 mt-1.5">Check if attendee is registered.</p>
    `;
  }
}

// 1-Click Approve Payment and Immediately Admit Attendee
async function approveAndCheckIn(enrollmentId) {
  try {
    showAdminAlert(`Approving payment for ${enrollmentId}...`, 'info');
    const { error: updateError } = await supabase
      .from('students')
      .update({ payment_status: 'approved' })
      .eq('enrollment_id', enrollmentId);

    if (updateError) throw updateError;

    showAdminAlert(`Payment approved! Admitting attendee...`, 'success');
    await loadPayments();
    await verifyAndMarkTicket(enrollmentId);
  } catch (e) {
    showAdminAlert(`Approval error: ${e.message || e}`, 'error');
  }
}
window.approveAndCheckIn = approveAndCheckIn;

// Add to Recent Scans Activity Log
function addRecentScan(student, status, timestamp) {
  if (!student) return;
  recentScans.unshift({
    name: student.name,
    enrollment: student.enrollment_id,
    dept: student.department,
    status,
    time: new Date(timestamp).toLocaleTimeString()
  });

  if (recentScans.length > 8) recentScans.pop();

  recentScansList.innerHTML = recentScans.map(item => `
    <div class="p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-center justify-between text-xs">
      <div>
        <p class="font-medium text-zinc-200">${item.name} <span class="font-mono text-[11px] text-zinc-500">(${item.enrollment})</span></p>
        <p class="text-[10px] text-zinc-500">${item.dept}</p>
      </div>
      <div class="text-right">
        <span class="text-[10px] font-medium px-2 py-0.5 rounded ${item.status === 'VERIFIED' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/50' : 'bg-rose-950/60 text-rose-400 border border-rose-900/50'}">
          ${item.status}
        </span>
        <p class="text-[10px] text-zinc-500 mt-0.5">${item.time}</p>
      </div>
    </div>
  `).join('');
}

// Load Stats from Supabase
async function loadStats() {
  try {
    const { count: total } = await supabase.from('students').select('*', { count: 'exact', head: true });
    const { count: present } = await supabase.from('attendance').select('*', { count: 'exact', head: true });

    const totalCount = total || 0;
    const presentCount = present || 0;
    const pendingCount = Math.max(0, totalCount - presentCount);
    const rate = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

    document.getElementById('statTotal').textContent = totalCount;
    document.getElementById('statPresent').textContent = presentCount;
    document.getElementById('statPending').textContent = pendingCount;
    document.getElementById('statRate').textContent = rate + '%';
  } catch (e) {
    console.error('Stats load error:', e);
  }
}

// Load Departments for Filter from Supabase
async function loadDepartmentsFilter() {
  const fallbackDepartments = [
    { name: "School of Technology", code: "SOT" },
    { name: "School of Management", code: "SOM" },
    { name: "School of Healthcare", code: "SOH" }
  ];

  try {
    const { data: departments } = await supabase.from('departments').select('name, code').order('name');
    const list = (departments && departments.length > 0) ? departments : fallbackDepartments;

    if (filterDept) {
      filterDept.innerHTML = '<option value="ALL">All Departments</option>';
      list.forEach(d => {
        const opt = document.createElement('option');
        const deptLabel = `${d.name} (${d.code})`;
        opt.value = deptLabel;
        opt.textContent = deptLabel;
        filterDept.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Dept filter load error:', e);
    if (filterDept) {
      filterDept.innerHTML = '<option value="ALL">All Departments</option>';
      fallbackDepartments.forEach(d => {
        const opt = document.createElement('option');
        const deptLabel = `${d.name} (${d.code})`;
        opt.value = deptLabel;
        opt.textContent = deptLabel;
        filterDept.appendChild(opt);
      });
    }
  }
}

// Load Payments from Supabase (External Guests UPI ₹500)
async function loadPayments() {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .or('user_type.eq.guest,amount_paid.gt.0,utr_number.not.is.null')
      .order('registered_at', { ascending: false });

    if (error) throw error;
    paymentsData = data || [];

    // Stats
    const total = paymentsData.length;
    const pending = paymentsData.filter(p => p.payment_status === 'pending_verification').length;
    const approved = paymentsData.filter(p => p.payment_status === 'approved').length;

    if (statGuestTotal) statGuestTotal.textContent = total;
    if (statGuestPending) statGuestPending.textContent = pending;
    if (statGuestApproved) statGuestApproved.textContent = approved;

    if (pendingPaymentsCountBadge) {
      if (pending > 0) {
        pendingPaymentsCountBadge.textContent = pending;
        pendingPaymentsCountBadge.classList.remove('hidden');
      } else {
        pendingPaymentsCountBadge.classList.add('hidden');
      }
    }

    renderPaymentsTable();
  } catch (e) {
    console.error('Payments load error:', e);
  }
}

// Render Payments Table
function renderPaymentsTable() {
  if (!paymentsBody) return;
  const searchTerm = (paymentSearch ? paymentSearch.value : '').toLowerCase().trim();
  const statusFilter = filterPaymentStatus ? filterPaymentStatus.value : 'ALL';

  const filtered = paymentsData.filter(row => {
    const matchSearch = !searchTerm ||
      (row.name && row.name.toLowerCase().includes(searchTerm)) ||
      (row.enrollment_id && row.enrollment_id.toLowerCase().includes(searchTerm)) ||
      (row.company && row.company.toLowerCase().includes(searchTerm)) ||
      (row.utr_number && row.utr_number.toLowerCase().includes(searchTerm)) ||
      (row.phone && row.phone.includes(searchTerm));

    const matchStatus = (statusFilter === 'ALL') || (row.payment_status === statusFilter);
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    paymentsBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-zinc-500">
          No external guest payments match the filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  paymentsBody.innerHTML = filtered.map(p => {
    const isPending = p.payment_status === 'pending_verification';
    const isApproved = p.payment_status === 'approved';

    let statusBadge = '';
    if (isPending) {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/60">Pending</span>';
    } else if (isApproved) {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">Approved</span>';
    } else {
      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-950/60 text-rose-400 border border-rose-800/60">Rejected</span>';
    }

    return `
      <tr class="hover:bg-zinc-900/40 transition">
        <td class="py-2.5 px-3.5 font-mono text-zinc-300 font-medium whitespace-nowrap">${p.enrollment_id}</td>
        <td class="py-2.5 px-3.5 font-semibold text-zinc-100 whitespace-nowrap">${p.name}</td>
        <td class="py-2.5 px-3.5 text-zinc-300">${p.company || 'External Guest'}</td>
        <td class="py-2.5 px-3.5 text-zinc-400 whitespace-nowrap">
          <div>${p.phone}</div>
          <div class="text-[10px] text-zinc-500 truncate max-w-[150px]">${p.email}</div>
        </td>
        <td class="py-2.5 px-3.5 font-mono font-bold text-amber-400 whitespace-nowrap select-all">
          <div class="flex items-center space-x-1">
            <span>${p.utr_number || 'N/A'}</span>
            ${p.utr_number ? `<button onclick="navigator.clipboard.writeText('${p.utr_number}'); showAdminAlert('UTR copied!', 'success');" title="Copy UTR" class="p-1 text-zinc-500 hover:text-zinc-200"><i class="ph ph-copy text-xs"></i></button>` : ''}
          </div>
        </td>
        <td class="py-2.5 px-3.5 text-center font-bold text-emerald-400 font-mono whitespace-nowrap">₹${p.amount_paid || 500}</td>
        <td class="py-2.5 px-3.5 whitespace-nowrap">${statusBadge}</td>
        <td class="py-2.5 px-3.5 text-center whitespace-nowrap">
          ${isPending ? `
            <div class="inline-flex space-x-1.5">
              <button onclick="approveGuestPayment('${p.enrollment_id}')"
                      class="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition inline-flex items-center space-x-1 shadow-sm">
                <i class="ph-bold ph-check"></i>
                <span>Approve</span>
              </button>
              <button onclick="rejectGuestPayment('${p.enrollment_id}')"
                      class="px-2 py-1 rounded text-xs text-rose-400 hover:bg-rose-950/40 border border-rose-900/40 transition">
                <span>Reject</span>
              </button>
            </div>
          ` : `
            <span class="text-xs text-zinc-500 italic">${isApproved ? 'Verified' : 'Rejected'}</span>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

async function approveGuestPayment(enrollmentId) {
  try {
    showAdminAlert(`Approving payment for ${enrollmentId}...`, 'info');
    const { error } = await supabase
      .from('students')
      .update({ payment_status: 'approved' })
      .eq('enrollment_id', enrollmentId);

    if (error) throw error;
    showAdminAlert(`Payment for ${enrollmentId} approved successfully!`, 'success');
    await loadPayments();
    await loadDatasheet();
  } catch (e) {
    showAdminAlert(`Approval error: ${e.message || e}`, 'error');
  }
}
window.approveGuestPayment = approveGuestPayment;

async function rejectGuestPayment(enrollmentId) {
  if (!confirm(`Reject payment submission for ${enrollmentId}?`)) return;
  try {
    const { error } = await supabase
      .from('students')
      .update({ payment_status: 'rejected' })
      .eq('enrollment_id', enrollmentId);

    if (error) throw error;
    showAdminAlert(`Payment for ${enrollmentId} marked as rejected.`, 'info');
    await loadPayments();
    await loadDatasheet();
  } catch (e) {
    showAdminAlert(`Reject error: ${e.message || e}`, 'error');
  }
}
window.rejectGuestPayment = rejectGuestPayment;

// Load Datasheet from Supabase
async function loadDatasheet() {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*, attendance(*)')
      .order('registered_at', { ascending: false });

    if (error) throw error;

    datasheetData = (data || []).map(s => {
      const isScanned = Array.isArray(s.attendance) ? s.attendance.length > 0 : !!s.attendance;
      const attRecord = Array.isArray(s.attendance) ? s.attendance[0] : s.attendance;
      return {
        enrollment_id: s.enrollment_id,
        name: s.name,
        department: s.department || s.company || 'External Guest',
        company: s.company,
        user_type: s.user_type,
        year: s.year || (s.user_type === 'guest' ? 'Guest' : 'N/A'),
        phone: s.phone,
        email: s.email,
        amount_paid: s.amount_paid,
        utr_number: s.utr_number,
        payment_status: s.payment_status || 'approved',
        registered_at: s.registered_at,
        attendance_status: isScanned ? 'Present' : 'Not Scanned',
        scanned_at: isScanned && attRecord ? attRecord.scanned_at : null
      };
    });

    renderDatasheetTable();
  } catch (err) {
    console.error('Datasheet load error:', err);
  }
}

// Setup Realtime Updates from Supabase
function setupRealtimeSubscription() {
  try {
    supabase
      .channel('attendance-gate-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        loadStats();
        loadPayments();
        loadDatasheet();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadStats();
        loadPayments();
        loadDatasheet();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription notice:', e);
  }
}

// Filter and Render Datasheet Table
function renderDatasheetTable() {
  const searchTerm = (tableSearch.value || '').toLowerCase().trim();
  const statusFilter = filterStatus.value;
  const deptFilter = filterDept.value;
  const yearFilter = filterYear.value;

  const filtered = datasheetData.filter(row => {
    const matchSearch = !searchTerm ||
      (row.enrollment_id && row.enrollment_id.toLowerCase().includes(searchTerm)) ||
      (row.name && row.name.toLowerCase().includes(searchTerm)) ||
      (row.department && row.department.toLowerCase().includes(searchTerm)) ||
      (row.company && row.company.toLowerCase().includes(searchTerm)) ||
      (row.utr_number && row.utr_number.toLowerCase().includes(searchTerm)) ||
      (row.phone && row.phone.includes(searchTerm)) ||
      (row.email && row.email.toLowerCase().includes(searchTerm));

    const matchStatus = (statusFilter === 'ALL') || (row.attendance_status === statusFilter);
    const matchDept = (deptFilter === 'ALL') || 
      (row.department === deptFilter) ||
      (row.department && deptFilter.includes(row.department)) ||
      (row.department && row.department.includes(deptFilter));
    const matchYear = (yearFilter === 'ALL') || (String(row.year) === yearFilter);

    return matchSearch && matchStatus && matchDept && matchYear;
  });

  recordCount.textContent = filtered.length;

  if (filtered.length === 0) {
    datasheetBody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-8 text-slate-500">
          No records match the active search or filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  datasheetBody.innerHTML = filtered.map(row => {
    const isPresent = row.attendance_status === 'Present';
    const scanTimeFormatted = row.scanned_at 
      ? new Date(row.scanned_at).toLocaleString('en-US', { hour12: true, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    let payBadge = '';
    if (row.payment_status === 'pending_verification') {
      payBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/60">₹500 Pending</span>';
    } else if (row.amount_paid > 0) {
      payBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">₹500 Paid</span>';
    } else {
      payBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">Free (PW)</span>';
    }

    return `
      <tr class="hover:bg-zinc-900/40 transition">
        <td class="py-2.5 px-3.5 font-mono font-medium text-zinc-200 whitespace-nowrap">${row.enrollment_id}</td>
        <td class="py-2.5 px-3.5 font-medium text-zinc-100 whitespace-nowrap">${row.name}</td>
        <td class="py-2.5 px-3.5 text-zinc-400">${row.department}</td>
        <td class="py-2.5 px-3.5 text-center font-medium text-zinc-300 whitespace-nowrap">${row.year === 'Faculty' ? 'Faculty' : (row.year === 'Guest' ? 'Guest' : 'Yr ' + row.year)}</td>
        <td class="py-2.5 px-3.5 font-mono text-zinc-400 whitespace-nowrap">${row.phone}</td>
        <td class="py-2.5 px-3.5 text-zinc-400 truncate max-w-xs" title="${row.email}">${row.email}</td>
        <td class="py-2.5 px-3.5 whitespace-nowrap">${payBadge}</td>
        <td class="py-2.5 px-3.5 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-medium flex items-center space-x-1.5 w-fit ${
            isPresent 
              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' 
              : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
          }">
            <i class="ph ${isPresent ? 'ph-check-circle text-emerald-400' : 'ph-clock text-zinc-500'}"></i>
            <span>${row.attendance_status}</span>
          </span>
        </td>
        <td class="py-2.5 px-3.5 font-mono text-zinc-400 whitespace-nowrap text-[11px]">${scanTimeFormatted}</td>
        <td class="py-2.5 px-3.5 text-center whitespace-nowrap">
          <button onclick="handleDeleteStudent('${row.enrollment_id}', '${encodeURIComponent(row.name)}')"
                  title="Delete student record"
                  class="px-2 py-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-rose-950/30 border border-transparent hover:border-rose-900/40 text-xs transition inline-flex items-center space-x-1">
            <i class="ph ph-trash text-xs"></i>
            <span>Delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Delete Student (Admin Action)
async function handleDeleteStudent(enrollmentId, encodedName) {
  const name = decodeURIComponent(encodedName || '');
  const confirmed = confirm(
    `Delete attendee record?\n\n` +
    `Name: ${name}\n` +
    `Enrollment ID: ${enrollmentId}\n\n` +
    `This will remove the student registration and gate scan from Supabase.`
  );

  if (!confirmed) return;

  try {
    showAdminAlert(`Deleting attendee ${enrollmentId}...`, 'info');

    // 1. Delete associated attendance record first
    const { error: attError } = await supabase
      .from('attendance')
      .delete()
      .eq('enrollment_id', enrollmentId);

    if (attError) console.warn('Attendance delete note:', attError);

    // 2. Delete student record
    const { error: studentError } = await supabase
      .from('students')
      .delete()
      .eq('enrollment_id', enrollmentId);

    if (studentError) throw studentError;

    // 3. Update local state
    datasheetData = datasheetData.filter(s => s.enrollment_id !== enrollmentId);
    renderDatasheetTable();
    await loadStats();

    showAdminAlert(`Deleted student: ${name} (${enrollmentId})`, 'success');
  } catch (err) {
    console.error('Failed to delete student:', err);
    showAdminAlert(`Delete failed: ${err.message || err}`, 'error');
  }
}

window.handleDeleteStudent = handleDeleteStudent;

// Admin Alert helper
function showAdminAlert(message, type = 'info') {
  adminAlert.className = 'max-w-2xl mx-auto mt-4 px-4 py-2.5 rounded-lg text-xs flex items-start space-x-2.5 border transition-all';

  let iconHtml = '<i class="ph ph-info text-sm mt-0.5 text-zinc-400"></i>';
  if (type === 'error') {
    adminAlert.classList.add('bg-rose-950/40', 'border-rose-900/60', 'text-rose-200');
    iconHtml = '<i class="ph ph-warning-circle text-sm text-rose-400 mt-0.5"></i>';
  } else if (type === 'success') {
    adminAlert.classList.add('bg-emerald-950/40', 'border-emerald-900/60', 'text-emerald-200');
    iconHtml = '<i class="ph ph-check-circle text-sm text-emerald-400 mt-0.5"></i>';
  } else {
    adminAlert.classList.add('bg-zinc-900', 'border-zinc-800', 'text-zinc-300');
  }

  adminAlert.innerHTML = `${iconHtml}<span>${message}</span>`;
  setTimeout(() => {
    adminAlert.classList.add('hidden');
  }, 5000);
}

// --- Registration Controls (Live Gate Toggles) ---

async function loadSystemConfig() {
  try {
    const { data, error } = await supabase.from('system_config').select('*');
    if (!error && data) {
      data.forEach(item => {
        systemConfig[item.key] = item.value;
      });
    }
    renderSystemConfigUI();
  } catch (e) {
    console.warn('System config load error:', e);
  }
}

function renderSystemConfigUI() {
  const pwBadge = document.getElementById('pwStatusBadge');
  const pwBtn = document.getElementById('togglePwRegBtn');
  const guestBadge = document.getElementById('guestStatusBadge');
  const guestBtn = document.getElementById('toggleGuestRegBtn');

  const isPwOpen = systemConfig.pw_registration_open !== 'false';
  if (pwBadge) {
    pwBadge.textContent = isPwOpen ? 'ACTIVE' : 'PAUSED';
    pwBadge.className = isPwOpen
      ? 'px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
      : 'px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800';
  }
  if (pwBtn) {
    pwBtn.textContent = isPwOpen ? 'Stop Responses' : 'Resume Responses';
    pwBtn.className = isPwOpen
      ? 'px-2.5 py-1 rounded text-xs font-semibold transition bg-rose-600 hover:bg-rose-500 text-white shadow-sm'
      : 'px-2.5 py-1 rounded text-xs font-semibold transition bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm';
  }

  const isGuestOpen = systemConfig.guest_registration_open !== 'false';
  if (guestBadge) {
    guestBadge.textContent = isGuestOpen ? 'ACTIVE' : 'PAUSED';
    guestBadge.className = isGuestOpen
      ? 'px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
      : 'px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800';
  }
  if (guestBtn) {
    guestBtn.textContent = isGuestOpen ? 'Stop Responses' : 'Resume Responses';
    guestBtn.className = isGuestOpen
      ? 'px-2.5 py-1 rounded text-xs font-semibold transition bg-rose-600 hover:bg-rose-500 text-white shadow-sm'
      : 'px-2.5 py-1 rounded text-xs font-semibold transition bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm';
  }
}

async function toggleRegistrationGateway(key) {
  const currentVal = systemConfig[key] !== 'false';
  const newVal = currentVal ? 'false' : 'true';
  const label = key === 'pw_registration_open' ? 'PW Community' : 'External Users';

  const confirmMsg = currentVal
    ? `Stop accepting new responses for ${label}?\n\nExisting registered attendees will still be able to access their tickets.`
    : `Resume accepting new responses for ${label}?`;

  if (!confirm(confirmMsg)) return;

  try {
    const { error } = await supabase
      .from('system_config')
      .upsert({ key, value: newVal, updated_at: new Date().toISOString() });

    if (error) throw error;
    systemConfig[key] = newVal;
    renderSystemConfigUI();
    showAdminAlert(`${label} registrations are now ${newVal === 'true' ? 'ACTIVE' : 'PAUSED'}.`, 'success');
  } catch (e) {
    showAdminAlert(`Failed to update setting: ${e.message || e}`, 'error');
  }
}

// --- Manual Attendee Entry Modal Functions ---

function openManualEntryModal() {
  const modal = document.getElementById('manualEntryModal');
  if (!modal) return;
  const randomHex = Math.random().toString(36).substring(2, 10).toUpperCase();
  document.getElementById('manualTicketToken').value = `TKT-${randomHex}`;
  document.getElementById('manualEnrollmentId').value = '';
  document.getElementById('manualName').value = '';
  document.getElementById('manualEmail').value = '';
  document.getElementById('manualPhone').value = '';
  document.getElementById('manualCompany').value = '';
  document.getElementById('manualUtr').value = '';

  setManualType('pw_member');
  modal.classList.remove('hidden');
}

function closeManualEntryModal() {
  const modal = document.getElementById('manualEntryModal');
  if (modal) modal.classList.add('hidden');
}

function setManualType(type) {
  const pwRadio = document.getElementById('manualTypePw');
  const guestRadio = document.getElementById('manualTypeGuest');
  const pwLabel = document.getElementById('typePwLabel');
  const guestLabel = document.getElementById('typeGuestLabel');
  const pwFields = document.getElementById('manualPwFieldsDiv');
  const guestFields = document.getElementById('manualGuestFieldsDiv');
  const enrollLabel = document.getElementById('manualEnrollmentLabel');
  const enrollInput = document.getElementById('manualEnrollmentId');

  const activeClass = 'flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-medium cursor-pointer transition select-none bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm';
  const inactiveClass = 'flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-medium cursor-pointer transition select-none text-zinc-500 hover:text-zinc-900 dark:hover:text-white';

  if (type === 'pw_member') {
    if (pwRadio) pwRadio.checked = true;
    if (pwLabel) pwLabel.className = activeClass;
    if (guestLabel) guestLabel.className = inactiveClass;
    if (pwFields) pwFields.classList.remove('hidden');
    if (guestFields) guestFields.classList.add('hidden');
    if (enrollLabel) enrollLabel.innerHTML = 'Enrollment / Roll No <span class="text-rose-500">*</span>';
    if (enrollInput) enrollInput.placeholder = 'e.g. 22400123';
  } else {
    if (guestRadio) guestRadio.checked = true;
    if (guestLabel) guestLabel.className = activeClass;
    if (pwLabel) pwLabel.className = inactiveClass;
    if (pwFields) pwFields.classList.add('hidden');
    if (guestFields) guestFields.classList.remove('hidden');
    if (enrollLabel) enrollLabel.innerHTML = 'Guest / Ref ID <span class="text-rose-500">*</span>';
    if (enrollInput && !enrollInput.value) {
      enrollInput.value = 'GST-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
  }
}

async function handleManualEntrySubmit(e) {
  e.preventDefault();
  const typeRadio = document.querySelector('input[name="manualUserType"]:checked');
  const type = typeRadio ? typeRadio.value : 'pw_member';
  const ticketToken = document.getElementById('manualTicketToken').value.trim().toUpperCase();
  const enrollmentId = document.getElementById('manualEnrollmentId').value.trim().toUpperCase();
  const name = document.getElementById('manualName').value.trim();
  const email = document.getElementById('manualEmail').value.trim().toLowerCase();
  const phone = document.getElementById('manualPhone').value.trim();

  const submitBtn = document.getElementById('saveManualEntryBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i><span>Saving...</span>';

  try {
    // Check duplicate enrollment ID
    const { data: dupId } = await supabase.from('students').select('enrollment_id').eq('enrollment_id', enrollmentId).maybeSingle();
    if (dupId) {
      alert(`Enrollment / Ref ID '${enrollmentId}' is already registered!`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="ph-bold ph-check"></i><span>Save & Register Attendee</span>';
      return;
    }

    // Check duplicate email
    const { data: dupEmail } = await supabase.from('students').select('email').eq('email', email).maybeSingle();
    if (dupEmail) {
      alert(`Email '${email}' is already registered!`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="ph-bold ph-check"></i><span>Save & Register Attendee</span>';
      return;
    }

    let newRecord = {
      enrollment_id: enrollmentId,
      name,
      email,
      phone,
      ticket_token: ticketToken,
      user_type: type,
      registered_at: new Date().toISOString()
    };

    if (type === 'pw_member') {
      newRecord.department = document.getElementById('manualDepartment').value;
      newRecord.year = document.getElementById('manualYear').value;
      newRecord.amount_paid = 0;
      newRecord.payment_status = 'approved';
    } else {
      newRecord.department = 'External Guest';
      newRecord.year = 'Guest';
      newRecord.company = document.getElementById('manualCompany').value.trim() || 'External Guest';
      newRecord.amount_paid = 500;
      newRecord.payment_status = document.getElementById('manualPaymentStatus').value;
      newRecord.utr_number = document.getElementById('manualUtr').value.trim() || null;
    }

    const { error } = await supabase.from('students').insert(newRecord);
    if (error) throw error;

    showAdminAlert(`Manual attendee '${name}' (${ticketToken}) registered successfully!`, 'success');
    closeManualEntryModal();
    await loadStats();
    await loadPayments();
    await loadDatasheet();
  } catch (err) {
    alert(`Error registering attendee: ${err.message || err}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="ph-bold ph-check"></i><span>Save & Register Attendee</span>';
  }
}

// Setup Event Listeners
function setupEventListeners() {
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin);
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleAdminLogout);

  // Response Gateways Controls
  const togglePwBtn = document.getElementById('togglePwRegBtn');
  if (togglePwBtn) togglePwBtn.addEventListener('click', () => toggleRegistrationGateway('pw_registration_open'));

  const toggleGuestBtn = document.getElementById('toggleGuestRegBtn');
  if (toggleGuestBtn) toggleGuestBtn.addEventListener('click', () => toggleRegistrationGateway('guest_registration_open'));

  // Manual Attendee Entry Modal
  const openModalBtn = document.getElementById('openManualEntryModalBtn');
  if (openModalBtn) openModalBtn.addEventListener('click', openManualEntryModal);

  const closeModalBtn = document.getElementById('closeManualEntryModalBtn');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeManualEntryModal);

  const cancelModalBtn = document.getElementById('cancelManualEntryBtn');
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeManualEntryModal);

  const manualTypePwRadio = document.getElementById('manualTypePw');
  if (manualTypePwRadio) manualTypePwRadio.addEventListener('change', () => setManualType('pw_member'));

  const manualTypeGuestRadio = document.getElementById('manualTypeGuest');
  if (manualTypeGuestRadio) manualTypeGuestRadio.addEventListener('change', () => setManualType('guest'));

  const manualEntryForm = document.getElementById('manualEntryForm');
  if (manualEntryForm) manualEntryForm.addEventListener('submit', handleManualEntrySubmit);

  if (tabScannerBtn) tabScannerBtn.addEventListener('click', () => switchTab('scanner'));
  if (tabPaymentsBtn) tabPaymentsBtn.addEventListener('click', () => switchTab('payments'));
  if (tabDataSheetBtn) tabDataSheetBtn.addEventListener('click', () => switchTab('datasheet'));

  if (toggleCameraBtn) toggleCameraBtn.addEventListener('click', toggleCamera);

  if (manualScanForm) {
    manualScanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = manualInput.value.trim();
      if (!val) return;
      await verifyAndMarkTicket(val);
      manualInput.value = '';
    });
  }

  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', async () => {
      await loadStats();
      await loadPayments();
      await loadDatasheet();
      showAdminAlert('Data and payment approvals refreshed from Supabase.', 'info');
    });
  }

  if (paymentSearch) paymentSearch.addEventListener('input', renderPaymentsTable);
  if (filterPaymentStatus) filterPaymentStatus.addEventListener('change', renderPaymentsTable);

  if (tableSearch) tableSearch.addEventListener('input', renderDatasheetTable);
  if (filterStatus) filterStatus.addEventListener('change', renderDatasheetTable);
  if (filterDept) filterDept.addEventListener('change', renderDatasheetTable);
  if (filterYear) filterYear.addEventListener('change', renderDatasheetTable);

  // Client-side CSV Export
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!datasheetData || datasheetData.length === 0) {
        showAdminAlert('No records to export', 'error');
        return;
      }

      let csv = 'Enrollment/Ref ID,Name,Department/Company,Role/Year,Phone,Email,Amount Paid,UTR Number,Payment Status,Registration Date,Attendance Status,Scanned Timestamp\n';
      datasheetData.forEach(r => {
        const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
        csv += [
          escape(r.enrollment_id),
          escape(r.name),
          escape(r.department),
          escape(r.year),
          escape(r.phone),
          escape(r.email),
          escape(r.amount_paid || 0),
          escape(r.utr_number || 'N/A'),
          escape(r.payment_status || 'approved'),
          escape(r.registered_at),
          escape(r.attendance_status),
          escape(r.scanned_at || 'N/A')
        ].join(',') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `supabase_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  }
}
