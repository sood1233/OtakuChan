// ─────────────────────────────────────────────────────────────
// AUTH — accounts are required to post on InteractInk now. This file
// wires up: session state, the header's login/signup vs avatar
// dropdown, sign up / log in / log out, and avatar uploads.
// Included on every page (after supabase-config.js + common.js).
// ─────────────────────────────────────────────────────────────

let currentSession = null;
let currentProfile = null;

// Resolves once the initial session check has settled — i.e. once
// `currentSession` is safe to read (either a real session or
// definitely null, logged out). Every page's own post-loading code
// (board.js/profile.js/thread.js/bookmarks.js/search.js) awaits this
// before its first render. Without it, a page's own DOMContentLoaded
// listener can — and often does — finish its posts query before this
// file's getSession() call resolves, rendering every post card as if
// nobody were logged in. That's harmless for most of the UI (likes/
// bookmarks/reposts just get corrected the moment you interact with
// them), but "Delete" only for your own posts is baked into the menu
// HTML at render time and never gets a second pass — so it can look
// like Delete is permanently missing/broken depending on how that
// race happens to land.
let resolveAuthReady;
const authReady = new Promise(res => { resolveAuthReady = res; });

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data || null;
}

// Renders whatever should sit in the header's #auth-area — either
// [Log in] [Sign up], or the avatar + username dropdown menu.
async function renderAuthArea() {
  const el = document.getElementById('auth-area');
  renderSideNav(); renderMobileChrome(); // paint immediately with whatever we knew last; repainted below once session settles

  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;
  resolveAuthReady();

  if (!session) {
    currentProfile = null;
    unreadNotifCount = 0;
    unreadChatCount = 0;
    renderSideNav(); renderMobileChrome();
    if (el) el.innerHTML = `<div class="auth-cta"><a class="cta-primary" href="signup.html">Sign up</a><a class="cta-ghost" href="login.html">Log in</a></div>`;
    refreshPostGates();
    return;
  }

  currentProfile = await getProfile(session.user.id);
  const uname = currentProfile?.username || 'user';
  const avatar = avatarUrl(currentProfile?.avatar_url);
  renderSideNav(); renderMobileChrome();
  loadUnreadNotifCount();
  subscribeNotifBadge();
  loadUnreadChatCount();
  subscribeChatBadge();

  if (el) el.innerHTML = `
    <div class="acct" id="acct-wrap">
      <button class="acct-btn" id="acct-btn" onclick="toggleAcctMenu();return false;">
        <img class="avatar pfp-md" src="${esc(avatar)}" alt="">
        <span class="acct-txt">
          <span class="acct-name">${esc(currentProfile?.display_name || uname)}</span>
          <span class="acct-handle">@${esc(uname)}</span>
        </span>
        <span class="acct-dots">${NAV_ICON.dots}</span>
      </button>
      <div class="acct-menu" id="acct-menu">
        <a href="${profileUrl(uname)}">My Profile</a>
        <a href="editprofile.html">Edit Profile</a>
        <button onclick="logOut()">Log out</button>
      </div>
    </div>`;
  refreshPostGates();
}

// Unread notification count for the sidebar bell badge.
async function loadUnreadNotifCount() {
  if (!currentSession) { unreadNotifCount = 0; renderSideNav(); renderMobileChrome(); return; }
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', currentSession.user.id).eq('read', false);
  unreadNotifCount = count || 0;
  renderSideNav(); renderMobileChrome();
}

// Live-bump the bell badge the moment a new notification lands,
// without needing to be on the notifications page.
let notifBadgeChannel = null;
function subscribeNotifBadge() {
  if (notifBadgeChannel || !currentSession) return;
  notifBadgeChannel = sb.channel(`notif-badge-${currentSession.user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentSession.user.id}` }, () => {
      unreadNotifCount++;
      renderSideNav(); renderMobileChrome();
    })
    .subscribe();
}

// Unread DM count for the sidebar/tab-bar chat badge — counts unread
// messages, same shape as loadUnreadNotifCount() above.
async function loadUnreadChatCount() {
  if (!currentSession) { unreadChatCount = 0; renderSideNav(); renderMobileChrome(); return; }
  const { count } = await sb.from('messages').select('id', { count: 'exact', head: true })
    .eq('recipient_id', currentSession.user.id).eq('read', false);
  unreadChatCount = count || 0;
  renderSideNav(); renderMobileChrome();
}

// Live-bump the chat badge the moment a new message lands, without
// needing to be on the chat page (mirrors subscribeNotifBadge()).
let chatBadgeChannel = null;
function subscribeChatBadge() {
  if (chatBadgeChannel || !currentSession) return;
  chatBadgeChannel = sb.channel(`chat-badge-${currentSession.user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${currentSession.user.id}` }, () => {
      unreadChatCount++;
      renderSideNav(); renderMobileChrome();
    })
    .subscribe();
}

function toggleAcctMenu() {
  document.getElementById('acct-wrap')?.classList.toggle('open');
}
// Shared close-on-outside-click for every .acct flyout (the bottom
// account card AND the sidebar's More menu use the same .acct/.acct-menu
// pattern, so one listener covers both).
document.addEventListener('click', (e) => {
  document.querySelectorAll('.acct.open').forEach(wrap => {
    if (!wrap.contains(e.target)) wrap.classList.remove('open');
  });
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
    toast('You need an account to do that. Log in or sign up first.', 'error');
    return false;
  }
  return true;
}

// ── PASSWORD VISIBILITY TOGGLE — used by login.html / signup.html's
// eye-icon button next to the password field. Purely a display
// affordance (input type text/password), no auth logic involved. ──
function togglePwVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.classList.toggle('showing', !showing);
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

// ── SIGN UP ──
// Flow: signUp() creates the auth.users row (and, via the DB trigger,
// the profiles row + auto-follow of @marpe) right away, but with email
// confirmation ON Supabase withholds a session until the code is
// verified. We show a 6-digit code step instead of Supabase's default
// magic-link email; verifyOtp() below returns a real session the
// instant the code checks out, so the user never has to separately
// log in — "verified" and "logged in" happen in the same step.
let pendingSignupEmail = null;

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
      // Email confirmation is OFF in the Supabase dashboard — the
      // account is created and already logged in, nothing to verify.
      location.href = 'index.html';
      return;
    }

    // Supabase gotcha: if this email already has an unconfirmed
    // account (e.g. someone signed up, never entered the code, and
    // tried again), signUp() returns success with NO error and NO
    // session — but it also does NOT send a new email, to avoid
    // leaking whether an email is registered. Silently showing the
    // code step here is exactly what makes it look like "the email
    // never arrives": there's genuinely nothing new in their inbox.
    // data.user.identities is an empty array in this specific case
    // (a real new signup has one identity in it), so use that to
    // tell the two situations apart and be honest about which one
    // happened.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      pendingSignupEmail = email;
      document.getElementById('su-form').style.display = 'none';
      const emailSpan = document.getElementById('su-code-email');
      if (emailSpan) emailSpan.textContent = email;
      document.getElementById('su-code-step').style.display = 'block';
      showErr(document.getElementById('su-code-err'),
        'This email already has a pending, unverified account — no new email was just sent. Tap "Resend code" below to get a fresh one.');
      document.getElementById('su-code')?.focus();
      return;
    }

    // Genuine new signup — email confirmation is ON, and Supabase
    // just sent the code for the first time. Swap to the code-entry
    // step.
    pendingSignupEmail = email;
    document.getElementById('su-form').style.display = 'none';
    const emailSpan = document.getElementById('su-code-email');
    if (emailSpan) emailSpan.textContent = email;
    document.getElementById('su-code-step').style.display = 'block';
    document.getElementById('su-code')?.focus();
  } catch (err) {
    showErr(errEl, err.message?.includes('duplicate') || err.message?.includes('unique')
      ? 'That username or email is already taken.'
      : (err.message || 'Sign up failed.'));
    btn.disabled = false; btn.value = 'Sign Up';
  }
}

// ── VERIFY SIGNUP CODE ──
// verifyOtp({ type: 'signup' }) both confirms the email AND returns a
// session in one call — that's what lets us skip a separate log-in.
async function doVerifySignupCode(e) {
  e?.preventDefault();
  const code = document.getElementById('su-code').value.trim();
  const btn = document.getElementById('su-code-btn');
  const errEl = document.getElementById('su-code-err');
  clearErr(errEl);

  if (!pendingSignupEmail) {
    showErr(errEl, 'Something went wrong — refresh and sign up again.');
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showErr(errEl, 'Enter the 6-digit code from your email.');
    return;
  }

  btn.disabled = true; btn.value = 'Verifying…';
  try {
    const { data, error } = await sb.auth.verifyOtp({
      email: pendingSignupEmail,
      token: code,
      type: 'signup'
    });
    if (error) throw error;
    if (!data.session) throw new Error('Verified, but no session came back — try logging in.');
    // Logged in — account fully created, no separate log-in step needed.
    location.href = 'index.html';
  } catch (err) {
    showErr(errEl, /expired/i.test(err.message || '') ? 'That code expired — send a new one below.'
      : /invalid|token/i.test(err.message || '') ? 'That code is incorrect.'
      : (err.message || 'Verification failed.'));
    btn.disabled = false; btn.value = 'Verify';
  }
}

// ── RESEND SIGNUP CODE ──
async function doResendSignupCode() {
  const errEl = document.getElementById('su-code-err');
  const resendBtn = document.getElementById('su-resend-btn');
  clearErr(errEl);
  if (!pendingSignupEmail) return;
  if (resendBtn) { resendBtn.disabled = true; resendBtn.textContent = 'Sending…'; }
  try {
    const { error } = await sb.auth.resend({ type: 'signup', email: pendingSignupEmail });
    if (error) throw error;
    toast('New code sent — check your email.', 'success');
  } catch (err) {
    showErr(errEl, err.message || 'Could not resend the code.');
  } finally {
    if (resendBtn) { resendBtn.disabled = false; resendBtn.textContent = 'Resend code'; }
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
