// FESTIVE IOI - Multi-Club, Multi-Event & Group Ticketing Student Portal

let currentAuthUser = null;
let currentProfile = null; // row from public.attendees
let allClubs = [];
let allEvents = [];
let eventRegCounts = {};
let myRegistrations = [];
let selectedClubId = 'ALL';
let activeModalEvent = null;
let activeParticipationMode = 'solo';
let lookedUpTeam = null;
let studentLiveChannel = null;

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isDomainAllowed(email) {
  if (!email || !email.includes('@')) return false;
  const domain = email.split('@')[1].toLowerCase().trim();
  const allowed = APP_CONFIG.allowedDomains || ['pwioi.com', 'pw.live'];
  return allowed.some(d => d.toLowerCase().trim() === domain);
}

// DOM Elements
const authSection = document.getElementById('authSection');
const profileSetupSection = document.getElementById('profileSetupSection');
const portalSection = document.getElementById('portalSection');
const alertBox = document.getElementById('alertBox');
const userHeaderProfile = document.getElementById('userHeaderProfile');
const headerUserName = document.getElementById('headerUserName');
const signOutBtn = document.getElementById('signOutBtn');
const googleSignInBtn = document.getElementById('googleSignInBtn');

const discoverView = document.getElementById('discoverView');
const myPassesView = document.getElementById('myPassesView');
const navDiscoverBtn = document.getElementById('navDiscoverBtn');
const navTicketsBtn = document.getElementById('navTicketsBtn');
const myPassesBadge = document.getElementById('myPassesBadge');

function showSection(name) {
  authSection.classList.add('hidden');
  profileSetupSection.classList.add('hidden');
  portalSection.classList.add('hidden');
  if (name === 'auth') authSection.classList.remove('hidden');
  if (name === 'profile') profileSetupSection.classList.remove('hidden');
  if (name === 'portal') portalSection.classList.remove('hidden');
}

function switchPortalTab(tab) {
  const active = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm';
  const inactive = 'px-3.5 py-1.5 rounded-md text-xs font-medium transition flex items-center space-x-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200';
  if (tab === 'discover') {
    navDiscoverBtn.className = active;
    navTicketsBtn.className = inactive;
    discoverView.classList.remove('hidden');
    myPassesView.classList.add('hidden');
  } else {
    navTicketsBtn.className = active;
    navDiscoverBtn.className = inactive;
    discoverView.classList.add('hidden');
    myPassesView.classList.remove('hidden');
  }
}

function showAlert(message, type = 'info') {
  alertBox.className = 'max-w-2xl mx-auto mt-4 px-4 py-2.5 rounded-lg text-xs flex items-start space-x-2.5 border transition-all';
  let iconHtml = '<i class="ph ph-info text-sm mt-0.5 text-zinc-400"></i>';
  if (type === 'error') {
    alertBox.classList.add('bg-rose-950/40', 'border-rose-900/60', 'text-rose-200');
    iconHtml = '<i class="ph ph-warning-circle text-sm text-rose-400 mt-0.5"></i>';
  } else if (type === 'success') {
    alertBox.classList.add('bg-emerald-950/40', 'border-emerald-900/60', 'text-emerald-200');
    iconHtml = '<i class="ph ph-check-circle text-sm text-emerald-400 mt-0.5"></i>';
  } else {
    alertBox.classList.add('bg-zinc-900', 'border-zinc-800', 'text-zinc-300');
  }
  alertBox.innerHTML = `${iconHtml}<span>${escapeHtml(message)}</span>`;
  alertBox.classList.remove('hidden');
  setTimeout(() => alertBox.classList.add('hidden'), 5000);
}

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

async function getVerifiedAuthUser() {
  if (!supabase) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user && user.email) return user;
  } catch (e) {
    console.warn('Auth user check notice:', e);
  }
  return null;
}

function getGoogleAuthUrl() {
  const redirectUrl = window.location.origin + window.location.pathname;
  return `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;
}

function signInWithGoogle(e) {
  if (e) e.preventDefault();
  if (window.location.protocol === 'file:') {
    showAlert('Google OAuth cannot run from file://. Open your deployed URL or http://localhost.', 'error');
    return;
  }
  if (googleSignInBtn) {
    googleSignInBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin text-lg text-indigo-600"></i><span class="text-slate-700">Redirecting to Google...</span>';
  }
  window.location.href = getGoogleAuthUrl();
}

async function initAuth() {
  localStorage.removeItem('student_email');
  localStorage.removeItem('student_name');
  if (!supabase) {
    showSection('auth');
    return;
  }

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

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        currentAuthUser = null;
        currentProfile = null;
        updateHeaderUser(null);
        showSection('auth');
      } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        await handleAuthenticatedUser(session.user);
      }
    });

    const user = await getVerifiedAuthUser();
    if (user) {
      await handleAuthenticatedUser(user);
    } else {
      showSection('auth');
    }
  } catch (err) {
    console.error('Init auth error:', err);
    showSection('auth');
  }
}

function initGoogleGis() {
  if (window.google && APP_CONFIG.googleClientId) {
    try {
      google.accounts.id.initialize({
        client_id: APP_CONFIG.googleClientId,
        callback: async (response) => {
          if (response.credential && supabase) {
            try {
              const { data, error } = await supabase.auth.signInWithIdToken({
                provider: 'google',
                token: response.credential
              });
              if (error) throw error;
              if (data?.user) await handleAuthenticatedUser(data.user);
            } catch (err) {
              showAlert('Please sign in using the "Continue with Google" button above.', 'error');
            }
          }
        }
      });
      const wrapper = document.getElementById('googleBtnWrapper');
      if (wrapper) {
        google.accounts.id.renderButton(wrapper, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
      }
    } catch (e) {}
  }
}

async function handleAuthenticatedUser(user) {
  currentAuthUser = user;
  const email = user.email.toLowerCase().trim();
  const meta = user.user_metadata || {};
  const displayName = meta.full_name || meta.name || email.split('@')[0];
  updateHeaderUser(displayName);

  const { data: profile, error } = await supabase
    .from('attendees')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (!error && profile) {
    currentProfile = profile;
    await enterPortal();
  } else {
    showProfileSetup(email, displayName);
  }
}

async function loadDepartments() {
  const fallback = [
    { name: 'School of Technology', code: 'SOT' },
    { name: 'School of Management', code: 'SOM' },
    { name: 'School of Healthcare', code: 'SOH' }
  ];
  try {
    const { data } = await supabase.from('departments').select('name, code').order('name');
    const list = (data && data.length > 0) ? data : fallback;
    const select = document.getElementById('profDepartment');
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
  } catch (e) {}
}

function showProfileSetup(email, name) {
  const isPw = isDomainAllowed(email);
  const pwBox = document.getElementById('pwProfileContainer');
  const guestBox = document.getElementById('guestProfileContainer');
  if (isPw) {
    pwBox.classList.remove('hidden');
    guestBox.classList.add('hidden');
    document.getElementById('profEmail').value = email;
    document.getElementById('profName').value = name;
  } else {
    guestBox.classList.remove('hidden');
    pwBox.classList.add('hidden');
    document.getElementById('guestProfEmail').value = email;
    document.getElementById('guestProfName').value = name;
  }
  showSection('profile');
}

function getDbErrorMessage(err) {
  const msg = String(err?.message || '');
  const combined = `${msg} ${err?.details || ''}`.toLowerCase();
  if (err?.code === '23505' || combined.includes('duplicate key')) {
    if (combined.includes('enrollment_id')) return 'This Enrollment ID is already registered.';
    if (combined.includes('phone')) return 'This phone number is already registered.';
    if (combined.includes('email')) return 'This email is already registered.';
    if (combined.includes('utr')) return 'This 12-digit UTR has already been submitted.';
    if (combined.includes('team_name')) return 'That team name is already taken for this event.';
    if (combined.includes('registrations_event_id_attendee_email_key')) return 'You are already registered for this event.';
    return 'A duplicate record already exists.';
  }
  return msg || 'Database error';
}

async function handleSavePwProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('savePwProfileBtn');
  btn.disabled = true;
  try {
    const user = await getVerifiedAuthUser();
    if (!user) { showSection('auth'); return; }
    const { data, error } = await supabase
      .from('attendees')
      .insert({
        email: user.email.toLowerCase().trim(),
        enrollment_id: document.getElementById('profEnrollmentId').value.trim().toUpperCase(),
        name: document.getElementById('profName').value.trim(),
        department: document.getElementById('profDepartment').value,
        year: document.getElementById('profYear').value,
        phone: document.getElementById('profPhone').value.trim()
      })
      .select()
      .single();
    if (error) throw error;
    currentProfile = data;
    showAlert('Profile saved! Welcome to FESTIVE IOI Events.', 'success');
    await enterPortal();
  } catch (err) {
    showAlert(getDbErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

async function handleSaveGuestProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('saveGuestProfileBtn');
  btn.disabled = true;
  try {
    const user = await getVerifiedAuthUser();
    if (!user) { showSection('auth'); return; }
    const { data, error } = await supabase
      .from('attendees')
      .insert({
        email: user.email.toLowerCase().trim(),
        enrollment_id: '',
        name: document.getElementById('guestProfName').value.trim(),
        company: document.getElementById('guestProfCompany').value.trim() || 'External Guest',
        phone: document.getElementById('guestProfPhone').value.trim()
      })
      .select()
      .single();
    if (error) throw error;
    currentProfile = data;
    showAlert('Profile saved! Welcome to FESTIVE IOI Events.', 'success');
    await enterPortal();
  } catch (err) {
    showAlert(getDbErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

async function enterPortal() {
  const pill = document.getElementById('profileSummaryPill');
  if (pill && currentProfile) {
    pill.textContent = `${currentProfile.enrollment_id} • ${currentProfile.user_type === 'pw_member' ? 'PW Member' : 'Guest'}`;
  }
  showSection('portal');
  await Promise.all([loadClubs(), loadEventsAndCounts(), loadMyRegistrations()]);
  setupLiveSubscriptions();
}

async function loadClubs() {
  const { data } = await supabase.from('clubs').select('*').order('id');
  allClubs = data || [];
  renderClubPills();
}

function renderClubPills() {
  const container = document.getElementById('clubFilterPills');
  if (!container) return;
  const pills = [{ id: 'ALL', name: 'All Clubs' }, ...allClubs];
  container.innerHTML = pills.map(c => {
    const active = String(selectedClubId) === String(c.id);
    return `<button type="button" data-club-id="${escapeHtml(c.id)}" class="club-pill px-2.5 py-1 rounded-full text-[11px] font-medium transition border ${
      active
        ? 'bg-indigo-600 text-white border-indigo-500'
        : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200'
    }">${escapeHtml(c.name)}</button>`;
  }).join('');

  container.querySelectorAll('.club-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedClubId = btn.dataset.clubId;
      renderClubPills();
      renderEventsGrid();
    });
  });
}

async function loadEventsAndCounts() {
  const [{ data: evData }, { data: cntData }] = await Promise.all([
    supabase.from('events').select('*, clubs(id, name, slug)').eq('status', 'published').order('start_time', { ascending: true }),
    supabase.rpc('get_event_registration_counts')
  ]);
  allEvents = evData || [];
  eventRegCounts = {};
  (cntData || []).forEach(r => { eventRegCounts[r.event_id] = Number(r.registered_count || 0); });
  renderEventsGrid();
}

async function loadMyRegistrations() {
  if (!currentProfile) return;
  const { data } = await supabase
    .from('registrations')
    .select('*, events(*, clubs(name)), teams(id, team_name, join_code), attendance(*)')
    .eq('attendee_email', currentProfile.email)
    .order('registered_at', { ascending: false });

  myRegistrations = data || [];
  if (myPassesBadge) {
    if (myRegistrations.length > 0) {
      myPassesBadge.textContent = myRegistrations.length;
      myPassesBadge.classList.remove('hidden');
    } else {
      myPassesBadge.classList.add('hidden');
    }
  }
  renderEventsGrid();
  renderMyPassesGrid();
}

function getUserFeeForEvent(ev) {
  if (!currentProfile) return 0;
  return currentProfile.user_type === 'pw_member' ? Number(ev.pw_fee || 0) : Number(ev.guest_fee || 0);
}

function renderEventsGrid() {
  const grid = document.getElementById('eventsGrid');
  if (!grid) return;

  const q = (document.getElementById('eventSearchInput')?.value || '').toLowerCase().trim();
  const fmtFilter = document.getElementById('eventTypeFilter')?.value || 'ALL';

  const filtered = allEvents.filter(ev => {
    const matchClub = selectedClubId === 'ALL' || String(ev.club_id) === String(selectedClubId);
    const matchFmt = fmtFilter === 'ALL'
      || (fmtFilter === 'solo' && (ev.participation_type === 'solo' || ev.participation_type === 'both'))
      || (fmtFilter === 'team' && (ev.participation_type === 'team' || ev.participation_type === 'both'));
    const matchQ = !q
      || ev.title.toLowerCase().includes(q)
      || (ev.venue && ev.venue.toLowerCase().includes(q))
      || (ev.clubs?.name && ev.clubs.name.toLowerCase().includes(q));
    return matchClub && matchFmt && matchQ;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full solid-card rounded-xl p-10 text-center text-zinc-500 text-xs">
        No upcoming events match your filter right now. Check back soon!
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(ev => {
    const existingReg = myRegistrations.find(r => r.event_id === ev.id);
    const fee = getUserFeeForEvent(ev);
    const regCount = eventRegCounts[ev.id] || 0;
    const spotsLeft = ev.max_capacity ? Math.max(0, ev.max_capacity - regCount) : null;
    const isFull = spotsLeft !== null && spotsLeft <= 0;
    const isEligible = currentProfile?.user_type === 'pw_member' ? ev.allow_pw_members : ev.allow_guests;

    const dateStr = new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const fmtLabel = ev.participation_type === 'team'
      ? `Team (${ev.min_team_size}-${ev.max_team_size})`
      : (ev.participation_type === 'both' ? `Solo / Team (${ev.min_team_size}-${ev.max_team_size})` : 'Solo');

    let actionBtn = '';
    if (existingReg) {
      actionBtn = `<button type="button" onclick="openTicketModal('${escapeHtml(existingReg.id)}')" class="w-full py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition">View My Pass</button>`;
    } else if (!ev.registration_open) {
      actionBtn = `<button type="button" disabled class="w-full py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-500 cursor-not-allowed">Registrations Paused</button>`;
    } else if (!isEligible) {
      actionBtn = `<button type="button" disabled class="w-full py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-500 cursor-not-allowed">Not Eligible for Category</button>`;
    } else if (isFull) {
      actionBtn = `<button type="button" disabled class="w-full py-2 rounded-lg text-xs font-medium bg-rose-950/50 text-rose-400 cursor-not-allowed">Sold Out</button>`;
    } else {
      actionBtn = `<button type="button" onclick="openEventModal('${escapeHtml(ev.id)}')" class="btn-primary w-full py-2 rounded-lg text-xs font-semibold transition">Register Now</button>`;
    }

    return `
      <div class="solid-card rounded-xl p-4 flex flex-col justify-between space-y-3.5 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-500/40 transition">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">${escapeHtml(ev.clubs?.name || 'Club Event')}</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono ${fee > 0 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}">${fee > 0 ? '₹' + escapeHtml(fee) : 'FREE'}</span>
          </div>
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">${escapeHtml(ev.title)}</h3>
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2">${escapeHtml(ev.description || 'Official campus event.')}</p>
        </div>

        <div class="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800/80">
          <div class="grid grid-cols-2 gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <div class="flex items-center space-x-1"><i class="ph ph-calendar text-xs"></i><span>${escapeHtml(dateStr)}</span></div>
            <div class="flex items-center space-x-1"><i class="ph ph-map-pin text-xs"></i><span class="truncate">${escapeHtml(ev.venue || 'Campus')}</span></div>
            <div class="flex items-center space-x-1"><i class="ph ph-users text-xs"></i><span>${escapeHtml(fmtLabel)}</span></div>
            <div class="flex items-center space-x-1"><i class="ph ph-ticket text-xs"></i><span>${spotsLeft !== null ? `${spotsLeft} spots left` : `${regCount} registered`}</span></div>
          </div>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
}

function openEventModal(eventId) {
  const ev = allEvents.find(e => e.id === eventId);
  if (!ev) return;
  activeModalEvent = ev;
  lookedUpTeam = null;

  document.getElementById('modalClubBadge').textContent = ev.clubs?.name || 'Club';
  document.getElementById('modalEventTitle').textContent = ev.title;
  const dateStr = new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('modalEventMeta').textContent = `${dateStr} • ${ev.venue || 'Campus'}`;
  document.getElementById('modalEventDesc').textContent = ev.description || '';

  document.getElementById('newTeamName').value = '';
  document.getElementById('joinTeamCode').value = '';
  document.getElementById('foundTeamPreview').classList.add('hidden');
  document.getElementById('modalUtrInput').value = '';

  const teamSection = document.getElementById('teamModeSection');
  if (ev.participation_type === 'solo') {
    teamSection.classList.add('hidden');
    setParticipationMode('solo');
  } else {
    teamSection.classList.remove('hidden');
    document.getElementById('teamSizeHint').textContent = `Team size: ${ev.min_team_size} to ${ev.max_team_size} members. You'll get a Join Code to share with teammates.`;
    const soloBtn = document.querySelector('#teamModeButtons [data-mode="solo"]');
    if (soloBtn) soloBtn.classList.toggle('hidden', ev.participation_type === 'team');
    setParticipationMode(ev.participation_type === 'team' ? 'create_team' : 'solo');
  }

  const fee = getUserFeeForEvent(ev);
  const payBox = document.getElementById('modalPaymentBox');
  if (fee > 0) {
    payBox.classList.remove('hidden');
    const upi = ev.upi_id || APP_CONFIG.upiId || 'payalyadav210106@okaxis';
    document.getElementById('modalFeeAmount').textContent = `₹${fee}`;
    document.getElementById('modalUpiId').textContent = upi;
    const upiUri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(ev.title)}&am=${fee}&cu=INR`;
    document.getElementById('modalUpiLink').href = upiUri;
    const qrBox = document.getElementById('modalUpiQr');
    qrBox.innerHTML = '';
    new QRCode(qrBox, { text: upiUri, width: 96, height: 96, colorDark: '#1e1b4b', colorLight: '#ffffff' });
  } else {
    payBox.classList.add('hidden');
  }

  document.getElementById('eventRegModal').classList.remove('hidden');
}
window.openEventModal = openEventModal;

function setParticipationMode(mode) {
  activeParticipationMode = mode;
  document.querySelectorAll('#teamModeButtons .mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.className = `mode-btn py-1.5 rounded-md text-xs font-medium transition ${
      active ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
    }`;
  });
  document.getElementById('createTeamBox').classList.toggle('hidden', mode !== 'create_team');
  document.getElementById('joinTeamBox').classList.toggle('hidden', mode !== 'join_team');
}

async function lookupTeamByCode() {
  if (!activeModalEvent) return;
  const code = document.getElementById('joinTeamCode').value.trim().toUpperCase();
  const preview = document.getElementById('foundTeamPreview');
  if (!code) return;

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('event_id', activeModalEvent.id)
    .eq('join_code', code)
    .maybeSingle();

  if (!team) {
    lookedUpTeam = null;
    preview.className = 'text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded p-2';
    preview.textContent = `No team found with code "${code}" for this event.`;
    preview.classList.remove('hidden');
    return;
  }

  lookedUpTeam = team;
  preview.className = 'text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 rounded p-2';
  preview.textContent = `Found Team: "${team.team_name}" (${team.join_code})`;
  preview.classList.remove('hidden');
}

async function confirmEventRegistration() {
  if (!activeModalEvent || !currentProfile) return;
  const btn = document.getElementById('confirmEventRegBtn');
  btn.disabled = true;

  try {
    const fee = getUserFeeForEvent(activeModalEvent);
    let utr = null;
    if (fee > 0) {
      utr = document.getElementById('modalUtrInput').value.trim();
      if (!/^\d{12}$/.test(utr)) {
        showAlert('Please enter a valid 12-digit numeric UPI UTR.', 'error');
        btn.disabled = false;
        return;
      }
    }

    let teamId = null;
    if (activeParticipationMode === 'create_team') {
      const teamName = document.getElementById('newTeamName').value.trim();
      if (!teamName) {
        showAlert('Please enter a Team Name.', 'error');
        btn.disabled = false;
        return;
      }
      const { data: newTeam, error: teamErr } = await supabase
        .from('teams')
        .insert({
          event_id: activeModalEvent.id,
          team_name: teamName,
          join_code: '',
          leader_email: currentProfile.email
        })
        .select()
        .single();
      if (teamErr) throw teamErr;
      teamId = newTeam.id;
    } else if (activeParticipationMode === 'join_team') {
      if (!lookedUpTeam) await lookupTeamByCode();
      if (!lookedUpTeam) {
        showAlert('Enter a valid Team Join Code and click Find first.', 'error');
        btn.disabled = false;
        return;
      }
      teamId = lookedUpTeam.id;
    }

    const { data: reg, error: regErr } = await supabase
      .from('registrations')
      .insert({
        event_id: activeModalEvent.id,
        team_id: teamId,
        attendee_email: currentProfile.email,
        ticket_token: '',
        utr_number: utr
      })
      .select()
      .single();

    if (regErr) throw regErr;

    document.getElementById('eventRegModal').classList.add('hidden');
    if (window.confetti && reg.payment_status === 'approved') {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
    }
    await Promise.all([loadEventsAndCounts(), loadMyRegistrations()]);
    switchPortalTab('tickets');
    showAlert(
      reg.payment_status === 'pending_verification'
        ? 'Registration submitted! Pass will activate once payment is verified.'
        : 'Registered successfully! Your QR pass is ready.',
      'success'
    );
  } catch (err) {
    showAlert(getDbErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderMyPassesGrid() {
  const grid = document.getElementById('myPassesGrid');
  if (!grid) return;
  if (myRegistrations.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full solid-card rounded-xl p-10 text-center text-zinc-500 text-xs">
        You haven't registered for any events yet. Browse the Discover Events tab!
      </div>
    `;
    return;
  }

  grid.innerHTML = myRegistrations.map(reg => {
    const ev = reg.events || {};
    const isCheckedIn = Array.isArray(reg.attendance) ? reg.attendance.length > 0 : !!reg.attendance;
    const isPendingPay = reg.payment_status === 'pending_verification';
    const isRejected = reg.payment_status === 'rejected';
    const dateStr = ev.start_time ? new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    let badge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">Valid Pass</span>';
    if (isCheckedIn) badge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-950/60 text-indigo-300 border border-indigo-800/50">Checked In</span>';
    else if (isPendingPay) badge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/50">Payment Pending</span>';
    else if (isRejected) badge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-950/60 text-rose-400 border border-rose-800/50">Payment Rejected</span>';

    return `
      <div class="solid-card rounded-xl p-4 space-y-3 border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">${escapeHtml(ev.clubs?.name || 'Club')}</span>
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">${escapeHtml(ev.title || 'Event')}</h3>
            <p class="text-[11px] text-zinc-500 mt-0.5">${escapeHtml(dateStr)} &bull; ${escapeHtml(ev.venue || 'Campus')}</p>
          </div>
          ${badge}
        </div>

        ${reg.teams ? `
          <div class="p-2 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-center justify-between text-[11px]">
            <span class="text-zinc-400">Team: <strong class="text-zinc-200">${escapeHtml(reg.teams.team_name)}</strong></span>
            <span class="font-mono text-indigo-400 select-all">Code: ${escapeHtml(reg.teams.join_code)}</span>
          </div>
        ` : ''}

        <div class="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <span class="font-mono text-[11px] text-zinc-500">${escapeHtml(reg.ticket_token)}</span>
          ${(!isPendingPay && !isRejected)
            ? `<button type="button" onclick="openTicketModal('${escapeHtml(reg.id)}')" class="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold">Show QR Pass</button>`
            : `<span class="text-[11px] text-zinc-500">UTR: ${escapeHtml(reg.utr_number || 'N/A')}</span>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function openTicketModal(regId) {
  const reg = myRegistrations.find(r => r.id === regId);
  if (!reg) return;
  const ev = reg.events || {};
  const isCheckedIn = Array.isArray(reg.attendance) ? reg.attendance.length > 0 : !!reg.attendance;

  document.getElementById('tktClubBadge').textContent = ev.clubs?.name || 'Club Event';
  document.getElementById('tktEventTitle').textContent = ev.title || 'Event Pass';
  const dateStr = ev.start_time ? new Date(ev.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  document.getElementById('tktEventMeta').textContent = `${dateStr} • ${ev.venue || 'Campus'}`;
  document.getElementById('tktTokenDisplay').textContent = reg.ticket_token;
  document.getElementById('tktHolderName').textContent = currentProfile?.name || '';
  document.getElementById('tktHolderId').textContent = currentProfile?.enrollment_id || '';

  const teamRow = document.getElementById('tktTeamRow');
  if (reg.teams) {
    teamRow.classList.remove('hidden');
    document.getElementById('tktTeamInfo').textContent = `${reg.teams.team_name} (${reg.teams.join_code})`;
  } else {
    teamRow.classList.add('hidden');
  }

  const badge = document.getElementById('tktStatusBadge');
  if (isCheckedIn) {
    badge.className = 'mt-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200';
    badge.textContent = 'Checked In';
  } else {
    badge.className = 'mt-2 px-3 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200';
    badge.textContent = 'Valid Entry Pass';
  }

  const qrBox = document.getElementById('tktQrContainer');
  qrBox.innerHTML = '';
  const payload = JSON.stringify({
    ticket_token: reg.ticket_token,
    registration_id: reg.id,
    event_id: reg.event_id
  });
  new QRCode(qrBox, { text: payload, width: 200, height: 200, colorDark: '#1e1b4b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  document.getElementById('ticketModal').classList.remove('hidden');
}
window.openTicketModal = openTicketModal;

function setupLiveSubscriptions() {
  if (!supabase || !currentProfile) return;
  if (studentLiveChannel) {
    supabase.removeChannel(studentLiveChannel);
    studentLiveChannel = null;
  }
  studentLiveChannel = supabase
    .channel(`attendee-${currentProfile.email}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `attendee_email=eq.${currentProfile.email}` }, () => loadMyRegistrations())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, () => loadMyRegistrations())
    .subscribe();
}

async function handleSignOut() {
  if (studentLiveChannel && supabase) {
    supabase.removeChannel(studentLiveChannel);
    studentLiveChannel = null;
  }
  if (supabase) await supabase.auth.signOut();
  currentAuthUser = null;
  currentProfile = null;
  updateHeaderUser(null);
  showSection('auth');
}

function setupEventListeners() {
  if (googleSignInBtn) {
    googleSignInBtn.href = getGoogleAuthUrl();
    googleSignInBtn.addEventListener('click', signInWithGoogle);
  }
  if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);
  if (navDiscoverBtn) navDiscoverBtn.addEventListener('click', () => switchPortalTab('discover'));
  if (navTicketsBtn) navTicketsBtn.addEventListener('click', () => switchPortalTab('tickets'));

  document.getElementById('pwProfileForm')?.addEventListener('submit', handleSavePwProfile);
  document.getElementById('guestProfileForm')?.addEventListener('submit', handleSaveGuestProfile);
  document.getElementById('eventSearchInput')?.addEventListener('input', renderEventsGrid);
  document.getElementById('eventTypeFilter')?.addEventListener('change', renderEventsGrid);

  document.getElementById('closeEventModalBtn')?.addEventListener('click', () => document.getElementById('eventRegModal').classList.add('hidden'));
  document.getElementById('closeTicketModalBtn')?.addEventListener('click', () => document.getElementById('ticketModal').classList.add('hidden'));
  document.getElementById('printTicketModalBtn')?.addEventListener('click', () => window.print());

  document.querySelectorAll('#teamModeButtons .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setParticipationMode(btn.dataset.mode));
  });
  document.getElementById('lookupTeamBtn')?.addEventListener('click', lookupTeamByCode);
  document.getElementById('confirmEventRegBtn')?.addEventListener('click', confirmEventRegistration);
}

async function initApp() {
  setupEventListeners();
  await loadDepartments();
  await initAuth();
  initGoogleGis();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
