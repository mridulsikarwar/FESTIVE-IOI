// FESTIVE IOI - Multi-Club Organizer, Event Manager & Gate Scanner Portal

let currentAdmin = null; // { email, name, role, club_id, clubs }
let allClubs = [];
let managedEvents = [];
let activeEventId = null;
let eventRegistrations = [];
let adminRealtimeChannel = null;
let html5QrScanner = null;
let isScannerRunning = false;
let isProcessingScan = false;
let audioCtx = null;
let recentScans = [];

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).substring(2, 6);
}

// DOM Elements
const adminLoginSection = document.getElementById('adminLoginSection');
const adminDashboardSection = document.getElementById('adminDashboardSection');
const adminGoogleSignInBtn = document.getElementById('adminGoogleSignInBtn');
const adminUnauthorizedBox = document.getElementById('adminUnauthorizedBox');
const adminUnauthorizedMsg = document.getElementById('adminUnauthorizedMsg');
const adminSwitchAccountBtn = document.getElementById('adminSwitchAccountBtn');
const adminAlert = document.getElementById('adminAlert');
const adminControls = document.getElementById('adminControls');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const adminRoleBadge = document.getElementById('adminRoleBadge');
const activeEventSelect = document.getElementById('activeEventSelect');

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
  adminAlert.innerHTML = `${iconHtml}<span>${escapeHtml(message)}</span>`;
  adminAlert.classList.remove('hidden');
  setTimeout(() => adminAlert.classList.add('hidden'), 5000);
}

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSuccessChime() {
  try {
    initAudio();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, now);
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + 0.3);
  } catch (e) {}
}

function playErrorBuzzer() {
  try {
    initAudio();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, now);
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + 0.35);
  } catch (e) {}
}

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

function resetAdminState() {
  currentAdmin = null;
  if (adminRealtimeChannel && supabase) {
    supabase.removeChannel(adminRealtimeChannel);
    adminRealtimeChannel = null;
  }
}

async function checkAdminSession() {
  localStorage.removeItem('admin_logged_in');
  if (!supabase) { showLogin(); return; }

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      history.replaceState(null, '', window.location.pathname);
    }

    const hash = window.location.hash || '';
    if (hash.includes('access_token=')) {
      const hp = new URLSearchParams(hash.substring(1));
      const accessToken = hp.get('access_token');
      const refreshToken = hp.get('refresh_token');
      if (accessToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' });
      }
      history.replaceState(null, '', window.location.pathname);
    }

    supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        resetAdminState();
        showLogin();
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await verifyAdminAndLoad();
      }
    });

    await verifyAdminAndLoad();
  } catch (err) {
    console.error('Admin auth error:', err);
    resetAdminState();
    showLogin();
  }
}

async function verifyAdminAndLoad() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user || !user.email) {
    resetAdminState();
    adminUnauthorizedBox?.classList.add('hidden');
    showLogin();
    return;
  }

  const email = user.email.toLowerCase().trim();
  const { data: adminRow, error: adminErr } = await supabase
    .from('admin_users')
    .select('*, clubs(id, name)')
    .ilike('email', email)
    .maybeSingle();

  if (adminErr || !adminRow) {
    resetAdminState();
    showLogin();
    if (adminUnauthorizedBox && adminUnauthorizedMsg) {
      adminUnauthorizedMsg.textContent = `Signed in as ${email}, which is not authorized as a Club President or Organizer.`;
      adminUnauthorizedBox.classList.remove('hidden');
    }
    return;
  }

  adminUnauthorizedBox?.classList.add('hidden');
  const alreadyLoaded = currentAdmin && currentAdmin.email === adminRow.email;
  currentAdmin = adminRow;

  const canManage = adminRow.role === 'super_admin' || adminRow.role === 'club_president';

  if (adminRoleBadge) {
    if (adminRow.role === 'super_admin') {
      adminRoleBadge.textContent = 'SUPER ADMIN';
    } else if (adminRow.role === 'club_president') {
      adminRoleBadge.textContent = `${adminRow.clubs?.name || 'CLUB'} PRESIDENT`;
    } else {
      adminRoleBadge.textContent = `${adminRow.clubs?.name || 'CLUB'} GATE STAFF`;
    }
  }

  document.getElementById('openCreateEventModalBtn')?.classList.toggle('hidden', !canManage);
  document.getElementById('tabEventsBtn')?.classList.toggle('hidden', !canManage);
  document.getElementById('tabPaymentsBtn')?.classList.toggle('hidden', !canManage);
  document.getElementById('tabPresidentsBtn')?.classList.toggle('hidden', adminRow.role !== 'super_admin');

  showDashboard();
  if (!alreadyLoaded) {
    await loadClubs();
    await loadManagedEvents();
    if (adminRow.role === 'super_admin') await loadPresidentsList();
    setupRealtimeSubscription();
  }
}

function signInAdminWithGoogle() {
  if (!supabase) return;
  const redirectUrl = window.location.origin + window.location.pathname;
  if (adminGoogleSignInBtn) {
    adminGoogleSignInBtn.disabled = true;
    adminGoogleSignInBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin text-lg text-indigo-600"></i><span class="text-slate-700">Redirecting to Google...</span>';
  }
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
}

async function handleAdminLogout() {
  await stopCamera();
  if (supabase) await supabase.auth.signOut();
  resetAdminState();
  adminUnauthorizedBox?.classList.add('hidden');
  showLogin();
}

async function loadClubs() {
  const { data } = await supabase.from('clubs').select('*').order('id');
  allClubs = data || [];

  const evClubSelect = document.getElementById('evClubId');
  if (evClubSelect) {
    const clubsForUser = currentAdmin.role === 'super_admin'
      ? allClubs
      : allClubs.filter(c => c.id === currentAdmin.club_id);
    evClubSelect.innerHTML = clubsForUser.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  const presClubSelect = document.getElementById('presClubId');
  if (presClubSelect) {
    presClubSelect.innerHTML = allClubs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }
}

async function loadManagedEvents() {
  let query = supabase.from('events').select('*, clubs(id, name)').order('start_time', { ascending: true });
  if (currentAdmin.role !== 'super_admin' && currentAdmin.club_id) {
    query = query.eq('club_id', currentAdmin.club_id);
  }
  const { data } = await query;
  managedEvents = data || [];

  if (activeEventSelect) {
    if (managedEvents.length === 0) {
      activeEventSelect.innerHTML = '<option value="">No events yet — click + Create Event</option>';
      activeEventId = null;
    } else {
      activeEventSelect.innerHTML = managedEvents.map(ev =>
        `<option value="${escapeHtml(ev.id)}">[${escapeHtml(ev.clubs?.name || 'Club')}] ${escapeHtml(ev.title)}</option>`
      ).join('');
      if (!activeEventId || !managedEvents.some(e => e.id === activeEventId)) {
        activeEventId = managedEvents[0].id;
      }
      activeEventSelect.value = activeEventId;
    }
  }

  renderAdminEventsGrid();
  await loadActiveEventRegistrations();
}

async function loadActiveEventRegistrations() {
  if (!activeEventId) {
    eventRegistrations = [];
    updateStatsAndTables();
    return;
  }

  const { data, error } = await supabase
    .from('registrations')
    .select('*, attendees(*), teams(team_name, join_code), attendance(*)')
    .eq('event_id', activeEventId)
    .order('registered_at', { ascending: false });

  if (error) {
    console.error('Load registrations error:', error);
    return;
  }
  eventRegistrations = data || [];
  updateStatsAndTables();
}

function updateStatsAndTables() {
  const total = eventRegistrations.length;
  const present = eventRegistrations.filter(r => Array.isArray(r.attendance) ? r.attendance.length > 0 : !!r.attendance).length;
  const pending = Math.max(0, total - present);
  const rate = total > 0 ? Math.round((present / total) * 100) : 0;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPresent').textContent = present;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statRate').textContent = `${rate}%`;

  const pendingPayCount = eventRegistrations.filter(r => r.payment_status === 'pending_verification').length;
  const payBadge = document.getElementById('pendingPaymentsCountBadge');
  if (payBadge) {
    if (pendingPayCount > 0) {
      payBadge.textContent = pendingPayCount;
      payBadge.classList.remove('hidden');
    } else {
      payBadge.classList.add('hidden');
    }
  }

  renderPaymentsTable();
  renderDatasheetTable();
}

function renderAdminEventsGrid() {
  const grid = document.getElementById('adminEventsGrid');
  if (!grid) return;
  if (managedEvents.length === 0) {
    grid.innerHTML = '<div class="col-span-full solid-card rounded-xl p-8 text-center text-xs text-zinc-500">No events created yet. Click "+ Create Event" to publish your first club event.</div>';
    return;
  }

  grid.innerHTML = managedEvents.map(ev => {
    const dateStr = new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isSelected = ev.id === activeEventId;
    return `
      <div class="solid-card rounded-xl p-4 space-y-3 border ${isSelected ? 'border-indigo-500/60' : 'border-zinc-800'}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">${escapeHtml(ev.clubs?.name || 'Club')}</span>
            <h4 class="text-sm font-semibold text-zinc-100 mt-0.5">${escapeHtml(ev.title)}</h4>
            <p class="text-[11px] text-zinc-500 mt-0.5">${escapeHtml(dateStr)} &bull; ${escapeHtml(ev.venue || 'Campus')}</p>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-medium ${ev.registration_open ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-rose-950/60 text-rose-400 border border-rose-800/50'}">
            ${ev.registration_open ? 'OPEN' : 'PAUSED'}
          </span>
        </div>
        <div class="text-[11px] text-zinc-400 flex items-center justify-between">
          <span>Format: ${escapeHtml(ev.participation_type)} (${ev.min_team_size}-${ev.max_team_size})</span>
          <span>PW: ₹${escapeHtml(ev.pw_fee)} / Guest: ₹${escapeHtml(ev.guest_fee)}</span>
        </div>
        <div class="flex gap-2 pt-2 border-t border-zinc-800">
          <button type="button" onclick="selectActiveEvent('${escapeHtml(ev.id)}')" class="btn-secondary flex-1 py-1.5 rounded-lg text-xs font-medium">${isSelected ? 'Selected' : 'Manage Gate'}</button>
          <button type="button" onclick="toggleEventOpen('${escapeHtml(ev.id)}', ${ev.registration_open ? 'false' : 'true'})" class="px-3 py-1.5 rounded-lg text-xs font-medium ${ev.registration_open ? 'bg-rose-600/20 text-rose-400 border border-rose-800/50' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-800/50'}">
            ${ev.registration_open ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.selectActiveEvent = async function (eventId) {
  activeEventId = eventId;
  if (activeEventSelect) activeEventSelect.value = eventId;
  renderAdminEventsGrid();
  await loadActiveEventRegistrations();
  switchTab('scanner');
};

window.toggleEventOpen = async function (eventId, nextOpen) {
  const { error } = await supabase.from('events').update({ registration_open: nextOpen }).eq('id', eventId);
  if (error) { showAdminAlert(error.message, 'error'); return; }
  showAdminAlert(`Event registrations ${nextOpen ? 'resumed' : 'paused'}.`, 'success');
  await loadManagedEvents();
};

async function handleCreateEvent(e) {
  e.preventDefault();
  const btn = document.getElementById('submitCreateEventBtn');
  btn.disabled = true;
  try {
    const title = document.getElementById('evTitle').value.trim();
    const clubId = Number(document.getElementById('evClubId').value);
    const partType = document.getElementById('evPartType').value;
    const minTeam = Math.max(1, Number(document.getElementById('evMinTeam').value || 1));
    const maxTeam = Math.max(minTeam, Number(document.getElementById('evMaxTeam').value || minTeam));
    const maxCapVal = document.getElementById('evMaxCapacity').value;

    const { data, error } = await supabase
      .from('events')
      .insert({
        club_id: clubId,
        title,
        slug: slugify(title),
        description: document.getElementById('evDesc').value.trim(),
        venue: document.getElementById('evVenue').value.trim(),
        start_time: new Date(document.getElementById('evStartTime').value).toISOString(),
        participation_type: partType,
        min_team_size: partType === 'solo' ? 1 : minTeam,
        max_team_size: partType === 'solo' ? 1 : maxTeam,
        pw_fee: Number(document.getElementById('evPwFee').value || 0),
        guest_fee: Number(document.getElementById('evGuestFee').value || 0),
        allow_pw_members: document.getElementById('evAllowPw').checked,
        allow_guests: document.getElementById('evAllowGuests').checked,
        max_capacity: maxCapVal ? Number(maxCapVal) : null,
        status: 'published',
        created_by: currentAdmin.email
      })
      .select()
      .single();

    if (error) throw error;
    document.getElementById('createEventModal').classList.add('hidden');
    document.getElementById('createEventForm').reset();
    activeEventId = data.id;
    showAdminAlert(`Event "${title}" published!`, 'success');
    await loadManagedEvents();
  } catch (err) {
    showAdminAlert(err.message || 'Failed to create event', 'error');
  } finally {
    btn.disabled = false;
  }
}

// Scanner
async function startCamera() {
  try {
    initAudio();
    if (!html5QrScanner) html5QrScanner = new Html5Qrcode('reader');
    await html5QrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, (txt) => {
      if (isProcessingScan) return;
      isProcessingScan = true;
      verifyAndMarkTicket(txt).finally(() => setTimeout(() => { isProcessingScan = false; }, 2200));
    }, () => {});
    isScannerRunning = true;
    document.getElementById('toggleCameraBtn').textContent = 'Stop Camera';
  } catch (err) {
    showAdminAlert('Camera error: ' + (err.message || err), 'error');
  }
}

async function stopCamera() {
  if (html5QrScanner && isScannerRunning) {
    try { await html5QrScanner.stop(); } catch (e) {}
    isScannerRunning = false;
    const btn = document.getElementById('toggleCameraBtn');
    if (btn) btn.textContent = 'Start Camera';
  }
}

async function verifyAndMarkTicket(qrData) {
  if (!activeEventId) {
    showAdminAlert('Select or create an Active Event first.', 'error');
    return;
  }

  let ticketToken = null;
  let registrationId = null;
  let qrEventId = null;
  const clean = String(qrData || '').trim();

  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      ticketToken = parsed.ticket_token || null;
      registrationId = parsed.registration_id || null;
      qrEventId = parsed.event_id || null;
    }
  } catch (e) {
    if (clean.toUpperCase().startsWith('TKT-')) ticketToken = clean.toUpperCase();
  }

  if (qrEventId && qrEventId !== activeEventId) {
    playErrorBuzzer();
    renderScanBox('error', { message: 'This ticket belongs to a DIFFERENT event!' });
    return;
  }

  let reg = null;
  if (registrationId) {
    reg = eventRegistrations.find(r => r.id === registrationId);
  }
  if (!reg && ticketToken) {
    reg = eventRegistrations.find(r => r.ticket_token === ticketToken.toUpperCase());
  }
  if (!reg && clean) {
    reg = eventRegistrations.find(r => r.attendees?.enrollment_id?.toUpperCase() === clean.toUpperCase());
  }

  if (!reg) {
    playErrorBuzzer();
    renderScanBox('error', { message: 'No matching registration found for this event.' });
    return;
  }

  if (reg.payment_status === 'pending_verification') {
    playErrorBuzzer();
    renderScanBox('payment_pending', { reg });
    return;
  }
  if (reg.payment_status === 'rejected') {
    playErrorBuzzer();
    renderScanBox('error', { message: 'Payment for this pass was rejected.' });
    return;
  }

  const alreadyAtt = Array.isArray(reg.attendance) ? reg.attendance[0] : reg.attendance;
  if (alreadyAtt) {
    playErrorBuzzer();
    renderScanBox('duplicate', { reg, scannedAt: alreadyAtt.scanned_at });
    addRecentScan(reg, 'DUPLICATE');
    return;
  }

  const scanTime = new Date().toISOString();
  const { error } = await supabase.from('attendance').insert({
    registration_id: reg.id,
    event_id: activeEventId,
    status: 'Present',
    scanned_at: scanTime,
    scanned_by: currentAdmin.email
  });

  if (error) {
    playErrorBuzzer();
    renderScanBox('duplicate', { reg, scannedAt: scanTime });
    return;
  }

  playSuccessChime();
  renderScanBox('success', { reg, scannedAt: scanTime });
  addRecentScan(reg, 'VERIFIED');
  await loadActiveEventRegistrations();
}

function renderScanBox(type, data) {
  const box = document.getElementById('scanResultBox');
  if (!box) return;
  if (type === 'success') {
    const att = data.reg.attendees || {};
    box.className = 'solid-card rounded-xl p-6 text-center border border-emerald-600/50 bg-emerald-950/20';
    box.innerHTML = `
      <span class="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300">ENTRY APPROVED</span>
      <h3 class="text-base font-semibold text-white mt-2">${escapeHtml(att.name)}</h3>
      <p class="text-xs font-mono text-zinc-400">${escapeHtml(att.enrollment_id)}</p>
      ${data.reg.teams ? `<p class="text-xs text-indigo-400 mt-1">Team: ${escapeHtml(data.reg.teams.team_name)}</p>` : ''}
      <p class="text-[11px] text-zinc-400 mt-2">Checked in at ${escapeHtml(new Date(data.scannedAt).toLocaleTimeString())}</p>
    `;
  } else if (type === 'duplicate') {
    const att = data.reg.attendees || {};
    box.className = 'solid-card rounded-xl p-6 text-center border border-rose-600/50 bg-rose-950/20';
    box.innerHTML = `
      <span class="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300">DUPLICATE SCAN REJECTED</span>
      <h3 class="text-base font-semibold text-white mt-2">${escapeHtml(att.name)}</h3>
      <p class="text-xs text-rose-300 mt-1">Already scanned at ${escapeHtml(new Date(data.scannedAt).toLocaleTimeString())}</p>
    `;
  } else if (type === 'payment_pending') {
    const att = data.reg.attendees || {};
    box.className = 'solid-card rounded-xl p-6 text-center border border-amber-600/50 bg-amber-950/20';
    box.innerHTML = `
      <span class="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300">PAYMENT PENDING</span>
      <h3 class="text-base font-semibold text-white mt-2">${escapeHtml(att.name)}</h3>
      <p class="text-xs font-mono text-amber-300 mt-1">UTR: ${escapeHtml(data.reg.utr_number || 'N/A')} (₹${escapeHtml(data.reg.amount_paid)})</p>
    `;
  } else {
    box.className = 'solid-card rounded-xl p-6 text-center border border-amber-600/50 bg-amber-950/20';
    box.innerHTML = `<p class="text-xs text-amber-300 font-medium">${escapeHtml(data.message || 'Invalid ticket')}</p>`;
  }
}

function addRecentScan(reg, status) {
  const att = reg.attendees || {};
  recentScans.unshift({ name: att.name, id: att.enrollment_id, status, time: new Date().toLocaleTimeString() });
  if (recentScans.length > 8) recentScans.pop();
  document.getElementById('recentScansList').innerHTML = recentScans.map(i => `
    <div class="p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-center justify-between">
      <div><p class="text-zinc-200 font-medium">${escapeHtml(i.name)}</p><p class="text-[10px] font-mono text-zinc-500">${escapeHtml(i.id)}</p></div>
      <div class="text-right"><span class="text-[10px] font-semibold ${i.status === 'VERIFIED' ? 'text-emerald-400' : 'text-rose-400'}">${escapeHtml(i.status)}</span><p class="text-[10px] text-zinc-500">${escapeHtml(i.time)}</p></div>
    </div>
  `).join('');
}

function renderPaymentsTable() {
  const body = document.getElementById('paymentsBody');
  if (!body) return;
  const q = (document.getElementById('paymentSearch')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filterPaymentStatus')?.value || 'ALL';

  const paid = eventRegistrations.filter(r => Number(r.amount_paid || 0) > 0 || r.utr_number);
  const filtered = paid.filter(r => {
    const att = r.attendees || {};
    const matchQ = !q
      || (att.name && att.name.toLowerCase().includes(q))
      || (r.utr_number && r.utr_number.toLowerCase().includes(q))
      || (r.attendee_email && r.attendee_email.toLowerCase().includes(q));
    const matchS = statusFilter === 'ALL' || r.payment_status === statusFilter;
    return matchQ && matchS;
  });

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-zinc-500">No paid registrations for this event.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(r => {
    const att = r.attendees || {};
    const isPending = r.payment_status === 'pending_verification';
    return `
      <tr>
        <td class="py-2.5 px-3"><div class="font-medium text-zinc-100">${escapeHtml(att.name)}</div><div class="text-[10px] text-zinc-500">${escapeHtml(r.attendee_email)}</div></td>
        <td class="py-2.5 px-3 font-mono text-zinc-300">${escapeHtml(att.enrollment_id)}</td>
        <td class="py-2.5 px-3 text-zinc-400">${r.teams ? escapeHtml(r.teams.team_name) : 'Solo'}</td>
        <td class="py-2.5 px-3 font-mono text-amber-400">${escapeHtml(r.utr_number || 'N/A')}</td>
        <td class="py-2.5 px-3 font-mono text-emerald-400">₹${escapeHtml(r.amount_paid)}</td>
        <td class="py-2.5 px-3">${escapeHtml(r.payment_status)}</td>
        <td class="py-2.5 px-3 text-center">
          ${isPending ? `
            <button onclick="setPaymentStatus('${escapeHtml(r.id)}', 'approved')" class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold mr-1">Approve</button>
            <button onclick="setPaymentStatus('${escapeHtml(r.id)}', 'rejected')" class="px-2 py-1 rounded text-rose-400 border border-rose-900/50 text-[11px]">Reject</button>
          ` : '<span class="text-zinc-500 italic">Reviewed</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

window.setPaymentStatus = async function (regId, statusVal) {
  const { error } = await supabase.from('registrations').update({ payment_status: statusVal }).eq('id', regId);
  if (error) { showAdminAlert(error.message, 'error'); return; }
  showAdminAlert(`Payment marked as ${statusVal}.`, 'success');
  await loadActiveEventRegistrations();
};

function renderDatasheetTable() {
  const body = document.getElementById('datasheetBody');
  if (!body) return;
  const q = (document.getElementById('tableSearch')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filterStatus')?.value || 'ALL';

  const filtered = eventRegistrations.filter(r => {
    const att = r.attendees || {};
    const isPresent = Array.isArray(r.attendance) ? r.attendance.length > 0 : !!r.attendance;
    const attStatus = isPresent ? 'Present' : 'Not Scanned';
    const matchQ = !q
      || (att.name && att.name.toLowerCase().includes(q))
      || (att.enrollment_id && att.enrollment_id.toLowerCase().includes(q))
      || (r.attendee_email && r.attendee_email.toLowerCase().includes(q))
      || (r.teams?.team_name && r.teams.team_name.toLowerCase().includes(q));
    const matchS = statusFilter === 'ALL' || attStatus === statusFilter;
    return matchQ && matchS;
  });

  document.getElementById('recordCount').textContent = filtered.length;
  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-zinc-500">No registrations match your filter.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(r => {
    const att = r.attendees || {};
    const isPresent = Array.isArray(r.attendance) ? r.attendance.length > 0 : !!r.attendance;
    return `
      <tr>
        <td class="py-2.5 px-3 font-mono text-zinc-300">${escapeHtml(att.enrollment_id)}</td>
        <td class="py-2.5 px-3 font-medium text-zinc-100">${escapeHtml(att.name)}</td>
        <td class="py-2.5 px-3 text-indigo-400">${r.teams ? `${escapeHtml(r.teams.team_name)} (${escapeHtml(r.teams.join_code)})` : 'Solo'}</td>
        <td class="py-2.5 px-3 font-mono text-zinc-400">${escapeHtml(att.phone)}</td>
        <td class="py-2.5 px-3 text-zinc-400">${escapeHtml(r.attendee_email)}</td>
        <td class="py-2.5 px-3">${Number(r.amount_paid) > 0 ? `₹${escapeHtml(r.amount_paid)} (${escapeHtml(r.payment_status)})` : 'Free'}</td>
        <td class="py-2.5 px-3">${isPresent ? '<span class="text-emerald-400 font-medium">Present</span>' : '<span class="text-zinc-500">Not Scanned</span>'}</td>
        <td class="py-2.5 px-3 text-center space-x-1">
          ${!isPresent ? `<button onclick="verifyAndMarkTicket('${escapeHtml(r.ticket_token)}')" class="px-2 py-1 rounded bg-emerald-600 text-white text-[11px]">Check In</button>` : ''}
          ${(currentAdmin?.role === 'super_admin' || currentAdmin?.role === 'club_president')
            ? `<button onclick="deleteRegistration('${escapeHtml(r.id)}')" class="px-2 py-1 rounded text-rose-400 border border-rose-900/40 text-[11px]">Delete</button>`
            : ''}
        </td>
      </tr>
    `;
  }).join('');
}
window.verifyAndMarkTicket = verifyAndMarkTicket;

window.deleteRegistration = async function (regId) {
  if (!confirm('Delete this registration?')) return;
  const { error } = await supabase.from('registrations').delete().eq('id', regId);
  if (error) { showAdminAlert(error.message, 'error'); return; }
  showAdminAlert('Registration deleted.', 'info');
  await loadActiveEventRegistrations();
};

// Super Admin: Club Presidents Manager
async function loadPresidentsList() {
  const container = document.getElementById('presidentsList');
  if (!container) return;
  const { data } = await supabase.from('admin_users').select('*, clubs(name)').order('created_at', { ascending: false });
  container.innerHTML = (data || []).map(a => `
    <div class="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-center justify-between">
      <div>
        <p class="font-medium text-zinc-100">${escapeHtml(a.name || a.email)} <span class="text-[10px] font-mono text-indigo-400">(${escapeHtml(a.role)})</span></p>
        <p class="text-[11px] text-zinc-500">${escapeHtml(a.email)} &bull; ${escapeHtml(a.clubs?.name || 'All Clubs')}</p>
      </div>
      ${a.email.toLowerCase() !== currentAdmin.email.toLowerCase()
        ? `<button onclick="removePresident('${escapeHtml(a.email)}')" class="px-2 py-1 rounded text-rose-400 border border-rose-900/40 text-[11px]">Remove</button>`
        : '<span class="text-[10px] text-zinc-500">You</span>'}
    </div>
  `).join('');
}

async function handleAddPresident(e) {
  e.preventDefault();
  const email = document.getElementById('presEmail').value.trim().toLowerCase();
  const name = document.getElementById('presName').value.trim();
  const role = document.getElementById('presRole').value;
  const clubId = role === 'super_admin' ? null : Number(document.getElementById('presClubId').value);

  const { error } = await supabase.from('admin_users').upsert({ email, name, role, club_id: clubId });
  if (error) { showAdminAlert(error.message, 'error'); return; }
  document.getElementById('addPresidentForm').reset();
  showAdminAlert(`Saved organizer access for ${email}.`, 'success');
  await loadPresidentsList();
}

window.removePresident = async function (email) {
  if (!confirm(`Remove organizer access for ${email}?`)) return;
  const { error } = await supabase.from('admin_users').delete().eq('email', email);
  if (error) { showAdminAlert(error.message, 'error'); return; }
  await loadPresidentsList();
};

function switchTab(tab) {
  const views = { scanner: 'scannerView', events: 'eventsView', payments: 'paymentsView', datasheet: 'datasheetView', presidents: 'presidentsView' };
  const btns = { scanner: 'tabScannerBtn', events: 'tabEventsBtn', payments: 'tabPaymentsBtn', datasheet: 'tabDataSheetBtn', presidents: 'tabPresidentsBtn' };
  const activeCls = 'admin-tab-btn px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm';
  const inactiveCls = 'admin-tab-btn px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 text-zinc-500 hover:text-zinc-200';

  const canManage = currentAdmin?.role === 'super_admin' || currentAdmin?.role === 'club_president';
  Object.keys(views).forEach(k => {
    document.getElementById(views[k])?.classList.toggle('hidden', k !== tab);
    const b = document.getElementById(btns[k]);
    const hideBtn = (k === 'presidents' && currentAdmin?.role !== 'super_admin')
      || ((k === 'events' || k === 'payments') && !canManage);
    if (b) b.className = (k === tab ? activeCls : inactiveCls) + (hideBtn ? ' hidden' : '');
  });
}

function setupRealtimeSubscription() {
  if (!supabase) return;
  if (adminRealtimeChannel) supabase.removeChannel(adminRealtimeChannel);
  adminRealtimeChannel = supabase
    .channel('organizer-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => loadActiveEventRegistrations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadActiveEventRegistrations())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => loadManagedEvents())
    .subscribe();
}

function exportCsv() {
  if (eventRegistrations.length === 0) { showAdminAlert('No registrations to export.', 'error'); return; }
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let csv = 'Enrollment ID,Name,Team,Join Code,Phone,Email,Amount Paid,Payment Status,Ticket Token,Attendance\n';
  eventRegistrations.forEach(r => {
    const att = r.attendees || {};
    const isPresent = Array.isArray(r.attendance) ? r.attendance.length > 0 : !!r.attendance;
    csv += [
      esc(att.enrollment_id), esc(att.name), esc(r.teams?.team_name || 'Solo'), esc(r.teams?.join_code || ''),
      esc(att.phone), esc(r.attendee_email), esc(r.amount_paid), esc(r.payment_status),
      esc(r.ticket_token), esc(isPresent ? 'Present' : 'Not Scanned')
    ].join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `event_registrations_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function setupEventListeners() {
  adminGoogleSignInBtn?.addEventListener('click', signInAdminWithGoogle);
  adminSwitchAccountBtn?.addEventListener('click', handleAdminLogout);
  adminLogoutBtn?.addEventListener('click', handleAdminLogout);

  activeEventSelect?.addEventListener('change', async () => {
    activeEventId = activeEventSelect.value || null;
    renderAdminEventsGrid();
    await loadActiveEventRegistrations();
  });

  document.getElementById('tabScannerBtn')?.addEventListener('click', () => switchTab('scanner'));
  document.getElementById('tabEventsBtn')?.addEventListener('click', () => switchTab('events'));
  document.getElementById('tabPaymentsBtn')?.addEventListener('click', () => switchTab('payments'));
  document.getElementById('tabDataSheetBtn')?.addEventListener('click', () => switchTab('datasheet'));
  document.getElementById('tabPresidentsBtn')?.addEventListener('click', () => switchTab('presidents'));

  document.getElementById('openCreateEventModalBtn')?.addEventListener('click', () => document.getElementById('createEventModal').classList.remove('hidden'));
  document.getElementById('closeCreateEventModalBtn')?.addEventListener('click', () => document.getElementById('createEventModal').classList.add('hidden'));
  document.getElementById('createEventForm')?.addEventListener('submit', handleCreateEvent);
  document.getElementById('addPresidentForm')?.addEventListener('submit', handleAddPresident);

  document.getElementById('toggleCameraBtn')?.addEventListener('click', () => isScannerRunning ? stopCamera() : startCamera());
  document.getElementById('manualScanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = document.getElementById('manualInput').value.trim();
    if (!val) return;
    await verifyAndMarkTicket(val);
    document.getElementById('manualInput').value = '';
  });

  document.getElementById('paymentSearch')?.addEventListener('input', renderPaymentsTable);
  document.getElementById('filterPaymentStatus')?.addEventListener('change', renderPaymentsTable);
  document.getElementById('tableSearch')?.addEventListener('input', renderDatasheetTable);
  document.getElementById('filterStatus')?.addEventListener('change', renderDatasheetTable);
  document.getElementById('refreshDataBtn')?.addEventListener('click', loadActiveEventRegistrations);
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCsv);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { setupEventListeners(); checkAdminSession(); });
} else {
  setupEventListeners();
  checkAdminSession();
}
