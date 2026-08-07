// ─────────────────────────────────────────────────────────────
// PROFILE PAGE — /profile.html?u=<username>[&edit=1]
// ─────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const viewUsername = params.get('u');
let viewedProfile = null;
let isOwnProfile = false;

const POST_SELECT = '*, profile:profiles(username,display_name,avatar_url)';

async function loadProfile() {
  const root = document.getElementById('profile-root');
  if (!viewUsername) {
    root.innerHTML = `<div class="errmsg">No user specified.</div>`;
    return;
  }

  const { data: { session } } = await sb.auth.getSession();

  const { data: profile, error } = await sb.from('profiles')
    .select('*').ilike('username', viewUsername).single();

  if (error || !profile) {
    root.innerHTML = `<div class="errmsg">No user found with that username.</div>`;
    return;
  }
  viewedProfile = profile;
  isOwnProfile = session && session.user.id === profile.id;
  document.title = `@${profile.username} — Otakuchan`;

  root.innerHTML = `
    <div class="profile-hdr">
      <img class="avatar pfp-lg" id="pv-avatar" src="${esc(avatarUrl(profile.avatar_url))}" alt="">
      <div class="profile-id">
        <div class="uname">${esc(profile.display_name || profile.username)}</div>
        <div class="handle">@${esc(profile.username)}</div>
        <div class="bio">${esc(profile.bio || '')}</div>
        <div class="profile-meta">Joined ${new Date(profile.created_at).toLocaleDateString()}</div>
        ${isOwnProfile ? `<div style="margin-top:10px;"><a href="#" class="profile-edit-btn" onclick="toggleEdit();return false;">Edit Profile</a></div>` : ''}
      </div>
    </div>

    ${isOwnProfile ? editFormHtml(profile) : ''}

    <div class="sec-bar">Posts by @${esc(profile.username)}</div>
    <div id="profile-posts"><span class="spinner">Loading posts&hellip;</span></div>
  `;

  if (isOwnProfile) {
    wireFilePreview('pe-avatar-file', 'pe-avatar-fp', 'pe-err');
    if (params.get('edit') === '1') document.getElementById('edit-form')?.classList.add('open');
  }

  loadUserPosts(profile.id);
}

function editFormHtml(profile) {
  return `
  <div class="pf-wrap" style="max-width:100%;margin:0 0 14px;padding:0;">
    <div class="auth-card" style="border:1px solid var(--line);">
      <b style="cursor:pointer;" onclick="toggleEdit()">Edit Profile</b>
      <div class="edit-form open" id="edit-form" style="padding:12px 14px;">
        <div class="errmsg" id="pe-err" style="display:none;"></div>

        <label>Avatar</label>
        <div class="avatar-pick">
          <img class="avatar pfp-md" id="pe-avatar-preview" src="${esc(avatarUrl(profile.avatar_url))}" alt="">
          <input type="file" id="pe-avatar-file" accept="image/*">
        </div>
        <div id="pe-avatar-fp" class="fp"></div>

        <label>Display name</label>
        <input type="text" id="pe-display" maxlength="50" value="${esc(profile.display_name || '')}" placeholder="${esc(profile.username)}">

        <label>Bio</label>
        <textarea id="pe-bio" maxlength="200" placeholder="Tell people about yourself&hellip;">${esc(profile.bio || '')}</textarea>

        <div class="edit-row">
          <input type="submit" class="pf-btn" value="Save Changes" onclick="saveProfile();return false;">
          <span id="pe-st" style="font-size:11px;color:var(--muted);"></span>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleEdit() {
  document.getElementById('edit-form')?.classList.toggle('open');
}

async function saveProfile() {
  const errEl = document.getElementById('pe-err');
  const stEl  = document.getElementById('pe-st');
  clearErr(errEl);
  stEl.textContent = 'Saving…';
  try {
    const updates = {
      display_name: document.getElementById('pe-display').value.trim().slice(0, 50) || null,
      bio: document.getElementById('pe-bio').value.trim().slice(0, 200) || null
    };
    const fileEl = document.getElementById('pe-avatar-file');
    const file = fileEl.files[0];
    if (file) {
      if (!ALLOWED_MIME.includes(file.type)) { showErr(errEl, 'Unsupported image type.'); stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading avatar…';
      updates.avatar_url = await uploadAvatar(file, viewedProfile.id);
    }
    const { error } = await sb.from('profiles').update(updates).eq('id', viewedProfile.id);
    if (error) throw error;
    stEl.textContent = '';
    location.reload();
  } catch (e) {
    showErr(errEl, e.message || 'Could not save changes.');
    stEl.textContent = '';
  }
}

async function loadUserPosts(userId) {
  const el = document.getElementById('profile-posts');
  const { data, error } = await sb.from('posts').select(POST_SELECT)
    .eq('author_id', userId).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(50);

  if (error) {
    el.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = `<div class="empty-note">No posts yet.</div>`;
    return;
  }
  el.innerHTML = data.map(p => `
    <div class="pc">
      <div class="ph">
        ${p.subject ? `<span class="subj">${esc(p.subject)}</span>` : ''}
        ${authorHtml(p.profile)}
        <span class="dt">${timeAgo(p.created_at)}</span>
        <span class="num">No.${shortId(p.id)}</span>
      </div>
      ${renderMedia(p.media_url, p.media_type)}
      <div class="pb">${renderBody(p.body)}</div>
      <div class="acts">
        <span class="ai">&hearts; ${p.like_count}</span>
        <a class="br" href="thread.html?id=${p.id}">${p.reply_count} repl${p.reply_count === 1 ? 'y' : 'ies'} &rarr;</a>
      </div>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', loadProfile);
