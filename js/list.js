// ─────────────────────────────────────────────────────────────
// SINGLE LIST PAGE — /i/lists/<uuid> (also reachable via the legacy
// list.html?id=<uuid> form — see currentListId() in common.js).
// Shows the list's header (name, description, member/follower count,
// Edit/Delete for the owner or a Follow/Following pill for anyone
// else on a public List), a Posts tab (a timeline merged from every
// member's posts, same idea as a community's feed), a Members tab
// (who's curated onto it, with a Remove button for the owner) and a
// Followers tab (who's following it). Both people-tabs show each
// row's own personal Follow button too (follow the person, not the
// List — see listPersonRowHtml()), same as Twitter's List sub-pages.
// Adding someone to a list as a *member* happens from *their*
// profile's "···" menu (openAddToListModal() in common.js), not from
// this page — same division as Twitter, where "Add to Lists" lives
// on the profile. Following the List itself happens right here.
// ─────────────────────────────────────────────────────────────
const POST_SELECT = '*, profile:profiles!posts_author_id_fkey(username,display_name,avatar_url,verified)';

const listId = currentListId();
let list = null;       // the loaded list row
let isOwner = false;
let isFollowing = false; // is the viewer following this List (non-owner only)
let listTab = 'posts';   // 'posts' | 'members' | 'followers'
let listMembers = [];    // [{id, username, display_name, avatar_url}], loaded once
let listFollowers = [];  // same shape, loaded lazily on first visit to the Followers tab
let listMyFollowing = new Set(); // ids of people the *viewer* personally follows — drives each row's own Follow button

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
  document.title = `${list.name} — InteractInk`;
  setPageH1(list.name);
  setPageDescription(list.description || `${list.name} — a List on InteractInk.`);
  setCanonical(listUrl(list.id));
  setJsonLd({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: list.name, description: list.description || undefined,
    url: location.origin + listUrl(list.id),
  });

  isOwner = !!(currentSession && list.owner_id === currentSession.user.id);
  if (currentSession && !isOwner) {
    const { data: fRow } = await sb.from('list_followers')
      .select('list_id').eq('list_id', list.id).eq('follower_id', currentSession.user.id).maybeSingle();
    isFollowing = !!fRow;
  }

  const { data: owner } = await sb.from('profiles').select('username,display_name').eq('id', list.owner_id).maybeSingle();
  list._owner = owner;

  renderHero();
  document.getElementById('board-hdr').style.display = '';
  await Promise.all([loadListMembers(), loadListMyFollowing()]);
  renderTabContent();
}

// The viewer's own personal follows (not List-follows) — drives the
// per-row Follow button on the Members/Followers tabs, same as
// followlist.js's flLoadMyFollowing().
async function loadListMyFollowing() {
  listMyFollowing = new Set();
  if (!currentSession) return;
  const { data } = await sb.from('follows').select('followee_id').eq('follower_id', currentSession.user.id);
  listMyFollowing = new Set((data || []).map(r => r.followee_id));
}

function renderHero() {
  const heroEl = document.getElementById('list-hero');
  const privacyTag = list.is_private ? `<span class="list-privacy-tag">${ICON_LOCK}Private</span>` : '';
  const actions = isOwner ? `
    <div class="list-hero-actions">
      <button type="button" class="list-edit-btn" onclick="openCreateListModal(list)">Edit</button>
      <button type="button" class="list-delete-btn" onclick="deleteListConfirm(list.id, list.name)">Delete</button>
    </div>`
    : (currentSession && !list.is_private) ? `
    <div class="list-hero-actions">
      <button type="button" class="${isFollowing ? 'list-following-pill' : 'list-follow-pill'}" onclick="listToggleFollow('${list.id}', this, ${isFollowing})">${isFollowing ? 'Following' : 'Follow'}</button>
    </div>` : '';
  const bannerPick = isOwner ? `
    <label class="list-banner-pick" for="list-banner-file" title="Change List banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-2h6l2 2h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/></svg>
    </label>
    <input type="file" id="list-banner-file" accept="image/*" style="display:none;" onchange="changeListBanner(this)">` : '';
  const avatarPick = isOwner ? `
    <label class="list-avatar-pick" for="list-avatar-file" title="Change List picture">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-2h6l2 2h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/></svg>
    </label>
    <input type="file" id="list-avatar-file" accept="image/*" style="display:none;" onchange="changeListAvatar(this)">` : '';

  heroEl.innerHTML = `
    <div class="list-banner-wrap" id="list-banner-wrap" style="${list.banner_url ? `--banner-img:url('${esc(list.banner_url)}')` : ''}">
      ${bannerPick}
    </div>
    <div class="list-hero">
      <span class="list-avatar-wrap">
        <span class="list-avatar list-avatar-lg">${listAvatarInner(list)}</span>
        ${avatarPick}
      </span>
      <div class="list-hero-body">
        <div class="list-hero-name">${esc(list.name)} ${privacyTag}</div>
        ${list._owner ? `<div class="list-hero-owner">by <a href="${profileUrl(list._owner.username)}">@${esc(list._owner.username)}</a></div>` : ''}
        ${list.description ? `<div class="list-hero-desc">${esc(list.description)}</div>` : ''}
        <div class="list-hero-meta">${fmtCount(list.member_count)} member${list.member_count === 1 ? '' : 's'} &middot; ${fmtCount(list.follower_count || 0)} follower${(list.follower_count || 0) === 1 ? '' : 's'}</div>
      </div>
      ${actions}
    </div>`;
}

// Called by listToggleFollow() (common.js) after a follow/unfollow of
// this List completes — keeps the hero's follower count and pill in
// sync without a full reload.
function onListFollowChanged(id, following) {
  if (!list || id !== list.id) return;
  isFollowing = following;
  list.follower_count = Math.max(0, (list.follower_count || 0) + (following ? 1 : -1));
  renderHero();
  if (listTab === 'followers') loadListFollowers().then(renderFollowers);
}

// Owner-only, same pattern as changeCommunityAvatar/Banner: crop
// first, then upload straight to `avatars` storage (still scoped to
// the acting user's own <uid> folder — see uploadAvatar()) and
// update the row. RLS's "owner can update their own list" policy is
// what actually enforces this server-side.
async function changeListAvatar(input) {
  const file = input.files[0];
  input.value = '';
  if (!file || !list || !currentSession) return;
  if (!requireLogin()) return;
  if (list.owner_id !== currentSession.user.id) return;
  if (!validateFile(file)) return;
  openCropModal(file, 'square', async (cropped) => {
    try {
      const avatar_url = await uploadAvatar(cropped, currentSession.user.id);
      const { error } = await sb.from('lists').update({ avatar_url }).eq('id', list.id);
      if (error) throw error;
      list.avatar_url = avatar_url;
      renderHero();
    } catch (e) {
      toast(e.message || 'Could not update the List picture.', 'error');
    }
  });
}

async function changeListBanner(input) {
  const file = input.files[0];
  input.value = '';
  if (!file || !list || !currentSession) return;
  if (!requireLogin()) return;
  if (list.owner_id !== currentSession.user.id) return;
  if (!validateFile(file)) return;
  openCropModal(file, 'wide', async (cropped) => {
    try {
      const banner_url = await uploadAvatar(cropped, currentSession.user.id);
      const { error } = await sb.from('lists').update({ banner_url }).eq('id', list.id);
      if (error) throw error;
      list.banner_url = banner_url;
      renderHero();
    } catch (e) {
      toast(e.message || 'Could not update the List banner.', 'error');
    }
  });
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
  document.getElementById('tab-followers').classList.toggle('active', tab === 'followers');
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
    .select('id,username,display_name,avatar_url,verified').in('id', memberIds);
  const byId = new Map((profiles || []).map(p => [p.id, p]));
  listMembers = memberRows.map(r => byId.get(r.member_id)).filter(Boolean);
}

function renderTabContent() {
  if (listTab === 'posts') loadListFeed();
  else if (listTab === 'followers') { loadListFollowers().then(renderFollowers); document.getElementById('list-content').innerHTML = skeletonFeedHtml(); }
  else renderMembers();
}

async function loadListFollowers() {
  const { data: rows, error } = await sb.from('list_followers')
    .select('follower_id, followed_at').eq('list_id', list.id).order('followed_at', { ascending: false });
  if (error) { listFollowers = []; return; }
  const ids = (rows || []).map(r => r.follower_id);
  if (!ids.length) { listFollowers = []; return; }
  const { data: profiles } = await sb.from('profiles')
    .select('id,username,display_name,avatar_url,verified').in('id', ids);
  const byId = new Map((profiles || []).map(p => [p.id, p]));
  listFollowers = rows.map(r => byId.get(r.follower_id)).filter(Boolean);
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

// Shared row for both the Members and Followers tabs — a person's
// avatar/name/handle plus their OWN personal Follow button (follow
// that person, not the List — see followlist.js's near-identical
// flRowHtml()), and optionally a Remove button for the List owner.
function listPersonRowHtml(profile, removable) {
  const uname = profile?.username || 'unknown';
  const viewerIsThem = currentSession && profile.id === currentSession.user.id;
  const following = listMyFollowing.has(profile.id);
  const locked = following && isProtectedFollowUsername(uname);
  const followBtn = (!currentSession || viewerIsThem) ? '' : locked
    ? `<button class="follow-btn following locked" disabled title="You can't unfollow this account." aria-label="You can't unfollow this account.">${ICON_LOCK_SM}${t('action.following')}</button>`
    : `<button class="follow-btn${following ? ' following' : ''}" onclick="listPersonToggleFollow('${profile.id}', this)">${following ? t('action.following') : t('action.follow')}</button>`;
  const removeBtn = removable
    ? `<button type="button" class="list-member-remove" onclick="event.preventDefault();removeListMember('${profile.id}', '${u_(uname)}')">Remove</button>`
    : '';
  return `
  <div class="fl-row">
    <a class="ulrow" style="flex:1;min-width:0;" href="${profileUrl(uname)}">
      <img class="avatar pfp-md" src="${esc(avatarUrl(profile?.avatar_url))}" alt="" loading="lazy" decoding="async">
      <div class="ulrow-txt">
        <span class="ulrow-name">${esc(profile?.display_name || uname)}${vBadge(profile)}</span>
        <span class="ulrow-handle">@${esc(uname)}</span>
      </div>
    </a>
    ${followBtn}
    ${removeBtn}
  </div>`;
}

async function listPersonToggleFollow(userId, btn) {
  if (!requireLogin()) return;
  const following = btn.classList.contains('following');
  btn.disabled = true;
  try {
    const { error } = following ? await unfollowUser(userId) : await followUser(userId);
    if (error) throw error;
    if (following) { listMyFollowing.delete(userId); btn.classList.remove('following'); btn.textContent = t('action.follow'); }
    else { listMyFollowing.add(userId); btn.classList.add('following'); btn.textContent = t('action.following'); }
  } catch (e) {
    toast(e.message || 'Could not update follow status.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderMembers() {
  const el = document.getElementById('list-content');
  if (!listMembers.length) {
    el.innerHTML = `<div id="feed-empty">No one's on this List yet. Add people from their profile's &ldquo;&middot;&middot;&middot;&rdquo; menu.</div>`;
    return;
  }
  el.innerHTML = listMembers.map(m => listPersonRowHtml(m, isOwner)).join('');
}

function renderFollowers() {
  const el = document.getElementById('list-content');
  if (!listFollowers.length) {
    el.innerHTML = `<div id="feed-empty">No one's following this List yet.</div>`;
    return;
  }
  el.innerHTML = listFollowers.map(f => listPersonRowHtml(f, false)).join('');
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
