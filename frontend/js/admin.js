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
const tabDataSheetBtn = document.getElementById('tabDataSheetBtn');
const scannerView = document.getElementById('scannerView');
const datasheetView = document.getElementById('datasheetView');

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
  if (tab === 'scanner') {
    tabScannerBtn.className = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 bg-zinc-800 text-white shadow-sm';
    tabDataSheetBtn.className = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 text-zinc-400 hover:text-zinc-200';
    scannerView.classList.remove('hidden');
    datasheetView.classList.add('hidden');
  } else {
    tabDataSheetBtn.className = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 bg-zinc-800 text-white shadow-sm';
    tabScannerBtn.className = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 text-zinc-400 hover:text-zinc-200';
    scannerView.classList.add('hidden');
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

    if (typeof qrData === 'string') {
      try {
        const parsed = JSON.parse(qrData);
        ticketToken = parsed.ticket_token;
        enrollmentId = parsed.enrollment_id;
      } catch (e) {
        const clean = qrData.trim();
        if (clean.startsWith('TKT-')) {
          ticketToken = clean;
        } else {
          enrollmentId = clean.toUpperCase();
        }
      }
    }

    // 1. Find Student in Supabase
    let query = supabase.from('students').select('*');
    if (ticketToken && enrollmentId) {
      query = query.or(`ticket_token.eq.${ticketToken},enrollment_id.eq.${enrollmentId}`);
    } else if (ticketToken) {
      query = query.eq('ticket_token', ticketToken);
    } else if (enrollmentId) {
      query = query.eq('enrollment_id', enrollmentId);
    }

    const { data: student, error: studentError } = await query.maybeSingle();

    if (studentError || !student) {
      playErrorBuzzer();
      renderScanResult('invalid', { message: 'Ticket not found in cloud database.' });
      return;
    }

    // 2. CHECK IF TICKET HAS ALREADY BEEN SCANNED
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

    // 3. RECORD FRESH ATTENDANCE IN SUPABASE
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
      // If constraint violation caught at db level
      playErrorBuzzer();
      renderScanResult('already_scanned', { student, scannedAt: scanTime });
      return;
    }

    // 4. ENTRY APPROVED!
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
          <span class="text-zinc-500 block text-[10px]">Department</span>
          <span class="text-zinc-300 font-medium truncate">${s.department} (Yr ${s.year})</span>
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
        department: s.department,
        year: s.year,
        phone: s.phone,
        email: s.email,
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
        loadDatasheet();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadStats();
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
        <td colspan="9" class="text-center py-8 text-slate-500">
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

    return `
      <tr class="hover:bg-zinc-900/40 transition">
        <td class="py-2.5 px-3.5 font-mono font-medium text-zinc-200 whitespace-nowrap">${row.enrollment_id}</td>
        <td class="py-2.5 px-3.5 font-medium text-zinc-100 whitespace-nowrap">${row.name}</td>
        <td class="py-2.5 px-3.5 text-zinc-400">${row.department}</td>
        <td class="py-2.5 px-3.5 text-center font-medium text-zinc-400">Yr ${row.year}</td>
        <td class="py-2.5 px-3.5 font-mono text-zinc-400 whitespace-nowrap">${row.phone}</td>
        <td class="py-2.5 px-3.5 text-zinc-400 truncate max-w-xs" title="${row.email}">${row.email}</td>
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

// Setup Event Listeners
function setupEventListeners() {
  if (adminLoginForm) adminLoginForm.addEventListener('submit', handleAdminLogin);
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleAdminLogout);

  if (tabScannerBtn) tabScannerBtn.addEventListener('click', () => switchTab('scanner'));
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
      await loadDatasheet();
      showAdminAlert('Datasheet refreshed from Supabase.', 'info');
    });
  }

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

      let csv = 'Enrollment ID,Name,Department,Year,Phone,Email,Registration Date,Attendance Status,Scanned Timestamp\n';
      datasheetData.forEach(r => {
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
