// ─────────────────────────────────────────────────────────────
// THREAD PAGE — /thread.html?id=<post_id>
// Comments can reply to the post OR to another comment — both
// directions work, same as Twitter replies.
// ─────────────────────────────────────────────────────────────
const postId = new URLSearchParams(location.search).get('id');

const POST_SELECT   = '*, profile:profiles(username,display_name,avatar_url)';
const REPLY_SELECT  = '*, profile:profiles(username,display_name,avatar_url)';

let allReplies = []; // flat list, kept around so inline "reply to this comment" forms can insert without a refetch

async function loadThread() {
  const wrap = document.getElementById('thread-root');
  if (!postId) { wrap.innerHTML = `<div class="errmsg">No post specified.</div>`; return; }

  const { data: p, error } = await sb.from('posts').select(POST_SELECT).eq('id', postId).eq('is_deleted', false).single();
  if (error || !p) {
    wrap.innerHTML = `<div class="errmsg">Post not found or has been removed.</div>`;
    return;
  }
  document.title = (p.body ? p.body.slice(0, 60) : 'Post') + ' — Otakuchan';

  const { data: replies } = await sb.from('replies').select(REPLY_SELECT)
    .eq('post_id', postId).eq('is_deleted', false)
    .order('created_at', { ascending: true });

  allReplies = replies || [];

  wrap.innerHTML = `
    <div class="pc" id="op-post">
      <div class="pc-row">
        ${pcAvatarHtml(p.profile)}
        <div class="pc-main">
          <div class="ph">
            ${pcNameHtml(p.profile)}
            <span class="dt">${timeAgo(p.created_at)}</span>
            ${postMenuHtml(p.id)}
          </div>
          <div class="pb">${renderBody(p.body)}</div>
          ${renderMedia(p.media_url, p.media_type)}
          ${postActionsHtml(p, { replyOnclick: "document.getElementById('rf-body')?.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('rf-body')?.focus();", replyCount: allReplies.length })}
        </div>
      </div>
    </div>
    <div class="rw" id="replies-list">
      ${renderReplyTree()}
    </div>
    <div class="rfm" data-requires-auth style="display:none;">
      <b>Post a Reply</b>
      <div class="errmsg" id="rf-err" style="display:none;"></div>
      <textarea id="rf-body" placeholder="Write a reply… lines starting with &gt; become greentext."></textarea>
      <input type="file" id="rf-file" accept="image/*,video/*">
      <div id="rf-fp" class="fp"></div>
      <div class="rfm-row">
        <input type="submit" id="rf-btn" value="Post Reply" onclick="submitReply();return false;">
        <span id="rf-st" style="font-size:11px;color:var(--muted);"></span>
      </div>
    </div>
    <div class="post-login-gate" data-requires-anon style="display:none;">
      You need an account to reply. <a href="login.html">Log in</a> or <a href="signup.html">sign up</a>.
    </div>`;

  wireFilePreview('rf-file', 'rf-fp', 'rf-err');
  refreshPostGates();

  // Bump view counts — once per session per post/reply (see common.js).
  bumpPostView(p.id);
  if (allReplies.length) bumpReplyViews(allReplies.map(r => r.id));
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
  return `
  <div class="rc" id="reply-${r.id}">
    <div class="pc-row">
      ${pcAvatarHtml(r.profile)}
      <div class="pc-main">
        <div class="ph">
          ${pcNameHtml(r.profile)}
          <span class="dt">${timeAgo(r.created_at)}</span>
          ${postMenuHtml(postId, r.id)}
        </div>
        <div class="pb">${renderBody(r.body)}</div>
        ${renderMedia(r.media_url, r.media_type)}
        ${postActionsHtml(r, { replyOnclick: `toggleReplyBox('${r.id}')`, replyCount: kids.length })}
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
    const file = fileEl?.files[0];
    if (file) {
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
  await loadThread();
  if (postId) subscribeRealtime();
});
