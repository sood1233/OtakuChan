// ─────────────────────────────────────────────────────────────
// LISTS BROWSE PAGE — /lists
// Twitter-style layout: a "Discover new Lists" section up top (public
// Lists you don't already own or follow, each with a circular Follow
// button — see listDiscoverRowHtml() in common.js), then two tabs:
// "Your Lists" = Lists you own OR follow (merged, most-recent-
// activity first), and "Lists you're on" = Lists someone else made
// and curated this account onto (list_members — mirrors Twitter's
// own second tab). Both require an account, same as Communities.
// ─────────────────────────────────────────────────────────────
let listsTab = 'mine'; // 'mine' | 'onthem'
let followingListIds = new Set(); // Lists this account follows — drives the Discover section's + / ✓ state and the "Your Lists" tab
let discoverLists = [];   // public Lists not owned/followed, loaded once
let discoverOwnerById = new Map();
let discoverPreviewByList = new Map();
let discoverExpanded = false;
const DISCOVER_PREVIEW = 3;
let listsSearchQuery = '';

function switchListsTab(tab) {
  if (tab === listsTab) return;
  listsTab = tab;
  document.getElementById('ltab-mine').classList.toggle('active', tab === 'mine');
  document.getElementById('ltab-onthem').classList.toggle('active', tab === 'onthem');
  renderLists();
}

async function loadFollowingIds() {
  if (!currentSession) { followingListIds = new Set(); return; }
  const { data } = await sb.from('list_followers').select('list_id').eq('follower_id', currentSession.user.id);
  followingListIds = new Set((data || []).map(r => r.list_id));
}

// ── DISCOVER NEW LISTS ──
async function loadDiscover() {
  const box = document.getElementById('list-discover');
  if (!box) return;
  if (!currentSession) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const { data: owned } = await sb.from('lists').select('id').eq('owner_id', currentSession.user.id);
  const excludeIds = new Set([...(owned || []).map(l => l.id), ...followingListIds]);

  const { data, error } = await sb.from('lists').select('*')
    .eq('is_private', false)
    .order('follower_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !data) { box.style.display = 'none'; box.innerHTML = ''; return; }

  discoverLists = data.filter(l => !excludeIds.has(l.id));
  if (!discoverLists.length) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const ownerIds = [...new Set(discoverLists.map(l => l.owner_id))];
  const listIds = discoverLists.map(l => l.id);
  const [{ data: owners }, { data: followerRows }] = await Promise.all([
    sb.from('profiles').select('id,username,display_name,avatar_url,verified').in('id', ownerIds),
    sb.from('list_followers').select('list_id, follower:profiles(id,username,avatar_url)')
      .in('list_id', listIds).order('followed_at', { ascending: true }).limit(200)
  ]);
  discoverOwnerById = new Map((owners || []).map(o => [o.id, o]));
  discoverPreviewByList = new Map();
  (followerRows || []).forEach(r => {
    if (!r.follower) return;
    const arr = discoverPreviewByList.get(r.list_id) || [];
    if (arr.length < 3) arr.push(r.follower);
    discoverPreviewByList.set(r.list_id, arr);
  });

  box.style.display = '';
  renderDiscoverBody();
}

function discoverFiltered() {
  const q = listsSearchQuery.trim().toLowerCase();
  if (!q) return discoverLists;
  return discoverLists.filter(l => l.name.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q));
}

function renderDiscoverBody() {
  const box = document.getElementById('list-discover');
  if (!box) return;
  const filtered = discoverFiltered();
  if (!filtered.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';

  const shown = discoverExpanded ? filtered : filtered.slice(0, DISCOVER_PREVIEW);
  const rows = shown.map(l => listDiscoverRowHtml(
    l, discoverOwnerById.get(l.owner_id), followingListIds.has(l.id), discoverPreviewByList.get(l.id) || []
  )).join('');
  const showMore = (!discoverExpanded && filtered.length > DISCOVER_PREVIEW)
    ? `<a href="#" class="list-discover-showmore" onclick="discoverExpanded=true;renderDiscoverBody();return false;">Show more</a>`
    : '';

  box.innerHTML = `<div class="list-sec-hdr">Discover new Lists</div>` +
    `<div class="list-discover-list">${rows}</div>${showMore}`;
}

// Called by listToggleFollow() (common.js) after a follow/unfollow
// completes anywhere on this page.
function onListFollowChanged(listId, following) {
  if (following) followingListIds.add(listId); else followingListIds.delete(listId);
  if (listsTab === 'mine') renderLists();
  // A newly-followed List should drop off Discover; an unfollowed
  // public List can reappear there without a full reload.
  loadDiscover();
}

// ── YOUR LISTS / LISTS YOU'RE ON ──
async function renderLists() {
  const listEl = document.getElementById('lists-list');
  listEl.innerHTML = skeletonFeedHtml();

  if (!currentSession) {
    listEl.innerHTML = `<div class="post-login-gate" style="border-top:none;">You need an account to create, follow, and view Lists. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.</div>`;
    return;
  }

  const q = listsSearchQuery.trim().toLowerCase();
  const matches = l => !q || l.name.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q);

  if (listsTab === 'mine') {
    // "Your Lists" = Lists you own, unioned with Lists you follow —
    // sorted by whichever happened more recently, newest first.
    const [{ data: owned, error: ownErr }, { data: followedRows, error: folErr }] = await Promise.all([
      sb.from('lists').select('*').eq('owner_id', currentSession.user.id).order('created_at', { ascending: false }),
      sb.from('list_followers').select('followed_at, list:lists(*)').eq('follower_id', currentSession.user.id).order('followed_at', { ascending: false })
    ]);
    if (ownErr) { listEl.innerHTML = `<div class="errmsg">${esc(ownErr.message)}</div>`; return; }
    const ownedRows = (owned || []).map(l => ({ l, t: l.created_at, following: false }));
    const followedRowsClean = (folErr ? [] : followedRows || []).filter(r => r.list).map(r => ({ l: r.list, t: r.followed_at, following: true }));
    let merged = [...ownedRows, ...followedRowsClean].sort((a, b) => new Date(b.t) - new Date(a.t));
    merged = merged.filter(r => matches(r.l));

    if (!merged.length) {
      listEl.innerHTML = q
        ? `<div id="feed-empty">No Lists found for &ldquo;${esc(listsSearchQuery.trim())}&rdquo;.</div>`
        : `<div id="feed-empty">You haven't created or followed any Lists yet. Tap &ldquo;+ Create&rdquo;, or follow one from Discover above.</div>`;
      return;
    }

    let ownerById = new Map();
    const followedOwnerIds = [...new Set(followedRowsClean.map(r => r.l.owner_id))];
    if (followedOwnerIds.length) {
      const { data: owners } = await sb.from('profiles').select('id,username,display_name,verified').in('id', followedOwnerIds);
      ownerById = new Map((owners || []).map(o => [o.id, o]));
    }
    listEl.innerHTML = `<div class="list-list">` +
      merged.map(r => listRowHtml(r.l, r.following ? ownerById.get(r.l.owner_id) : null, { following: r.following })).join('') +
      `</div>`;
    return;
  }

  // "Lists you're on" — every list_members row for this account,
  // joined back to its list. A plain by-id lookup (rather than a
  // nested list:lists(...) embed) keeps this working the moment
  // lists.sql is run, same reasoning as attachQuotedPosts()/
  // loadUserReplies() elsewhere in the app.
  const { data: memberRows, error: memErr } = await sb.from('list_members')
    .select('list_id').eq('member_id', currentSession.user.id);
  if (memErr) { listEl.innerHTML = `<div class="errmsg">${esc(memErr.message)}</div>`; return; }
  const listIds = [...new Set((memberRows || []).map(r => r.list_id))];
  let list = [];
  if (listIds.length) {
    const { data, error } = await sb.from('lists').select('*').in('id', listIds).order('created_at', { ascending: false });
    if (error) { listEl.innerHTML = `<div class="errmsg">${esc(error.message)}</div>`; return; }
    list = (data || []).filter(matches);
  }

  if (!list.length) {
    listEl.innerHTML = q
      ? `<div id="feed-empty">No Lists found for &ldquo;${esc(listsSearchQuery.trim())}&rdquo;.</div>`
      : `<div id="feed-empty">No one's added you to a List yet.</div>`;
    return;
  }

  const ownerIds = [...new Set(list.map(l => l.owner_id))];
  const { data: owners } = await sb.from('profiles').select('id,username,display_name,verified').in('id', ownerIds);
  const ownerById = new Map((owners || []).map(o => [o.id, o]));
  listEl.innerHTML = `<div class="list-list">` +
    list.map(l => listRowHtml(l, ownerById.get(l.owner_id))).join('') +
    `</div>`;
}

// Debounced so every keystroke doesn't refetch — 250ms feels instant
// without hammering Supabase while someone's still typing. Filters
// both the Discover section and whichever tab is active.
let _listsSearchDebounce = null;
function wireListsSearch() {
  const input = document.getElementById('lists-search');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_listsSearchDebounce);
    _listsSearchDebounce = setTimeout(() => {
      listsSearchQuery = input.value;
      renderDiscoverBody();
      renderLists();
    }, 250);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise this can render before we know who's logged in
  wireListsSearch();
  await loadFollowingIds();
  loadDiscover();
  renderLists();
});
