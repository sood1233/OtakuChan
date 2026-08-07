// ─────────────────────────────────────────────────────────────
// THREAD PAGE — /thread.html?id=<post_id>
// ─────────────────────────────────────────────────────────────
let liked = new Set(JSON.parse(localStorage.getItem('oc_liked') || '[]'));
const postId = new URLSearchParams(location.search).get('id');

const POST_SELECT   = '*, profile:profiles(username,display_name,avatar_url)';
const REPLY_SELECT  = '*, profile:profiles(username,display_name,avatar_url)';

async function loadThread() {
  const wrap = document.getElementById('thread-root');
  if (!postId) { wrap.innerHTML = `<div class="errmsg">No thread specified.</div>`; return; }

  const { data: p, error } = await sb.from('posts').select(POST_SELECT).eq('id', postId).eq('is_deleted', false).single();
  if (error || !p) {
    wrap.innerHTML = `<div class="errmsg">Thread not found or has been removed.</div>`;
    return;
  }
  document.title = (p.subject || 'Thread') + ' — Otakuchan';

  const { data: replies } = await sb.from('replies').select(REPLY_SELECT)
    .eq('post_id', postId).eq('is_deleted', false)
    .order('created_at', { ascending: true });

  wrap.innerHTML = `
    <div class="pc" id="op-post">
      <div class="ph">
        ${p.subject ? `<span class="subj">${esc(p.subject)}</span>` : ''}
        ${authorHtml(p.profile)}
        <span class="dt">${timeAgo(p.created_at)}</span>
        <span class="num">No.${shortId(p.id)}</span>
      </div>
      ${renderMedia(p.media_url, p.media_type)}
      <div class="pb">${renderBody(p.body)}</div>
      <div class="acts">
        <button class="bl${liked.has(p.id) ? ' liked' : ''}" onclick="toggleLike('${p.id}', this)">&hearts; <span class="lc">${p.like_count}</span></button>
        <span class="ai">${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}</span>
        <span class="ai" style="cursor:pointer;" onclick="openReport('${p.id}')">Report thread</span>
      </div>
    </div>
    <div class="rw" id="replies-list">
      ${replies.map(replyHtml).join('') || '<div class="no-t">No replies yet. Be the first to reply.</div>'}
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
}

function replyHtml(r) {
  return `
  <div class="rc" id="reply-${r.id}">
    <div class="ph">
      ${authorHtml(r.profile)}
      <span class="dt">${timeAgo(r.created_at)}</span>
      <span class="num">No.${shortId(r.id)}</span>
      <span class="ai" style="cursor:pointer;float:right;" onclick="openReport('${postId}','${r.id}')">Report</span>
    </div>
    ${renderMedia(r.media_url, r.media_type)}
    <div class="pb">${renderBody(r.body)}</div>
  </div>`;
}

async function submitReply() {
  if (!requireLogin()) return;
  const bodyEl = document.getElementById('rf-body');
  const fileEl = document.getElementById('rf-file');
  const btn    = document.getElementById('rf-btn');
  const stEl   = document.getElementById('rf-st');
  const errEl  = document.getElementById('rf-err');
  clearErr(errEl);

  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, 'Reply cannot be empty.'); return; }
  if (body.length > 4000) { showErr(errEl, 'Reply too long (max 4000 chars).'); return; }

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
    const { data, error } = await sb.from('replies').insert({
      post_id: postId,
      author_id: currentSession.user.id,
      body,
      media_url,
      media_type
    }).select(REPLY_SELECT).single();
    if (error) throw error;
    bodyEl.value = ''; fileEl.value = '';
    document.getElementById('rf-fp').innerHTML = '';
    stEl.textContent = '';
    const list = document.getElementById('replies-list');
    const empty = list.querySelector('.no-t');
    if (empty) list.innerHTML = '';
    if (!document.getElementById(`reply-${data.id}`)) {
      list.insertAdjacentHTML('beforeend', replyHtml(data));
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post reply.');
    stEl.textContent = '';
  } finally {
    btn.disabled = false;
  }
}

async function toggleLike(id, btn) {
  if (!requireLogin()) return;
  if (liked.has(id)) return;
  const { error } = await sb.from('likes').insert({ post_id: id, user_id: currentSession.user.id });
  if (error && error.code !== '23505') return;
  liked.add(id);
  localStorage.setItem('oc_liked', JSON.stringify([...liked]));
  btn.classList.add('liked');
  const lc = btn.querySelector('.lc');
  lc.textContent = parseInt(lc.textContent, 10) + 1;
}

function subscribeRealtime() {
  sb.channel(`thread-${postId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies', filter: `post_id=eq.${postId}` }, async payload => {
      if (document.getElementById(`reply-${payload.new.id}`)) return;
      const list = document.getElementById('replies-list');
      const empty = list.querySelector('.no-t');
      if (empty) list.innerHTML = '';
      const r = payload.new;
      r.profile = await getProfile(r.author_id);
      list.insertAdjacentHTML('beforeend', replyHtml(r));
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
