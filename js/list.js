// ─────────────────────────────────────────────────────────────
// SINGLE LIST PAGE — /i/lists/<uuid> (also reachable via the legacy
// list.html?id=<uuid> form — see currentListId() in common.js).
// Shows the list's header (name, description, member count,
// Edit/Delete for the owner), a Posts tab (a timeline merged from
// every member's posts, same idea as a community's feed) and a
// Members tab (who's on it, with a Remove button for the owner).
// Adding someone to a list happens from *their* profile's "···" menu
// (openAddToListModal() in common.js), not from this page — same
// division as Twitter, where "Add to Lists" lives on the profile.
// ─────────────────────────────────────────────────────────────
const POST_SELECT = '*, profile:profiles!posts_author_id_fkey(username,display_name,avatar_url)';

const listId = currentListId();
let list = null;       // the loaded list row
let isOwner = false;
let listTab = 'posts';   // 'posts' | 'members'
let listMembers = [];    // [{id, username, display_name, avatar_url}], loaded once

async function loadList() {
  const heroEl = document.getElementById('list-hero');
  if (!listId) {
    heroEl.innerHTML = `<div id="feed-empty">No List specified.</div>`;
    return;
  }

  const { data, error } = await sb.from('lists').select('*').eq('id', listId).maybeSingle();
  if (error) { heroEl.innerHTML = `<div class="errmsg">Failed to load List: ${esc(error.message)}</div>`; return; }
  if (!data) { heroEl.innerHTML = `<div id="feed-empty">This List doesn't exist, or is private.</div>`; return; }
  list = data;
  document.title = `${list.name} — Otakuchan`;

  isOwner = !!(currentSession && list.owner_id === currentSession.user.id);

  const { data: owner } = await sb.from('profiles').select('username,display_name').eq('id', list.owner_id).maybeSingle();
  list._owner = owner;

  renderHero();
  document.getElementById('board-hdr').style.display = '';
  await loadListMembers();
  renderTabContent();
}

function renderHero() {
  const heroEl = document.getElementById('list-hero');
  const privacyTag = list.is_private ? `<span class="list-privacy-tag">${ICON_LOCK}Private</span>` : '';
  const actions = isOwner ? `
    <div class="list-hero-actions">
      <button type="button" class="list-edit-btn" onclick="openCreateListModal(list)">Edit</button>
      <button type="button" class="list-delete-btn" onclick="deleteListConfirm(list.id, list.name)">Delete</button>
    </div>` : '';
  heroEl.innerHTML = `
    <div class="list-hero">
      <span class="list-avatar list-avatar-lg">${listAvatarInner(list)}</span>
      <div class="list-hero-body">
        <div class="list-hero-name">${esc(list.name)} ${privacyTag}</div>
        ${list._owner ? `<div class="list-hero-owner">by <a href="${profileUrl(list._owner.username)}">@${esc(list._owner.username)}</a></div>` : ''}
        ${list.description ? `<div class="list-hero-desc">${esc(list.description)}</div>` : ''}
        <div class="list-hero-meta">${fmtCount(list.member_count)} member${list.member_count === 1 ? '' : 's'}</div>
      </div>
      ${actions}
    </div>`;
}

// Called by submitList() in common.js after a successful edit, so
// this page's header reflects the change without a full reload.
function onListUpdated(id, changes) {
  if (!list || id !== list.id) return;
  Object.assign(list, changes);
  renderHero();
}

function switchListTab(tab) {
  if (tab === listTab) return;
  listTab = tab;
  document.getElementById('tab-posts').classList.toggle('active', tab === 'posts');
  document.getElementById('tab-members').classList.toggle('active', tab === 'members');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderTabContent();
}

async function loadListMembers() {
  const { data: memberRows, error } = await sb.from('list_members')
    .select('member_id, added_at').eq('list_id', list.id).order('added_at', { ascending: false });
  if (error) { listMembers = []; return; }
  const memberIds = (memberRows || []).map(r => r.member_id);
  if (!memberIds.length) { listMembers = []; return; }
  const { data: profiles } = await sb.from('profiles')
    .select('id,username,display_name,avatar_url').in('id', memberIds);
  const byId = new Map((profiles || []).map(p => [p.id, p]));
  listMembers = memberRows.map(r => byId.get(r.member_id)).filter(Boolean);
}

function renderTabContent() {
  if (listTab === 'posts') loadListFeed();
  else renderMembers();
}

async function loadListFeed() {
  const el = document.getElementById('list-content');
  el.innerHTML = skeletonFeedHtml();
  await ensureFeedPrereqsLoaded();

  if (!listMembers.length) {
    el.innerHTML = `<div id="feed-empty">No one's on this List yet. Add people from their profile's &ldquo;&middot;&middot;&middot;&rdquo; menu.</div>`;
    return;
  }

  const { data, error } = await sb.from('posts').select(POST_SELECT)
    .eq('is_deleted', false).in('author_id', listMembers.map(m => m.id))
    .order('created_at', { ascending: false }).limit(100);
  if (error) { el.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(error.message)}</div>`; return; }
  if (!data.length) {
    el.innerHTML = `<div id="feed-empty">No posts yet from anyone on this List.</div>`;
    return;
  }
  await attachQuotedPosts(data);
  el.innerHTML = data.map(p => postCardHtml(p)).join('');
}

function renderMembers() {
  const el = document.getElementById('list-content');
  if (!listMembers.length) {
    el.innerHTML = `<div id="feed-empty">No one's on this List yet. Add people from their profile's &ldquo;&middot;&middot;&middot;&rdquo; menu.</div>`;
    return;
  }
  el.innerHTML = `<div class="comm-list">` + listMembers.map(m => `
    <a class="who-row comm-row" href="${profileUrl(m.username)}">
      <img class="avatar" src="${esc(avatarUrl(m.avatar_url))}" alt="" loading="lazy" decoding="async">
      <span class="who-row-txt">
        <span class="who-row-name">${esc(m.display_name || m.username)}</span>
        <span class="who-row-handle">@${esc(m.username)}</span>
      </span>
      ${isOwner ? `<button type="button" class="list-member-remove" onclick="event.preventDefault();removeListMember('${m.id}', '${u_(m.username)}')">Remove</button>` : ''}
    </a>`).join('') + `</div>`;
}

async function removeListMember(memberId, username) {
  const uname = decodeURIComponent(username);
  const ok = await ocConfirm({
    title: `Remove @${uname} from this List?`,
    confirmLabel: 'Remove',
    danger: true
  });
  if (!ok) return;
  try {
    const { error } = await sb.from('list_members').delete().eq('list_id', list.id).eq('member_id', memberId);
    if (error) throw error;
    list.member_count = Math.max(0, list.member_count - 1);
    renderHero();
    listMembers = listMembers.filter(m => m.id !== memberId);
    renderMembers();
    toast(`Removed @${uname} from the List.`);
  } catch (e) {
    toast(e.message || 'Could not remove that member.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise isOwner/Edit-Delete can render before we know who's logged in
  loadList();
});
