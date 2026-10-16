// Admin Portal Client Script

let adminJwt = localStorage.getItem('admin_jwt') || '';
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
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAdminSession();
});

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

    // First tone (C5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Second tone (G5)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, now + 0.15);
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
  if (adminJwt) {
    showDashboard();
    await loadDepartmentsFilter();
    await loadStats();
    await loadDatasheet();
  } else {
    showLogin();
  }
}

// Login Handler
async function handleAdminLogin(e) {
  e.preventDefault();
  const password = document.getElementById('adminPasscode').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAdminAlert(data.error || 'Authentication failed', 'error');
      return;
    }

    adminJwt = data.token;
    localStorage.setItem('admin_jwt', adminJwt);
    showAdminAlert('Authenticated successfully! Welcome, Staff.', 'success');
    showDashboard();
    await loadDepartmentsFilter();
    await loadStats();
    await loadDatasheet();
  } catch (err) {
    showAdminAlert('Error communicating with server', 'error');
  }
}

function handleAdminLogout() {
  stopCamera();
  localStorage.removeItem('admin_jwt');
  adminJwt = '';
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
    tabScannerBtn.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30';
    tabDataSheetBtn.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 text-slate-400 hover:text-white hover:bg-slate-800';
    scannerView.classList.remove('hidden');
    datasheetView.classList.add('hidden');
  } else {
    tabDataSheetBtn.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30';
    tabScannerBtn.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 text-slate-400 hover:text-white hover:bg-slate-800';
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
      onQrCodeError
    );

    isScannerRunning = true;
    toggleCameraBtn.textContent = 'Stop Camera';
    toggleCameraBtn.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition';
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
      toggleCameraBtn.className = 'px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition';
    } catch (err) {
      console.warn('Camera stop notice:', err);
    }
  }
}

// Throttle scan triggers so same QR isn't submitted 10 times in 1 second
let isProcessingScan = false;
async function onQrCodeSuccess(decodedText) {
  if (isProcessingScan) return;
  isProcessingScan = true;

  await verifyAndMarkTicket(decodedText);

  // Resume scanning after 2.5 seconds pause
  setTimeout(() => {
    isProcessingScan = false;
  }, 2500);
}

function onQrCodeError(errorMessage) {
  // Silent frame miss
}

// Verify Ticket with Server (Enforces: Once scanned, cannot be scanned again!)
async function verifyAndMarkTicket(qrData) {
  try {
    const res = await fetch('/api/admin/scan-ticket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminJwt}`
      },
      body: JSON.stringify({ qrData })
    });

    const result = await res.json();

    if (res.status === 401 || res.status === 403) {
      showAdminAlert('Session expired. Please log in again.', 'error');
      handleAdminLogout();
      return;
    }

    if (result.success) {
      // 1. FRESH SCAN VERIFIED!
      playSuccessChime();
      renderScanResult('success', result);
      addRecentScan(result.student, 'VERIFIED', result.scannedAt);
      loadStats();
      loadDatasheet();
    } else if (result.alreadyScanned) {
      // 2. CRUCIAL: TICKET ALREADY USED - REJECT!
      playErrorBuzzer();
      renderScanResult('already_scanned', result);
      addRecentScan(result.student, 'DUPLICATE REJECTED', result.scannedAt);
    } else {
      // 3. INVALID TICKET
      playErrorBuzzer();
      renderScanResult('invalid', result);
    }
  } catch (err) {
    playErrorBuzzer();
    renderScanResult('error', { message: 'Network communication failure during verification' });
  }
}

// Render Result Card in Scanner View
function renderScanResult(type, data) {
  if (type === 'success') {
    const s = data.student;
    scanResultBox.className = 'glass-card rounded-2xl p-6 transition-all border-2 border-emerald-500/80 bg-emerald-950/20 text-center animate-pulse-once';
    scanResultBox.innerHTML = `
      <div class="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-3xl mx-auto mb-3 shadow-lg shadow-emerald-500/20">
        <i class="ph-bold ph-check-circle"></i>
      </div>
      <span class="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-500 text-slate-950 uppercase tracking-wider inline-block mb-2">
        ENTRY APPROVED (1st SCAN)
      </span>
      <h3 class="text-xl font-bold text-white">${s.name}</h3>
      <p class="text-sm font-mono text-cyan-300 font-bold mt-0.5">${s.enrollment_id}</p>
      
      <div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-emerald-500/30 text-xs text-left">
        <div>
          <span class="text-slate-400 block text-[10px]">Department:</span>
          <span class="text-slate-200 font-semibold truncate">${s.department} (Yr ${s.year})</span>
        </div>
        <div>
          <span class="text-slate-400 block text-[10px]">Contact:</span>
          <span class="text-slate-200 font-semibold">${s.phone}</span>
        </div>
      </div>
      <p class="text-[11px] text-emerald-400 mt-3 flex items-center justify-center space-x-1">
        <i class="ph-bold ph-clock"></i>
        <span>Marked Present at ${new Date(data.scannedAt).toLocaleTimeString()}</span>
      </p>
    `;
  } else if (type === 'already_scanned') {
    const s = data.student;
    const formattedTime = new Date(data.scannedAt).toLocaleString();
    scanResultBox.className = 'glass-card rounded-2xl p-6 transition-all border-2 border-rose-600 bg-rose-950/40 text-center animate-bounce-once';
    scanResultBox.innerHTML = `
      <div class="w-16 h-16 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-3xl mx-auto mb-3 shadow-lg shadow-rose-500/20">
        <i class="ph-bold ph-prohibit"></i>
      </div>
      <span class="px-3 py-1 rounded-full text-xs font-black bg-rose-600 text-white uppercase tracking-wider inline-block mb-2">
        DUPLICATE SCAN REJECTED!
      </span>
      <h3 class="text-lg font-bold text-white">${s ? s.name : 'Unknown Attendee'}</h3>
      <p class="text-sm font-mono text-rose-300 font-bold mt-0.5">${s ? s.enrollment_id : ''}</p>
      
      <div class="p-3 mt-3 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-200">
        <p class="font-bold">⚠️ TICKET HAS ALREADY BEEN USED</p>
        <p class="text-[11px] mt-1 text-rose-300">
          Originally scanned on: <strong>${formattedTime}</strong>
        </p>
        <p class="text-[10px] text-rose-400 mt-1">
          Policy: A ticket cannot be scanned more than once under any circumstances.
        </p>
      </div>
    `;
  } else {
    scanResultBox.className = 'glass-card rounded-2xl p-6 transition-all border-2 border-amber-600 bg-amber-950/30 text-center';
    scanResultBox.innerHTML = `
      <div class="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-3xl mx-auto mb-3">
        <i class="ph-bold ph-warning-circle"></i>
      </div>
      <span class="px-3 py-1 rounded-full text-xs font-extrabold bg-amber-500 text-slate-950 uppercase tracking-wider inline-block mb-2">
        INVALID TICKET
      </span>
      <p class="text-sm text-slate-200 font-semibold mt-1">${data.message || 'Ticket not found in database.'}</p>
      <p class="text-xs text-slate-400 mt-2">Please ensure the student has completed registration on the portal.</p>
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
    <div class="p-2.5 rounded-lg ${item.status === 'VERIFIED' ? 'bg-slate-900/80 border border-emerald-900/40' : 'bg-rose-950/30 border border-rose-900/40'} flex items-center justify-between">
      <div>
        <p class="font-bold text-slate-200">${item.name} <span class="font-mono text-[11px] text-slate-400">(${item.enrollment})</span></p>
        <p class="text-[10px] text-slate-400">${item.dept}</p>
      </div>
      <div class="text-right">
        <span class="text-[10px] font-bold px-2 py-0.5 rounded ${item.status === 'VERIFIED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
          ${item.status}
        </span>
        <p class="text-[10px] text-slate-500 mt-0.5">${item.time}</p>
      </div>
    </div>
  `).join('');
}

// Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${adminJwt}` }
    });
    if (!res.ok) return;
    const stats = await res.json();

    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statPresent').textContent = stats.present;
    document.getElementById('statPending').textContent = stats.pending;
    document.getElementById('statRate').textContent = stats.percent + '%';
  } catch (e) {
    console.error('Stats load error:', e);
  }
}

// Load Departments for Filter
async function loadDepartmentsFilter() {
  try {
    const res = await fetch('/api/departments');
    const data = await res.json();
    if (data.departments) {
      filterDept.innerHTML = '<option value="ALL">All Departments</option>';
      data.departments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = d.name;
        filterDept.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Dept filter load error:', e);
  }
}

// Load Datasheet from Server
async function loadDatasheet() {
  try {
    const res = await fetch('/api/admin/datasheet', {
      headers: { 'Authorization': `Bearer ${adminJwt}` }
    });
    if (!res.ok) return;

    const json = await res.json();
    datasheetData = json.data || [];
    renderDatasheetTable();
  } catch (err) {
    console.error('Datasheet load error:', err);
  }
}

// Filter and Render Datasheet Table
function renderDatasheetTable() {
  const searchTerm = (tableSearch.value || '').toLowerCase().trim();
  const statusFilter = filterStatus.value;
  const deptFilter = filterDept.value;
  const yearFilter = filterYear.value;

  const filtered = datasheetData.filter(row => {
    // Search query matches enrollment_id, name, department, phone, email
    const matchSearch = !searchTerm ||
      (row.enrollment_id && row.enrollment_id.toLowerCase().includes(searchTerm)) ||
      (row.name && row.name.toLowerCase().includes(searchTerm)) ||
      (row.department && row.department.toLowerCase().includes(searchTerm)) ||
      (row.phone && row.phone.includes(searchTerm)) ||
      (row.email && row.email.toLowerCase().includes(searchTerm));

    // Status filter
    const matchStatus = (statusFilter === 'ALL') || (row.attendance_status === statusFilter);

    // Department filter
    const matchDept = (deptFilter === 'ALL') || (row.department === deptFilter);

    // Year filter
    const matchYear = (yearFilter === 'ALL') || (String(row.year) === yearFilter);

    return matchSearch && matchStatus && matchDept && matchYear;
  });

  recordCount.textContent = filtered.length;

  if (filtered.length === 0) {
    datasheetBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-8 text-slate-500">
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
      <tr class="transition">
        <td class="py-3 px-4 font-mono font-bold text-indigo-400 whitespace-nowrap">${row.enrollment_id}</td>
        <td class="py-3 px-4 font-semibold text-white whitespace-nowrap">${row.name}</td>
        <td class="py-3 px-4 text-slate-300">${row.department}</td>
        <td class="py-3 px-4 text-center font-bold text-slate-300">Yr ${row.year}</td>
        <td class="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">${row.phone}</td>
        <td class="py-3 px-4 text-slate-400 truncate max-w-xs" title="${row.email}">${row.email}</td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center space-x-1.5 w-fit ${
            isPresent 
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
          }">
            <i class="ph-bold ${isPresent ? 'ph-check-circle' : 'ph-clock'}"></i>
            <span>${row.attendance_status}</span>
          </span>
        </td>
        <td class="py-3 px-4 font-mono text-slate-400 whitespace-nowrap text-[11px]">${scanTimeFormatted}</td>
      </tr>
    `;
  }).join('');
}

// Admin Alert helper
function showAdminAlert(message, type = 'info') {
  adminAlert.classList.remove('hidden', 'bg-rose-950/80', 'border-rose-700/60', 'text-rose-200', 'bg-emerald-950/80', 'border-emerald-700/60', 'text-emerald-200', 'bg-indigo-950/80', 'border-indigo-700/60', 'text-indigo-200');

  let iconHtml = '<i class="ph-bold ph-info text-base mt-0.5"></i>';
  if (type === 'error') {
    adminAlert.classList.add('bg-rose-950/80', 'border', 'border-rose-700/60', 'text-rose-200');
    iconHtml = '<i class="ph-bold ph-x-circle text-base text-rose-400 mt-0.5"></i>';
  } else if (type === 'success') {
    adminAlert.classList.add('bg-emerald-950/80', 'border', 'border-emerald-700/60', 'text-emerald-200');
    iconHtml = '<i class="ph-bold ph-check-circle text-base text-emerald-400 mt-0.5"></i>';
  } else {
    adminAlert.classList.add('bg-indigo-950/80', 'border', 'border-indigo-700/60', 'text-indigo-200');
  }

  adminAlert.innerHTML = `${iconHtml}<span>${message}</span>`;
  setTimeout(() => {
    adminAlert.classList.add('hidden');
  }, 6000);
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
      showAdminAlert('Datasheet refreshed.', 'info');
    });
  }

  if (tableSearch) tableSearch.addEventListener('input', renderDatasheetTable);
  if (filterStatus) filterStatus.addEventListener('change', renderDatasheetTable);
  if (filterDept) filterDept.addEventListener('change', renderDatasheetTable);
  if (filterYear) filterYear.addEventListener('change', renderDatasheetTable);

  // Authenticated CSV Export
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/admin/export-csv', {
          headers: { 'Authorization': `Bearer ${adminJwt}` }
        });
        if (!res.ok) {
          showAdminAlert('CSV export unauthorized', 'error');
          return;
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `festive_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        showAdminAlert('Failed to download CSV', 'error');
      }
    });
  }
}
