// ─────────────────────────────────────────────────────────────
// AUTH — accounts are required to post on Otakuchan now. This file
// wires up: session state, the header's login/signup vs avatar
// dropdown, sign up / log in / log out, and avatar uploads.
// Included on every page (after supabase-config.js + common.js).
// ─────────────────────────────────────────────────────────────

let currentSession = null;
let currentProfile = null;

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data || null;
}

// Renders whatever should sit in the header's #auth-area — either
// [Log in] [Sign up], or the avatar + username dropdown menu.
async function renderAuthArea() {
  const el = document.getElementById('auth-area');
  renderSideNav(); // paint the nav immediately with whatever we knew last; repainted below once session settles

  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;

  if (!session) {
    currentProfile = null;
    unreadNotifCount = 0;
    renderSideNav();
    if (el) el.innerHTML = `<div class="auth-cta"><a class="cta-primary" href="signup.html">Sign up</a><a class="cta-ghost" href="login.html">Log in</a></div>`;
    refreshPostGates();
    return;
  }

  currentProfile = await getProfile(session.user.id);
  const uname = currentProfile?.username || 'user';
  const avatar = avatarUrl(currentProfile?.avatar_url);
  renderSideNav();
  loadUnreadNotifCount();
  subscribeNotifBadge();

  if (el) el.innerHTML = `
    <div class="acct" id="acct-wrap">
      <button class="acct-btn" id="acct-btn" onclick="toggleAcctMenu();return false;">
        <img class="avatar pfp-md" src="${esc(avatar)}" alt="">
        <span class="acct-txt">${esc(uname)}</span>
      </button>
      <div class="acct-menu" id="acct-menu">
        <a href="profile.html?u=${encodeURIComponent(uname)}">My Profile</a>
        <a href="editprofile.html">Edit Profile</a>
        <button onclick="logOut()">Log out</button>
      </div>
    </div>`;
  refreshPostGates();
}

// Unread notification count for the sidebar bell badge.
async function loadUnreadNotifCount() {
  if (!currentSession) { unreadNotifCount = 0; renderSideNav(); return; }
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', currentSession.user.id).eq('read', false);
  unreadNotifCount = count || 0;
  renderSideNav();
}

// Live-bump the bell badge the moment a new notification lands,
// without needing to be on the notifications page.
let notifBadgeChannel = null;
function subscribeNotifBadge() {
  if (notifBadgeChannel || !currentSession) return;
  notifBadgeChannel = sb.channel(`notif-badge-${currentSession.user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentSession.user.id}` }, () => {
      unreadNotifCount++;
      renderSideNav();
    })
    .subscribe();
}

function toggleAcctMenu() {
  document.getElementById('acct-wrap')?.classList.toggle('open');
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('acct-wrap');
  if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
});

// Board/thread pages call this to show either the real post form or a
// "log in to post" gate, depending on session state.
function refreshPostGates() {
  document.querySelectorAll('[data-requires-auth]').forEach(elm => {
    elm.style.display = currentSession ? '' : 'none';
  });
  document.querySelectorAll('[data-requires-anon]').forEach(elm => {
    elm.style.display = currentSession ? 'none' : '';
  });
  // The board page's composer shows the logged-in user's avatar next
  // to the textarea, Twitter-style — repaint it whenever auth state
  // settles or changes. No-op on pages without a composer.
  if (typeof renderComposerAvatar === 'function') renderComposerAvatar();
}

function requireLogin() {
  if (!currentSession) {
    alert('You need an account to do that. Log in or sign up first.');
    return false;
  }
  return true;
}

// ── SIGN UP ──
async function doSignUp(e) {
  e?.preventDefault();
  const email    = document.getElementById('su-email').value.trim();
  const username = document.getElementById('su-username').value.trim();
  const password = document.getElementById('su-password').value;
  const btn = document.getElementById('su-btn');
  const errEl = document.getElementById('su-err');
  clearErr(errEl);

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    showErr(errEl, 'Username must be 3–20 characters: letters, numbers, underscore only.');
    return;
  }
  if (password.length < 8) {
    showErr(errEl, 'Password must be at least 8 characters.');
    return;
  }

  btn.disabled = true; btn.value = 'Creating account…';
  try {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { username } }
    });
    if (error) throw error;

    if (data.session) {
      // Email confirmation is off — user is logged in immediately.
      location.href = 'index.html';
    } else {
      document.getElementById('su-form').style.display = 'none';
      document.getElementById('su-ok').style.display = 'block';
    }
  } catch (err) {
    showErr(errEl, err.message?.includes('duplicate') || err.message?.includes('unique')
      ? 'That username or email is already taken.'
      : (err.message || 'Sign up failed.'));
    btn.disabled = false; btn.value = 'Sign Up';
  }
}

// ── LOG IN ──
async function doLogIn(e) {
  e?.preventDefault();
  const email    = document.getElementById('li-email').value.trim();
  const password = document.getElementById('li-password').value;
  const btn = document.getElementById('li-btn');
  const errEl = document.getElementById('li-err');
  clearErr(errEl);

  btn.disabled = true; btn.value = 'Logging in…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    location.href = 'index.html';
  } catch (err) {
    showErr(errEl, err.message === 'Invalid login credentials'
      ? 'Incorrect email or password.'
      : (err.message || 'Log in failed.'));
    btn.disabled = false; btn.value = 'Log In';
  }
}

// ── LOG OUT ──
async function logOut() {
  await sb.auth.signOut();
  location.href = 'index.html';
}

// Uploads to avatars/<uid>/<random>.<ext> — the storage RLS policy
// only allows a user to write inside their own <uid> folder.
async function uploadAvatar(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('avatars').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

document.addEventListener('DOMContentLoaded', () => {
  renderAuthArea();
  sb.auth.onAuthStateChange((_event, _session) => {
    renderAuthArea();
  });
});
