// ─────────────────────────────────────────────────────────────
// ADMIN PANEL — /admin (admin.html). Three things, nothing else:
// verify a user, ban a user, delete a post. Gated two ways:
//   1) Client-side here: hides the page and bounces anyone who
//      isn't logged in as the admin account, so a stranger who
//      finds the URL just sees a blank "redirecting" page.
//   2) Database-side, which is the part that actually matters:
//      every action below calls an RPC (admin_verify_user /
//      admin_ban_user / admin_delete_post) that re-checks
//      is_admin() itself before doing anything — see
//      supabase/admin_panel.sql. Even if someone bypassed this
//      file entirely and called the API directly, the database
//      would still refuse them. That's the real lock; this file
//      is just the UI in front of it.
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  renderAuthArea();
  await authReady;

  if (!currentSession) {
    location.href = 'login.html';
    return;
  }

  // Fast client-side bounce for the obvious case (not logged in as
  // @marpe at all) — purely a UX nicety, so a non-admin isn't left
  // staring at "Checking access..." while an RPC round-trips. This is
  // NOT the real gate: is_admin() below (and every admin_*() RPC) is
  // re-checked server-side regardless, because a client-side check
  // like this one can always be edited out of the page's own JS.
  if ((currentProfile?.username || '').toLowerCase() !== 'marpe') {
    location.href = '/';
    return;
  }

  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    // Not the admin account — don't even hint the page exists.
    location.href = '/';
    return;
  }

  document.getElementById('admin-gate').style.display = 'none';
  document.getElementById('admin-panel').style.display = '';

  wireUserSearch();
  wirePostSearch();
  loadRecentPosts();
});

// ── USERS: search by username, verify/ban from the results row ──

let userSearchTimer = null;
function wireUserSearch() {
  const input = document.getElementById('adm-user-q');
  input.addEventListener('input', () => {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(() => runUserSearch(input.value.trim()), 300);
  });
}

async function runUserSearch(q) {
  const box = document.getElementById('adm-user-results');
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="no-t">Searching&hellip;</div>`;

  const { data, error } = await sb.from('profiles')
    .select('id,username,display_name,avatar_url,verified,banned')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(15);

  if (error) { box.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  if (!data || !data.length) { box.innerHTML = `<div class="no-t">No users found.</div>`; return; }

  box.innerHTML = data.map(adminUserRowHtml).join('');
}

function adminUserRowHtml(p) {
  const uname = p.username || 'unknown';
  const name = esc(p.display_name || uname);
  return `
  <div class="adm-row" id="adm-user-${p.id}">
    <a href="${profileUrl(uname)}" target="_blank" rel="noopener">
      <img class="avatar pfp-md" src="${esc(avatarUrl(p.avatar_url))}" alt="">
    </a>
    <div class="adm-row-txt">
      <span class="adm-row-name">${name}${vBadge(p)}${p.banned ? '<span class="adm-tag adm-tag-banned">Banned</span>' : ''}</span>
      <span class="adm-row-handle">@${esc(uname)}</span>
    </div>
    <div class="adm-row-acts">
      <button class="adm-btn ${p.verified ? 'adm-btn-active' : ''}" onclick="adminToggleVerify('${p.id}', ${!p.verified})">${p.verified ? 'Unverify' : 'Verify'}</button>
      <button class="adm-btn adm-btn-danger ${p.banned ? 'adm-btn-active' : ''}" onclick="adminToggleBan('${p.id}', ${!p.banned}, '${esc(uname)}')">${p.banned ? 'Unban' : 'Ban'}</button>
    </div>
  </div>`;
}

async function adminToggleVerify(userId, makeVerified) {
  try {
    const { error } = await sb.rpc('admin_verify_user', { target_user_id: userId, make_verified: makeVerified });
    if (error) throw error;
    toast(makeVerified ? 'User verified.' : 'Verification removed.');
    runUserSearch(document.getElementById('adm-user-q').value.trim());
  } catch (e) {
    toast(e.message || 'Could not update that user.', 'error');
  }
}

async function adminToggleBan(userId, makeBanned, uname) {
  if (makeBanned) {
    const ok = await ocConfirm({
      title: `Ban @${uname}?`,
      desc: 'They will be signed out and blocked from posting or replying until unbanned.',
      confirmLabel: 'Ban',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const { error } = await sb.rpc('admin_ban_user', { target_user_id: userId, make_banned: makeBanned });
    if (error) throw error;
    toast(makeBanned ? 'User banned.' : 'User unbanned.');
    runUserSearch(document.getElementById('adm-user-q').value.trim());
  } catch (e) {
    toast(e.message || 'Could not update that user.', 'error');
  }
}

// ── POSTS: recent feed by default, or search by body text / @username ──

let postSearchTimer = null;
function wirePostSearch() {
  const input = document.getElementById('adm-post-q');
  input.addEventListener('input', () => {
    clearTimeout(postSearchTimer);
    postSearchTimer = setTimeout(() => {
      const q = input.value.trim();
      q ? runPostSearch(q) : loadRecentPosts();
    }, 300);
  });
}

async function loadRecentPosts() {
  const box = document.getElementById('adm-post-results');
  box.innerHTML = `<div class="no-t">Loading&hellip;</div>`;
  const { data, error } = await sb.from('posts')
    .select('id,body,created_at,author_id,is_deleted,profile:profiles!posts_author_id_fkey(username,display_name,avatar_url,verified)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { box.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  box.innerHTML = (data || []).map(adminPostRowHtml).join('') || `<div class="no-t">No posts yet.</div>`;
}

async function runPostSearch(q) {
  const box = document.getElementById('adm-post-results');
  box.innerHTML = `<div class="no-t">Searching&hellip;</div>`;
  let query = sb.from('posts')
    .select('id,body,created_at,author_id,is_deleted,profile:profiles!posts_author_id_fkey(username,display_name,avatar_url,verified)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(30);

  query = q.startsWith('@')
    ? query.ilike('profile.username', `%${q.slice(1)}%`)
    : query.ilike('body', `%${q}%`);

  const { data, error } = await query;
  if (error) { box.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
  const rows = (data || []).filter(p => p.profile); // ilike on a joined column can return null-joins; drop those
  box.innerHTML = rows.map(adminPostRowHtml).join('') || `<div class="no-t">No matching posts.</div>`;
}

function adminPostRowHtml(p) {
  const uname = p.profile?.username || 'unknown';
  const name = esc(p.profile?.display_name || uname);
  return `
  <div class="adm-row adm-post-row" id="adm-post-${p.id}">
    <img class="avatar pfp-md" src="${esc(avatarUrl(p.profile?.avatar_url))}" alt="">
    <div class="adm-row-txt">
      <span class="adm-row-name">${name}${vBadge(p.profile)} <span class="adm-row-handle">@${esc(uname)}</span> &middot; <span class="adm-row-dt">${timeAgo(p.created_at)}</span></span>
      <a class="adm-post-body" href="${postUrl(p)}" target="_blank" rel="noopener">${esc((p.body || '').slice(0, 200))}</a>
    </div>
    <div class="adm-row-acts">
      <button class="adm-btn adm-btn-danger" onclick="adminDeletePost('${p.id}')">Delete</button>
    </div>
  </div>`;
}

async function adminDeletePost(postId) {
  const ok = await ocConfirm({
    title: 'Delete this post?',
    desc: 'This removes it from the site. This cannot be undone from here.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    const { error } = await sb.rpc('admin_delete_post', { post_id: postId });
    if (error) throw error;
    document.getElementById(`adm-post-${postId}`)?.remove();
    toast('Post deleted.');
  } catch (e) {
    toast(e.message || 'Could not delete that post.', 'error');
  }
}
