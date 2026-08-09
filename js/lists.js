// ─────────────────────────────────────────────────────────────
// LISTS BROWSE PAGE — /lists
// "Your Lists" = Lists this account owns. "Lists you're on" = Lists
// someone else made and added this account to (mirrors Twitter's own
// two tabs on its Lists page). Both require an account — Lists are
// personal, unlike Communities' public "All" browse tab.
// ─────────────────────────────────────────────────────────────
let listsTab = 'mine'; // 'mine' | 'onthem'

function switchListsTab(tab) {
  if (tab === listsTab) return;
  listsTab = tab;
  document.getElementById('ltab-mine').classList.toggle('active', tab === 'mine');
  document.getElementById('ltab-onthem').classList.toggle('active', tab === 'onthem');
  renderLists();
}

async function renderLists() {
  const listEl = document.getElementById('lists-list');
  listEl.innerHTML = skeletonFeedHtml();

  if (!currentSession) {
    listEl.innerHTML = `<div class="post-login-gate" style="border-top:none;">You need an account to create and view Lists. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.</div>`;
    return;
  }

  let list;
  if (listsTab === 'mine') {
    const { data, error } = await sb.from('lists')
      .select('*')
      .eq('owner_id', currentSession.user.id)
      .order('created_at', { ascending: false });
    if (error) { listEl.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
    list = data || [];
  } else {
    // "Lists you're on" — every list_members row for this account,
    // joined back to its list. A plain by-id lookup (rather than a
    // nested list:lists(...) embed) keeps this working the moment
    // lists.sql is run, same reasoning as attachQuotedPosts()/
    // loadUserReplies() elsewhere in the app.
    const { data: memberRows, error: memErr } = await sb.from('list_members')
      .select('list_id').eq('member_id', currentSession.user.id);
    if (memErr) { listEl.innerHTML = `<div class="errmsg">${esc(memErr.message)}</div>`; return; }
    const listIds = [...new Set((memberRows || []).map(r => r.list_id))];
    if (!listIds.length) {
      list = [];
    } else {
      const { data, error } = await sb.from('lists').select('*').in('id', listIds).order('created_at', { ascending: false });
      if (error) { listEl.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
      list = data || [];
    }
  }

  if (!list.length) {
    listEl.innerHTML = listsTab === 'mine'
      ? `<div id="feed-empty">You haven't created any Lists yet. Tap &ldquo;+ Create&rdquo; to start one.</div>`
      : `<div id="feed-empty">No one's added you to a List yet.</div>`;
    return;
  }

  // "Lists you're on" can include lists made by other people, so show
  // whose list it is on that tab; owner ids are looked up in one
  // batch rather than per-row.
  let ownerById = new Map();
  if (listsTab === 'onthem') {
    const ownerIds = [...new Set(list.map(l => l.owner_id))];
    const { data: owners } = await sb.from('profiles').select('id,username,display_name').in('id', ownerIds);
    ownerById = new Map((owners || []).map(o => [o.id, o]));
  }

  listEl.innerHTML = `<div class="list-list">` +
    list.map(l => listRowHtml(l, listsTab === 'onthem' ? ownerById.get(l.owner_id) : null)).join('') +
    `</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise this can render before we know who's logged in
  renderLists();
});
