// ─────────────────────────────────────────────────────────────
// COMMUNITY PAGE — /communities/<slug> (also reachable as the legacy
// community.html?slug=<slug> form — see currentCommunitySlug() in
// common.js). Shows the community's header (name, description,
// member count, Join/Leave), a composer scoped to it, and a
// Latest/Trending filter over just its own posts.
// ─────────────────────────────────────────────────────────────
const POST_SELECT = '*, profile:profiles!posts_author_id_fkey(username,display_name,avatar_url)';

const communitySlug = currentCommunitySlug();
let community = null;      // the loaded community row
let isMember = false;      // whether the current user has joined it
let communityTab = 'latest'; // 'latest' | 'trending'

async function loadCommunity() {
  const heroEl = document.getElementById('community-hero');
  if (!communitySlug) {
    heroEl.innerHTML = `<div id="feed-empty">No community specified.</div>`;
    return;
  }

  const { data, error } = await sb.from('communities').select('*').eq('slug', communitySlug).maybeSingle();
  if (error) { heroEl.innerHTML = `<div class="errmsg">Failed to load community: ${esc(error.message)}</div>`; return; }
  if (!data) { heroEl.innerHTML = `<div id="feed-empty">This community doesn't exist.</div>`; return; }
  community = data;
  document.title = `${community.name} — Otakuchan`;

  if (currentSession) {
    const { data: mem } = await sb.from('community_members').select('user_id')
      .eq('community_id', community.id).eq('user_id', currentSession.user.id).maybeSingle();
    isMember = !!mem;
  } else {
    isMember = false;
  }

  renderHero();
  document.getElementById('board-hdr').style.display = '';
  document.getElementById('pf-wrap').style.display = '';
  refreshPostGates();
  updateComposerVisibility();
  wireComposer();
  loadCommunityFeed();
}

// refreshPostGates() (auth.js) only knows anon vs logged-in — it
// can't know about membership, so this layers "logged in but hasn't
// joined" on top: the join-gate wins over the real composer whenever
// there's a session but no membership row for this community.
function updateComposerVisibility() {
  const pfBox = document.getElementById('pf-box');
  const joinGate = document.getElementById('cf-join-gate');
  if (!pfBox || !joinGate) return;
  if (currentSession && !isMember) {
    pfBox.style.display = 'none';
    joinGate.style.display = '';
  } else {
    joinGate.style.display = 'none';
    if (currentSession) pfBox.style.display = '';
  }
}

function renderHero() {
  const heroEl = document.getElementById('community-hero');
  const actionBtn = !currentSession
    ? `<a class="comm-join-btn" href="login.html">Join</a>`
    : isMember
      ? `<button type="button" class="comm-leave-btn" id="hero-join-btn" onclick="heroToggleJoin()">Joined</button>`
      : `<button type="button" class="comm-join-btn" id="hero-join-btn" onclick="heroToggleJoin()">Join</button>`;
  // Only the community's own creator can change its picture — same
  // "isOwner" idea as postMenuHtml's Delete button, just for the
  // community row itself instead of a post/reply row.
  const isCreator = currentSession && community.created_by === currentSession.user.id;
  const avatarInner = `
    <span class="comm-avatar comm-avatar-lg">${communityAvatarInner(community)}</span>
    ${isCreator ? `
      <label class="comm-avatar-pick" for="hero-avatar-file" title="Change community picture">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-2h6l2 2h3v12H4V7Z"/><circle cx="12" cy="13" r="3.5"/></svg>
      </label>
      <input type="file" id="hero-avatar-file" accept="image/*" style="display:none;" onchange="changeCommunityAvatar(this)">` : ''}`;

  heroEl.innerHTML = `
    <div class="community-hero">
      <span class="comm-avatar-wrap">${avatarInner}</span>
      <div class="community-hero-body">
        <div class="community-hero-name">${esc(community.name)}</div>
        ${community.description ? `<div class="community-hero-desc">${esc(community.description)}</div>` : ''}
        <div class="community-hero-meta">${fmtCount(community.member_count)} member${community.member_count === 1 ? '' : 's'} &nbsp;&middot;&nbsp; ${fmtCount(community.post_count)} post${community.post_count === 1 ? '' : 's'}</div>
      </div>
      <div class="community-hero-actions">${actionBtn}</div>
    </div>`;
}

// Only the creator ever sees the picker (see isCreator above), but the
// upload itself is still checked server-side too: `avatars` storage
// only allows writing inside your own <uid> folder, and the
// "creator can update own community" RLS policy only allows this
// UPDATE if auth.uid() = created_by (see
// supabase/community_creator_and_post_limit.sql).
async function changeCommunityAvatar(input) {
  const file = input.files[0];
  input.value = '';
  if (!file || !community || !currentSession) return;
  if (!requireLogin()) return;
  if (community.created_by !== currentSession.user.id) return;
  const errEl = document.getElementById('cf-err'); // reuse the composer's error slot if present
  if (!validateFile(file, errEl)) return;
  try {
    const avatar_url = await uploadAvatar(file, currentSession.user.id);
    const { error } = await sb.from('communities').update({ avatar_url }).eq('id', community.id);
    if (error) throw error;
    community.avatar_url = avatar_url;
    renderHero();
  } catch (e) {
    alert(e.message || 'Could not update the community picture.');
  }
}

async function heroToggleJoin() {
  if (!requireLogin()) return;
  const btn = document.getElementById('hero-join-btn');
  btn.disabled = true;
  try {
    const { error } = isMember ? await leaveCommunity(community.id) : await joinCommunity(community.id);
    if (error) throw error;
    isMember = !isMember;
    community.member_count = Math.max(0, community.member_count + (isMember ? 1 : -1));
    renderHero();
    refreshPostGates();
    updateComposerVisibility();
    wireComposer();
  } catch (e) {
    alert(e.message || 'Failed to update membership.');
    btn.disabled = false;
  }
}

// Called whenever the sidebar "My communities" box (common.js) or any
// other join/leave control changes membership for this community, so
// the hero button and post gate never go stale.
function onCommunityMembershipChanged(communityId, joined) {
  if (!community || communityId !== community.id) return;
  isMember = joined;
  community.member_count = Math.max(0, community.member_count + (joined ? 1 : -1));
  renderHero();
  updateComposerVisibility();
  wireComposer();
}

function switchCommunityTab(tab) {
  if (tab === communityTab) return;
  communityTab = tab;
  document.getElementById('tab-latest').classList.toggle('active', tab === 'latest');
  document.getElementById('tab-trending').classList.toggle('active', tab === 'trending');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadCommunityFeed();
}

async function loadCommunityFeed() {
  const feedEl = document.getElementById('feed-posts');
  feedEl.innerHTML = skeletonFeedHtml();
  await ensureFeedPrereqsLoaded();

  let query = sb.from('posts').select(POST_SELECT).eq('is_deleted', false).eq('community_id', community.id);
  query = communityTab === 'trending'
    ? query.order('like_count', { ascending: false }).order('created_at', { ascending: false }).limit(100)
    : query.order('created_at', { ascending: false }).limit(100);

  const { data, error } = await query;
  if (error) { feedEl.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(error.message)}</div>`; return; }
  if (!data.length) {
    feedEl.innerHTML = `<div id="feed-empty">${communityTab === 'trending' ? 'Nothing trending here yet.' : `No posts yet. Be the first to post in ${esc(community.name)}.`}</div>`;
    return;
  }
  await attachQuotedPosts(data);
  feedEl.innerHTML = data.map(p => postCardHtml(p)).join('');
}

// ── COMPOSER — same shape as board.js's submitPost(), minus poll/
// schedule (kept out to keep a community post the simple case), plus
// community_id set so it lands only in this community's feed. ──
async function submitCommunityPost() {
  if (!requireLogin()) return;
  if (!isMember) { alert('Join this community to post in it.'); return; }
  const bodyEl = document.getElementById('cf-body');
  const fileEl = document.getElementById('cf-file');
  const btn    = document.getElementById('cf-btn');
  const stEl   = document.getElementById('cf-st');
  const errEl  = document.getElementById('cf-err');
  clearErr(errEl);

  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, "Comment can't be empty."); return; }
  if (body.length > 500) { showErr(errEl, 'Comment too long (max 500 chars).'); return; }

  btn.disabled = true;
  stEl.textContent = 'Posting…';
  try {
    let media_url = null, media_type = null;
    const gifUrl = composeExtras.cf?.gifUrl;
    const file = fileEl.files[0];
    if (gifUrl) {
      media_url = gifUrl; media_type = 'gif';
    } else if (file) {
      if (!validateFile(file, errEl)) { btn.disabled = false; stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading file…';
      ({ media_url, media_type } = await uploadMedia(file));
    }
    const { data, error } = await sb.from('posts').insert({
      author_id: currentSession.user.id,
      body,
      media_url,
      media_type,
      community_id: community.id
    }).select(POST_SELECT).single();
    if (error) throw error;
    bodyEl.value = '';
    bodyEl.style.height = '';
    fileEl.value = ''; document.getElementById('cf-fp').innerHTML = '';
    resetComposeExtras('cf');
    stEl.textContent = '';
    community.post_count = (community.post_count || 0) + 1;
    renderHero();
    if (communityTab === 'latest') {
      const feedEl = document.getElementById('feed-posts');
      const empty = document.getElementById('feed-empty');
      if (empty) feedEl.innerHTML = '';
      feedEl.insertAdjacentHTML('afterbegin', postCardHtml(data, true));
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post.');
    stEl.textContent = '';
  } finally {
    updateCommunityPostBtnState();
  }
}

function updateCommunityPostBtnState() {
  const bodyEl = document.getElementById('cf-body');
  const btn = document.getElementById('cf-btn');
  if (!bodyEl || !btn) return;
  btn.disabled = bodyEl.value.trim().length === 0;
}

function renderComposerAvatar() {
  const el = document.getElementById('cf-avatar');
  if (!el) return;
  const url = currentSession ? avatarUrl(currentProfile?.avatar_url) : DEFAULT_AVATAR;
  el.innerHTML = `<img src="${esc(url)}" alt="">`;
}

let composerWired = false;
function wireComposer() {
  if (composerWired) return;
  composerWired = true;
  wireFilePreview('cf-file', 'cf-fp', 'cf-err');
  const cfBody = document.getElementById('cf-body');
  if (cfBody) {
    cfBody.addEventListener('input', () => {
      updateCommunityPostBtnState();
      cfBody.style.height = 'auto';
      cfBody.style.height = Math.max(56, cfBody.scrollHeight) + 'px';
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise the hero/composer can render before we know who's logged in
  loadCommunity();
});
