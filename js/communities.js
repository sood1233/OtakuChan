// ─────────────────────────────────────────────────────────────
// COMMUNITIES BROWSE PAGE — /communities
// "All" lists every community (newest first); "Joined" lists just
// the current user's own. Join/leave happens inline via the shared
// joinCommunity()/leaveCommunity() helpers in common.js.
// ─────────────────────────────────────────────────────────────
let communitiesTab = 'all'; // 'all' | 'mine'
let joinedIds = new Set();  // populated once, used to render the right Join/Joined pill on the "All" list too

async function loadJoinedIds() {
  if (!currentSession) { joinedIds = new Set(); return; }
  const { data } = await sb.from('community_members').select('community_id').eq('user_id', currentSession.user.id);
  joinedIds = new Set((data || []).map(r => r.community_id));
}

function switchCommunitiesTab(tab) {
  if (tab === communitiesTab) return;
  communitiesTab = tab;
  document.getElementById('ctab-all').classList.toggle('active', tab === 'all');
  document.getElementById('ctab-mine').classList.toggle('active', tab === 'mine');
  renderList();
}

async function renderList() {
  const listEl = document.getElementById('communities-list');
  listEl.innerHTML = skeletonFeedHtml();

  if (communitiesTab === 'mine' && !currentSession) {
    listEl.innerHTML = `<div class="post-login-gate" style="border-top:none;">You need an account to join communities. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.</div>`;
    return;
  }

  let list;
  if (communitiesTab === 'mine') {
    const { data, error } = await sb.from('community_members')
      .select('community:communities(*)')
      .eq('user_id', currentSession.user.id)
      .order('joined_at', { ascending: false });
    if (error) { listEl.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
    list = (data || []).map(r => r.community).filter(Boolean);
  } else {
    const { data, error } = await sb.from('communities').select('*')
      .order('member_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { listEl.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
    list = data || [];
  }

  if (!list.length) {
    listEl.innerHTML = communitiesTab === 'mine'
      ? `<div id="feed-empty">You haven't joined any communities yet.</div>`
      : `<div id="feed-empty">No communities yet. Be the first to create one.</div>`;
    return;
  }

  listEl.innerHTML = `<div class="comm-list">` +
    list.map(c => communityRowHtml(c, communitiesTab === 'mine' || joinedIds.has(c.id))).join('') +
    `</div>`;
}

// Overrides the compact sidebar-box version from common.js with a
// slightly richer row for this full-page browse list — same markup
// shape (so communityToggleJoin()'s .comm-row lookups still work),
// plus the description line, which the sidebar box has no room for.
function communityRowHtml(c, joined) {
  const initial = esc((c.name || '?').trim().charAt(0).toUpperCase() || '?');
  const btn = joined
    ? `<button class="who-follow-btn comm-joined-btn" onclick="event.preventDefault();communityToggleJoin('${c.id}', this, true)">Joined</button>`
    : `<button class="who-follow-btn" onclick="event.preventDefault();communityToggleJoin('${c.id}', this, false)">Join</button>`;
  return `
    <a class="who-row comm-row" href="${communityUrl(c.slug)}">
      <span class="comm-avatar">${initial}</span>
      <span class="who-row-txt">
        <span class="who-row-name">${esc(c.name)}</span>
        ${c.description ? `<span class="comm-desc">${esc(c.description)}</span>` : ''}
        <span class="who-row-handle">${fmtCount(c.member_count)} member${c.member_count === 1 ? '' : 's'}</span>
      </span>
      ${btn}
    </a>`;
}

// Keeps this page's own list (and its Join/Joined pills) in sync
// whenever a join/leave happens anywhere on the page — including via
// the shared sidebar box if it's ever added here too.
function onCommunityMembershipChanged(communityId, joined) {
  if (joined) joinedIds.add(communityId); else joinedIds.delete(communityId);
  if (communitiesTab === 'mine') renderList(); // the row needs to appear/disappear entirely
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise the join state can render before we know who's logged in
  await loadJoinedIds();
  renderList();
});
