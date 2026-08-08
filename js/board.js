// ─────────────────────────────────────────────────────────────
// BOARD PAGE — /index.html
// ─────────────────────────────────────────────────────────────
const POST_SELECT = '*, profile:profiles(username,display_name,avatar_url)';

let activeTab = 'foryou'; // 'foryou' | 'following'
let pendingPosts = [];    // realtime posts held back until "Show N posts" is clicked

async function loadFeed() {
  const feedEl = document.getElementById('feed-posts');
  feedEl.innerHTML = `<span class="spinner">Loading posts&hellip;</span>`;
  pendingPosts = [];
  hidePendingPill();
  await ensureBookmarksLoaded();

  let query = sb.from('posts').select(POST_SELECT).eq('is_deleted', false);

  if (activeTab === 'following') {
    if (!currentSession) {
      feedEl.innerHTML = `<div id="feed-empty">Log in and follow people to see their posts here.</div>`;
      return;
    }
    const { data: follows } = await sb.from('follows').select('followee_id').eq('follower_id', currentSession.user.id);
    const ids = (follows || []).map(f => f.followee_id);
    if (!ids.length) {
      feedEl.innerHTML = `<div id="feed-empty">You're not following anyone yet. Posts from people you follow will show up here.</div>`;
      return;
    }
    query = query.in('author_id', ids);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

  if (error) {
    feedEl.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    feedEl.innerHTML = `<div id="feed-empty">No posts yet. Be the first to post.</div>`;
    return;
  }
  feedEl.innerHTML = data.map(p => postCardHtml(p)).join('');
}

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  document.getElementById('tab-foryou').classList.toggle('active', tab === 'foryou');
  document.getElementById('tab-following').classList.toggle('active', tab === 'following');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadFeed();
}

// Adds a single post to the top of the feed, but only if it isn't
// already there. Both the "just posted it myself" path and the
// realtime subscription funnel through this, so a post can never
// be rendered twice no matter which one fires first.
function addPostToFeed(p, flash = false) {
  const feedEl = document.getElementById('feed-posts');
  if (!feedEl) return;
  if (document.getElementById(`post-${p.id}`)) return; // already on screen
  const empty = document.getElementById('feed-empty');
  if (empty) feedEl.innerHTML = '';
  feedEl.insertAdjacentHTML('afterbegin', postCardHtml(p, flash));
  const ctEl = document.getElementById('feed-ct');
  if (ctEl) ctEl.textContent = `(${feedEl.querySelectorAll('.pc').length})`;
}

// ── "SHOW N POSTS" PILL — Twitter doesn't insert other people's new
// posts into the feed under your nose; it queues them behind a pill
// at the top and lets you pull them in on click. ──
function showPendingPill() {
  const pill = document.getElementById('show-new-pill');
  if (!pill) return;
  pill.textContent = `Show ${pendingPosts.length} post${pendingPosts.length === 1 ? '' : 's'}`;
  pill.style.display = 'block';
}
function hidePendingPill() {
  const pill = document.getElementById('show-new-pill');
  if (pill) pill.style.display = 'none';
  pendingPosts = [];
}
function flushPendingPosts() {
  if (!pendingPosts.length) return;
  pendingPosts.slice().reverse().forEach(p => addPostToFeed(p, true));
  pendingPosts = [];
  hidePendingPill();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// postCardHtml() now lives in common.js (shared with profile.js).

// ── NEW POST (Twitter calls this "posting", never "starting a thread") ──
async function submitPost() {
  if (!requireLogin()) return;
  const bodyEl = document.getElementById('pf-body');
  const fileEl = document.getElementById('pf-file');
  const btn    = document.getElementById('pf-btn');
  const stEl   = document.getElementById('pf-st');
  const errEl  = document.getElementById('pf-err');
  clearErr(errEl);

  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, "Comment can't be empty."); return; }
  if (body.length > 4000) { showErr(errEl, 'Comment too long (max 4000 chars).'); return; }

  btn.disabled = true;
  stEl.textContent = 'Posting…';
  try {
    let media_url = null, media_type = null;
    const file = fileEl.files[0];
    if (file) {
      if (!validateFile(file, errEl)) { btn.disabled = false; stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading file…';
      ({ media_url, media_type } = await uploadMedia(file));
    }
    const { data, error } = await sb.from('posts').insert({
      author_id: currentSession.user.id,
      body,
      media_url,
      media_type
    }).select(POST_SELECT).single();
    if (error) throw error;
    bodyEl.value = '';
    bodyEl.style.height = '';
    fileEl.value = ''; document.getElementById('pf-fp').innerHTML = '';
    stEl.textContent = '';
    // Render it immediately — addPostToFeed() is dedup-safe, so if the
    // realtime INSERT event for this same row arrives a moment later
    // it will just no-op instead of adding a second copy.
    if (activeTab === 'foryou') addPostToFeed(data, true);
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post.');
    stEl.textContent = '';
  } finally {
    updatePostBtnState();
  }
}

function updatePostBtnState() {
  const bodyEl = document.getElementById('pf-body');
  const btn = document.getElementById('pf-btn');
  if (!bodyEl || !btn) return;
  btn.disabled = bodyEl.value.trim().length === 0;
}

// Fills in the composer's avatar once we know who's logged in
// (called by auth.js's refreshPostGates whenever session state settles).
function renderComposerAvatar() {
  const el = document.getElementById('pf-avatar');
  if (!el) return;
  const url = currentSession ? avatarUrl(currentProfile?.avatar_url) : DEFAULT_AVATAR;
  el.innerHTML = `<img src="${esc(url)}" alt="">`;
}

// ── TRENDING SIDEBAR — one list, ranked by overall engagement,
// top 3 only (likes weighted highest, then replies, then views). ──
async function loadTrending() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data } = await sb.from('posts').select(POST_SELECT)
    .eq('is_deleted', false).gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  const ranked = (data || [])
    .map(p => ({ ...p, _score: (p.like_count || 0) * 3 + (p.reply_count || 0) * 2 + (p.view_count || 0) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  document.getElementById('t-trending').innerHTML = trendListHtml(ranked);
}

function trendListHtml(list) {
  if (!list || !list.length) return `<div class="no-t">Nothing trending yet.</div>`;
  return list.map(p => `
    <a class="tcard" href="thread.html?id=${p.id}">
      <div class="ph">${authorHtml(p.profile)}<span class="dt">${timeAgo(p.created_at)}</span></div>
      <div class="tsnip">${renderBody((p.body || '').slice(0, 140))}</div>
      <div class="tmeta">&hearts; ${fmtCount(p.like_count)} &nbsp; &#9673; ${fmtCount(p.reply_count)} &nbsp; &#128065; ${fmtCount(p.view_count)}</div>
    </a>`).join('');
}

// ── REALTIME: new posts appear live, queued behind the pill above ──
function subscribeRealtime() {
  sb.channel('posts-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async payload => {
      const p = payload.new;
      if (p.is_deleted) return;
      if (document.getElementById(`post-${p.id}`)) return;
      if (activeTab !== 'foryou') return;
      p.profile = await getProfile(p.author_id);
      pendingPosts.push(p);
      showPendingPill();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, async payload => {
      const p = payload.new;
      const card = document.getElementById(`post-${p.id}`);
      if (card) {
        p.profile = await getProfile(p.author_id);
        card.outerHTML = postCardHtml(p);
      }
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', () => {
  loadFeed();
  loadTrending();
  subscribeRealtime();
  wireFilePreview('pf-file', 'pf-fp', 'pf-err');
  const pfBody = document.getElementById('pf-body');
  if (pfBody) {
    pfBody.addEventListener('input', () => {
      updatePostBtnState();
      pfBody.style.height = 'auto';
      pfBody.style.height = Math.max(56, pfBody.scrollHeight) + 'px';
    });
  }
  setInterval(loadTrending, 60000);
});
