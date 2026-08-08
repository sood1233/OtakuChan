// ─────────────────────────────────────────────────────────────
// SETTINGS PAGE — /settings.html (requires login)
// ─────────────────────────────────────────────────────────────
async function loadSettings() {
  const root = document.getElementById('settings-root');
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    root.innerHTML = `<div class="post-login-gate" style="border-top:none;">Log in to manage your settings. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.</div>`;
    return;
  }

  const profile = await getProfile(session.user.id);
  const uname = profile?.username || 'user';

  root.innerHTML = `
    <div class="settings-section">
      <h2>Profile</h2>
      <p class="sub">Display name, bio, and avatar are edited from your profile page.</p>
      <a class="profile-edit-btn" href="profile.html?u=${encodeURIComponent(uname)}&edit=1">Edit Profile</a>
    </div>

    <div class="settings-section">
      <h2>Account</h2>
      <div class="settings-row">
        <span class="lbl">Email</span>
        <span class="val">${esc(session.user.email || '')}</span>
      </div>
      <div class="errmsg" id="set-email-err" style="display:none;"></div>
      <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin:10px 0 4px;">Change email</label>
      <input type="email" id="set-email" placeholder="new@email.com">
      <div style="margin-top:8px;">
        <input type="submit" class="pf-btn" value="Update Email" onclick="updateEmail();return false;">
        <span id="set-email-st" style="font-size:11px;color:var(--muted);margin-left:8px;"></span>
      </div>
    </div>

    <div class="settings-section">
      <h2>Password</h2>
      <div class="errmsg" id="set-pw-err" style="display:none;"></div>
      <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin:0 0 4px;">New password</label>
      <input type="password" id="set-pw" minlength="8" autocomplete="new-password">
      <span class="auth-hint">At least 8 characters.</span>
      <div style="margin-top:8px;">
        <input type="submit" class="pf-btn" value="Update Password" onclick="updatePassword();return false;">
        <span id="set-pw-st" style="font-size:11px;color:var(--muted);margin-left:8px;"></span>
      </div>
    </div>

    <div class="settings-section">
      <h2>Session</h2>
      <button class="pf-btn" style="background:var(--like);" onclick="logOut()">Log out</button>
    </div>
  `;
}

async function updateEmail() {
  const input = document.getElementById('set-email');
  const errEl = document.getElementById('set-email-err');
  const stEl = document.getElementById('set-email-st');
  clearErr(errEl);
  const email = input.value.trim();
  if (!email) { showErr(errEl, 'Enter a new email address.'); return; }
  stEl.textContent = 'Saving…';
  try {
    const { error } = await sb.auth.updateUser({ email });
    if (error) throw error;
    stEl.textContent = '';
    input.value = '';
    alert('Check both your old and new inbox to confirm this change.');
  } catch (e) {
    showErr(errEl, e.message || 'Could not update email.');
    stEl.textContent = '';
  }
}

async function updatePassword() {
  const input = document.getElementById('set-pw');
  const errEl = document.getElementById('set-pw-err');
  const stEl = document.getElementById('set-pw-st');
  clearErr(errEl);
  const password = input.value;
  if (password.length < 8) { showErr(errEl, 'Password must be at least 8 characters.'); return; }
  stEl.textContent = 'Saving…';
  try {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
    stEl.textContent = '';
    input.value = '';
    alert('Password updated.');
  } catch (e) {
    showErr(errEl, e.message || 'Could not update password.');
    stEl.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', loadSettings);
