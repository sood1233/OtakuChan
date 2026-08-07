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
        <div class="uname-row">
          <div class="uname">${esc(profile.display_name || profile.username)}</div>
          ${!isOwnProfile && session ? `<button class="follow-btn" id="follow-btn" onclick="toggleFollow()">Follow</button>` : ''}
          ${!isOwnProfile && !session ? `<a class="follow-btn" href="login.html">Follow</a>` : ''}
        </div>
        <div class="handle">@${esc(profile.username)}</div>
        <div class="bio">${esc(profile.bio || '')}</div>
        <div class="profile-stats">
          <span class="stat-item" onclick="openFollowList('followers')"><b id="stat-followers">${fmtCount(profile.followers_count)}</b> Followers</span>
          <span class="stat-item" onclick="openFollowList('following')"><b id="stat-following">${fmtCount(profile.following_count)}</b> Following</span>
        </div>
        <div class="profile-meta">Joined ${new Date(profile.created_at).toLocaleDateString()}</div>
        ${isOwnProfile ? `<div style="margin-top:10px;"><a href="#" class="profile-edit-btn" onclick="toggleEdit();return false;">Edit Profile</a></div>` : ''}
      </div>
    </div>

    ${isOwnProfile ? editFormHtml(profile) : ''}

    <div class="sec-bar">Posts by @${esc(profile.username)}</div>
    <div id="profile-posts"><span class="spinner">Loading posts&hellip;</span></div>

    <div class="modal-bg" id="modal-followlist">
      <div class="modal">
        <a class="modal-close" href="#" onclick="closeFollowList();return false;">&#10005;</a>
        <h2 id="followlist-title">Followers</h2>
        <div id="followlist-body" class="followlist-body"></div>
      </div>
    </div>
  `;

  if (isOwnProfile) {
    wireFilePreview('pe-avatar-file', 'pe-avatar-fp', 'pe-err');
    if (params.get('edit') === '1') document.getElementById('edit-form')?.classList.add('open');
  } else if (session) {
    isFollowing(profile.id).then(f => setFollowBtnState(f));
  }

  loadUserPosts(profile.id);
}

// ── FOLLOW BUTTON ──
let followBusy = false;
function setFollowBtnState(following) {
  const btn = document.getElementById('follow-btn');
  if (!btn) return;
  btn.textContent = following ? 'Following' : 'Follow';
  btn.classList.toggle('following', following);
}

async function toggleFollow() {
  if (!requireLogin() || followBusy || !viewedProfile) return;
  const btn = document.getElementById('follow-btn');
  const following = btn.classList.contains('following');
  followBusy = true;
  btn.disabled = true;
  try {
    if (following) {
      const { error } = await unfollowUser(viewedProfile.id);
      if (error) throw error;
      setFollowBtnState(false);
      bumpStat('stat-followers', -1);
    } else {
      const { error } = await followUser(viewedProfile.id);
      if (error) throw error;
      setFollowBtnState(true);
      bumpStat('stat-followers', 1);
    }
  } catch (e) {
    alert(e.message || 'Could not update follow status.');
  } finally {
    followBusy = false;
    btn.disabled = false;
  }
}

function bumpStat(elId, delta) {
  const el = document.getElementById(elId);
  if (!el) return;
  const raw = parseInt((el.textContent || '0').replace(/[^\d]/g, ''), 10) || 0;
  el.textContent = fmtCount(Math.max(raw + delta, 0));
}

// ── FOLLOWERS / FOLLOWING LIST MODAL ──
async function openFollowList(kind) {
  if (!viewedProfile) return;
  document.getElementById('followlist-title').textContent = kind === 'followers' ? 'Followers' : 'Following';
  const body = document.getElementById('followlist-body');
  body.innerHTML = `<span class="spinner">Loading&hellip;</span>`;
  document.getElementById('modal-followlist').classList.add('open');

  const col = kind === 'followers' ? 'followee_id' : 'follower_id';
  const wantCol = kind === 'followers' ? 'follower_id' : 'followee_id';
  const { data, error } = await sb.from('follows')
    .select(`${wantCol}, profile:profiles!follows_${wantCol}_fkey(username,display_name,avatar_url)`)
    .eq(col, viewedProfile.id)
    .limit(200);

  if (error) { body.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  if (!data.length) {
    body.innerHTML = `<div class="empty-note">${kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</div>`;
    return;
  }
  body.innerHTML = data.map(row => userRowHtml(row.profile)).join('');
}

function closeFollowList() {
  document.getElementById('modal-followlist')?.classList.remove('open');
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
        <span class="views" title="${p.view_count || 0} views">&#128065; ${fmtCount(p.view_count)}</span>
      </div>
      ${renderMedia(p.media_url, p.media_type)}
      <div class="pb">${renderBody(p.body)}</div>
      <div class="acts">
        <span class="ai"><span class="ic">&hearts;</span> ${p.like_count}</span>
        <a class="br" href="thread.html?id=${p.id}"><span class="ic">&#128172;</span> ${p.reply_count} repl${p.reply_count === 1 ? 'y' : 'ies'} &rarr;</a>
      </div>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', loadProfile);
