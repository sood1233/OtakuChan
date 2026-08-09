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
  await ensureRepostsLoaded();

  let query = sb.from('posts').select(POST_SELECT).eq('is_deleted', false);

  // "Following" also pulls in reposts made by people you follow —
  // same as Twitter's home timeline — each carrying a "[Name]
  // reposted" banner and slotting in at repost time, not post time.
  //
  // Reposts are fetched as plain reposts-row + posts-by-id + profiles-
  // by-id lookups, never as a `reposts.select('post:posts(...)')`
  // embed — `reposts` and its foreign keys are recent additions, and
  // an embed that PostgREST's schema cache hasn't picked up yet fails
  // its *entire* query, not just the repost part (see the comment
  // above attachQuotedPosts() in common.js for the same reasoning
  // applied to quote_of).
  let combined = null;

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

    const [ownRes, repostRowsRes] = await Promise.all([
      query.order('created_at', { ascending: false }).limit(100),
      sb.from('reposts').select('post_id, user_id, created_at')
        .in('user_id', ids)
        .order('created_at', { ascending: false }).limit(100)
    ]);

    if (ownRes.error) {
      feedEl.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(ownRes.error.message)}</div>`;
      return;
    }

    const ownPosts = (ownRes.data || []).map(p => ({ ...p, _sortTime: p.created_at }));

    let repostedPosts = [];
    const repostRows = repostRowsRes.data || [];
    if (repostRowsRes.error) console.warn('reposts lookup failed', repostRowsRes.error);
    if (repostRows.length) {
      const postIds = [...new Set(repostRows.map(r => r.post_id))];
      const reposterIds = [...new Set(repostRows.map(r => r.user_id))];
      const [{ data: repostedPostRows, error: postsErr }, { data: reposterProfiles, error: profErr }] = await Promise.all([
        sb.from('posts').select(POST_SELECT).in('id', postIds).eq('is_deleted', false),
        sb.from('profiles').select('id,username,display_name').in('id', reposterIds)
      ]);
      if (postsErr) console.warn('reposted posts lookup failed', postsErr);
      if (profErr) console.warn('reposter profiles lookup failed', profErr);
      const postById = new Map((repostedPostRows || []).map(p => [p.id, p]));
      const profById = new Map((reposterProfiles || []).map(p => [p.id, p]));
      repostedPosts = repostRows
        .map(r => {
          const p = postById.get(r.post_id);
          const reposter = profById.get(r.user_id);
          return (p && reposter) ? { ...p, _sortTime: r.created_at, _repostedBy: reposter } : null;
        })
        .filter(Boolean);
    }

    combined = [...ownPosts, ...repostedPosts]
      .sort((a, b) => new Date(b._sortTime) - new Date(a._sortTime))
      .slice(0, 100);
  }

  const { data, error } = combined ? { data: combined, error: null }
    : await query.order('created_at', { ascending: false }).limit(100);

  if (error) {
    feedEl.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    feedEl.innerHTML = `<div id="feed-empty">No posts yet. Be the first to post.</div>`;
    return;
  }
  await attachQuotedPosts(data);
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
  if (!validatePollAndSchedule('pf', errEl)) return;

  btn.disabled = true;
  stEl.textContent = 'Posting…';
  try {
    let media_url = null, media_type = null;
    const gifUrl = composeExtras.pf?.gifUrl;
    const file = fileEl.files[0];
    if (gifUrl) {
      media_url = gifUrl; media_type = 'gif';
    } else if (file) {
      if (!validateFile(file, errEl)) { btn.disabled = false; stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading file…';
      ({ media_url, media_type } = await uploadMedia(file));
    }
    const poll = collectPoll('pf');
    const scheduled_at = collectSchedule('pf');
    const { data, error } = await sb.from('posts').insert({
      author_id: currentSession.user.id,
      body,
      media_url,
      media_type,
      poll_options: poll?.poll_options || null,
      poll_ends_at: poll?.poll_ends_at || null,
      scheduled_at
    }).select(POST_SELECT).single();
    if (error) throw error;
    bodyEl.value = '';
    bodyEl.style.height = '';
    fileEl.value = ''; document.getElementById('pf-fp').innerHTML = '';
    resetComposeExtras('pf');
    stEl.textContent = '';
    // Render it immediately — addPostToFeed() is dedup-safe, so if the
    // realtime INSERT event for this same row arrives a moment later
    // it will just no-op instead of adding a second copy. A scheduled
    // post isn't published yet (RLS hides it from everyone but its
    // author until scheduled_at passes), so it doesn't belong in the
    // live feed — just confirm it was queued.
    if (scheduled_at) {
      alert(`Post scheduled for ${new Date(scheduled_at).toLocaleString()}.`);
    } else if (activeTab === 'foryou') {
      addPostToFeed(data, true);
    }
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
      await attachQuotedPosts([p]);
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

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise cards can render before we know who's logged in
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
