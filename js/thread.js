// ─────────────────────────────────────────────────────────────
// THREAD PAGE — /<username>/status/<post_id>  (also reachable as
// /i/status/<post_id> before we know the author, or the legacy
// thread.html?id=<post_id> form — see currentStatusId() in
// common.js). Comments can reply to the post OR to another comment —
// both directions work, same as Twitter replies.
// ─────────────────────────────────────────────────────────────
const postId = currentStatusId();

const POST_SELECT   = '*, profile:profiles(username,display_name,avatar_url)';
const REPLY_SELECT  = '*, profile:profiles(username,display_name,avatar_url)';

let allReplies = []; // flat list, kept around so inline "reply to this comment" forms can insert without a refetch

async function loadThread() {
  const wrap = document.getElementById('thread-root');
  if (!postId) { wrap.innerHTML = `<div class="errmsg">No post specified.</div>`; return; }
  wrap.innerHTML = skeletonThreadHtml();

  await ensureBookmarksLoaded();
  await ensureRepostsLoaded();
  const { data: p, error } = await sb.from('posts').select(POST_SELECT).eq('id', postId).eq('is_deleted', false).single();
  if (error || !p) {
    wrap.innerHTML = `<div class="errmsg">Post not found or has been removed.</div>`;
    return;
  }
  cachePost(p);
  await attachQuotedPosts([p]);
  document.title = (p.body ? p.body.slice(0, 60) : 'Post') + ' — Otakuchan';
  // Now that we know who posted it, upgrade a generic /i/status/<id>
  // (or a legacy ?id= link) to the canonical /<username>/status/<id>
  // address, same as x.com does — no reload, just a clean URL bar.
  if (p.profile?.username) {
    const canonical = prettyPostUrl(p);
    if (location.pathname + location.search !== canonical) { try { history.replaceState(null, '', canonical); } catch (e) {} }
  }

  const { data: replies } = await sb.from('replies').select(REPLY_SELECT)
    .eq('post_id', postId).eq('is_deleted', false)
    .order('created_at', { ascending: true });

  allReplies = replies || [];

  wrap.innerHTML = `
    <div class="op-detail" id="op-post">
      <div class="op-detail-head">
        ${pcAvatarHtml(p.profile)}
        <div class="op-detail-names">
          <a class="nm" href="${profileUrl(p.profile?.username || 'unknown')}">${esc(p.profile?.display_name || p.profile?.username || 'unknown')}</a>
          <span class="pc-handle">@${esc(p.profile?.username || 'unknown')}</span>
        </div>
        ${postMenuHtml(p.id, null, p.author_id)}
      </div>
      <div class="op-detail-body">${renderBody(p.body)}</div>
      ${p.quote_of ? quotedPostHtml(p.quoted) : ''}
      ${renderMedia(p.media_url, p.media_type)}
      ${pollHtml(p)}
      <div class="op-detail-meta">${fullDateTime(p.created_at)} &middot; <b>${fmtCount(p.view_count)}</b> Views</div>
      <div class="op-detail-divider"></div>
      ${opDetailActionsHtml(p, "document.getElementById('rf-body')?.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('rf-body')?.focus();")}
      <div class="op-detail-divider"></div>
      <div class="op-relevant">
        <button type="button" class="op-relevant-btn" onclick="return false;"><span>Relevant</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        <a href="#" id="op-quotes-toggle" hidden onclick="toggleQuotesList(event)">View quotes &rsaquo;</a>
      </div>
      <div class="op-quotes-list" id="op-quotes-list" hidden></div>
    </div>
    <div class="rfm" data-requires-auth style="display:none;">
      <span class="pf-avatar" id="rf-avatar"></span>
      <div class="rfm-col">
        <div class="errmsg" id="rf-err" style="display:none;"></div>
        <textarea id="rf-body" placeholder="Post your reply" rows="1"></textarea>
        <div id="rf-fp" class="fp"></div>
        <div class="rfm-row">
          <button type="button" class="pf-ic" title="Media" onclick="document.getElementById('rf-file').click();return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="1.6"/><path d="m4 17 5-5 3.5 3.5L17 11l3 3"/></svg>
          </button>
          <button type="button" class="pf-ic" title="GIF" onclick="openGifPicker('rf');return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 9.5v5M13.5 9.5h-2.2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1H13v-2h-1M16 14.5v-5h2.4M16 12h1.8"/></svg>
          </button>
          <button type="button" class="pf-ic" title="Emoji" onclick="toggleEmojiPicker('rf', this);return false;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8 14.5c1 1.2 2.3 1.8 4 1.8s3-.6 4-1.8"/></svg>
          </button>
          <input type="file" id="rf-file" accept="image/*,video/*" style="display:none;">
          <span id="rf-st" style="font-size:11px;color:var(--muted);"></span>
          <input type="submit" id="rf-btn" class="pf-btn" value="Reply" onclick="submitReply();return false;">
        </div>
      </div>
    </div>
    <div class="post-login-gate" data-requires-anon style="display:none;">
      You need an account to reply. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.
    </div>
    <div class="rw" id="replies-list">
      ${renderReplyTree()}
    </div>`;

  wireFilePreview('rf-file', 'rf-fp', 'rf-err');
  refreshPostGates();
  loadQuoteCount(p.id);

  const rfBody = document.getElementById('rf-body');
  if (rfBody) {
    rfBody.addEventListener('input', () => {
      rfBody.style.height = 'auto';
      rfBody.style.height = Math.max(40, rfBody.scrollHeight) + 'px';
    });
  }

  // The OP itself counts as viewed the moment its thread is opened
  // (see common.js — this still respects the once-per-session dedup,
  // so it won't double-count if it was already counted by scrolling
  // past it in a feed). Replies are counted individually as each one
  // actually scrolls into view — see the data-view attribute on the
  // .rc card above and the shared observer in common.js — rather than
  // all being bumped at once just because the thread loaded.
  bumpPostView(p.id);
}

// Fills in the reply composer's avatar once we know who's logged in
// (called by auth.js's refreshPostGates whenever session state settles).
function renderComposerAvatar() {
  const el = document.getElementById('rf-avatar');
  if (!el) return;
  const url = currentSession ? avatarUrl(currentProfile?.avatar_url) : DEFAULT_AVATAR;
  el.innerHTML = `<img src="${esc(url)}" alt="">`;
}

// Shows the "View quotes ›" link only when at least one exists — same
// as Twitter hides it entirely on a post nobody's quoted. Wrapped in
// try/catch since quote_of only exists once quotes_and_reposts.sql
// has been run (see attachQuotedPosts() above for the same reasoning).
async function loadQuoteCount(id) {
  try {
    const { count } = await sb.from('posts').select('id', { count: 'exact', head: true })
      .eq('quote_of', id).eq('is_deleted', false);
    const link = document.getElementById('op-quotes-toggle');
    if (link && count) link.hidden = false;
  } catch (e) { /* quotes_and_reposts.sql not run yet — leave it hidden */ }
}

// Lazily fetches and toggles the list of posts quoting this one,
// inline under the "View quotes ›" row — reuses postCardHtml() so a
// quote in the list behaves exactly like any other post card.
async function toggleQuotesList(ev) {
  ev.preventDefault();
  const box = document.getElementById('op-quotes-list');
  if (!box) return;
  const willOpen = box.hidden;
  if (willOpen && !box.dataset.loaded) {
    box.hidden = false;
    box.innerHTML = `<span class="spinner">Loading&hellip;</span>`;
    try {
      const { data } = await sb.from('posts').select(POST_SELECT)
        .eq('quote_of', postId).eq('is_deleted', false)
        .order('created_at', { ascending: false });
      await attachQuotedPosts(data || []);
      box.innerHTML = (data && data.length) ? data.map(qp => postCardHtml(qp)).join('') : '<div class="no-t">No quotes yet.</div>';
    } catch (e) {
      box.innerHTML = `<div class="errmsg">Could not load quotes.</div>`;
    }
    box.dataset.loaded = '1';
    return;
  }
  box.hidden = !willOpen;
}

// Builds the nested tree (top-level replies to the post, each with
// its own children replying to it) out of the flat `allReplies` list.
function renderReplyTree() {
  if (!allReplies.length) return '<div class="no-t">No replies yet. Be the first to reply.</div>';
  const topLevel = allReplies.filter(r => !r.parent_reply_id);
  return topLevel.map(r => replyHtml(r, 0)).join('') || '<div class="no-t">No replies yet. Be the first to reply.</div>';
}

function childrenOf(replyId) {
  return allReplies.filter(r => r.parent_reply_id === replyId);
}

function replyHtml(r, depth) {
  const kids = childrenOf(r.id);
  const parent = r.parent_reply_id ? allReplies.find(x => x.id === r.parent_reply_id) : null;
  return `
  <div class="rc${kids.length ? ' has-children' : ''}" id="reply-${r.id}" data-view="reply:${r.id}">
    <div class="pc-row">
      ${pcAvatarHtml(r.profile)}
      <div class="pc-main">
        ${parent ? `<div class="rc-reply-tag">Replying to ${pcNameHtml(parent.profile)}</div>` : ''}
        <div class="ph">
          ${pcNameHtml(r.profile)}
          <span class="dt">${timeAgo(r.created_at)}</span>
          ${postMenuHtml(postId, r.id, r.author_id)}
        </div>
        <div class="pb">${renderBody(r.body)}</div>
        ${renderMedia(r.media_url, r.media_type)}
        ${postActionsHtml(r, { replyOnclick: `toggleReplyBox('${r.id}')`, replyCount: kids.length, bookmarkable: false, repostable: false })}
      </div>
    </div>
  </div>
  <div class="rc-inline-compose" id="rf-inline-${r.id}" data-requires-auth style="display:none;">
    <div class="rc-parent-tag">Replying to ${pcNameHtml(r.profile)}</div>
    <textarea id="rf-inline-body-${r.id}" placeholder="Post your reply"></textarea>
    <input type="file" id="rf-inline-file-${r.id}" accept="image/*,video/*">
    <div id="rf-inline-fp-${r.id}" class="fp"></div>
    <div class="rfm-row">
      <input type="submit" value="Reply" onclick="submitReply('${r.id}');return false;">
      <span id="rf-inline-st-${r.id}" style="font-size:11px;color:var(--muted);"></span>
    </div>
  </div>
  <div class="rc-children" id="rc-children-${r.id}">
    ${kids.map(k => replyHtml(k, depth + 1)).join('')}
  </div>`;
}

// Toggles the small inline "reply to this comment" composer under a
// given reply. Only one is kept open at a time, mirroring the main
// reply box's collapse behaviour.
function toggleReplyBox(replyId) {
  if (!requireLogin()) return;
  const box = document.getElementById(`rf-inline-${replyId}`);
  if (!box) return;
  const willOpen = !box.classList.contains('open');
  document.querySelectorAll('.rc-inline-compose.open').forEach(b => b.classList.remove('open'));
  if (willOpen) {
    box.classList.add('open');
    if (!box.dataset.wired) {
      wireFilePreview(`rf-inline-file-${replyId}`, `rf-inline-fp-${replyId}`, null);
      box.dataset.wired = '1';
    }
    box.querySelector('textarea')?.focus();
  }
}

async function submitReply(parentReplyId = null) {
  if (!requireLogin()) return;
  const suffix   = parentReplyId ? `-${parentReplyId}` : '';
  const bodyEl   = parentReplyId ? document.getElementById(`rf-inline-body-${parentReplyId}`) : document.getElementById('rf-body');
  const fileEl   = parentReplyId ? document.getElementById(`rf-inline-file-${parentReplyId}`) : document.getElementById('rf-file');
  const btn      = parentReplyId ? document.querySelector(`#rf-inline-${parentReplyId} input[type=submit]`) : document.getElementById('rf-btn');
  const stEl     = parentReplyId ? document.getElementById(`rf-inline-st-${parentReplyId}`) : document.getElementById('rf-st');
  const fpEl     = parentReplyId ? document.getElementById(`rf-inline-fp-${parentReplyId}`) : document.getElementById('rf-fp');
  const errEl    = parentReplyId ? null : document.getElementById('rf-err');
  if (errEl) clearErr(errEl);

  const body = (bodyEl?.value || '').trim();
  if (!body) { showErr(errEl, 'Reply cannot be empty.'); return; }
  if (body.length > 4000) { showErr(errEl, 'Reply too long (max 4000 chars).'); return; }

  btn.disabled = true;
  stEl.textContent = 'Posting…';
  try {
    let media_url = null, media_type = null;
    const gifUrl = !parentReplyId ? composeExtras.rf?.gifUrl : null;
    const file = fileEl?.files[0];
    if (gifUrl) {
      media_url = gifUrl; media_type = 'gif';
    } else if (file) {
      if (!validateFile(file, errEl)) { btn.disabled = false; stEl.textContent = ''; return; }
      stEl.textContent = 'Uploading file…';
      ({ media_url, media_type } = await uploadMedia(file));
    }
    const { data, error } = await sb.from('replies').insert({
      post_id: postId,
      parent_reply_id: parentReplyId,
      author_id: currentSession.user.id,
      body,
      media_url,
      media_type
    }).select(REPLY_SELECT).single();
    if (error) throw error;
    bodyEl.value = ''; if (fileEl) fileEl.value = '';
    if (fpEl) fpEl.innerHTML = '';
    if (!parentReplyId) resetComposeExtras('rf');
    stEl.textContent = '';
    insertReplyIntoTree(data);
    if (parentReplyId) {
      document.getElementById(`rf-inline-${parentReplyId}`)?.classList.remove('open');
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post reply.');
    stEl.textContent = '';
  } finally {
    btn.disabled = false;
  }
}

// Inserts a newly-created reply into both the in-memory tree and the
// DOM, without needing to refetch/re-render everything.
function insertReplyIntoTree(r) {
  if (allReplies.some(x => x.id === r.id)) return; // already there (e.g. our own realtime echo)
  allReplies.push(r);

  const list = document.getElementById('replies-list');
  const emptyMsg = list.querySelector('.no-t');
  if (emptyMsg) emptyMsg.remove();

  const html = replyHtml(r, 0);
  if (r.parent_reply_id) {
    const container = document.getElementById(`rc-children-${r.parent_reply_id}`);
    if (container) { container.insertAdjacentHTML('beforeend', html); return; }
  }
  list.insertAdjacentHTML('beforeend', html);
}

function subscribeRealtime() {
  sb.channel(`thread-${postId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies', filter: `post_id=eq.${postId}` }, async payload => {
      if (document.getElementById(`reply-${payload.new.id}`)) return;
      const r = payload.new;
      r.profile = await getProfile(r.author_id);
      insertReplyIntoTree(r);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts', filter: `id=eq.${postId}` }, payload => {
      const lc = document.querySelector('#op-post .lc');
      if (lc) lc.textContent = payload.new.like_count;
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise cards can render before we know who's logged in
  await loadThread();
  if (postId) subscribeRealtime();
});
