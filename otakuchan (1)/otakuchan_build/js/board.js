// ─────────────────────────────────────────────────────────────
// BOARD PAGE — /index.html
// ─────────────────────────────────────────────────────────────
let liked = new Set(JSON.parse(localStorage.getItem('oc_liked') || '[]'));

async function loadFeed() {
  const feedEl = document.getElementById('feed-posts');
  const { data, error } = await sb
    .from('posts')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    feedEl.innerHTML = `<div class="errmsg">Failed to load posts: ${esc(error.message)}</div>`;
    return;
  }
  document.getElementById('feed-ct').textContent = `(${data.length})`;
  if (!data.length) {
    feedEl.innerHTML = `<div id="feed-empty">No threads yet. Be the first to post.</div>`;
    return;
  }
  feedEl.innerHTML = data.map(postCardHtml).join('');
}

function postCardHtml(p, flash = false) {
  return `
  <div class="pc${flash ? ' flash' : ''}" id="post-${p.id}">
    <div class="ph">
      ${p.subject ? `<span class="subj">${esc(p.subject)}</span>` : ''}
      <span class="nm">${esc(p.author || 'Anonymous')}</span>
      <span class="dt">${timeAgo(p.created_at)}</span>
      <span class="num">No.${shortId(p.id)}</span>
    </div>
    ${renderMedia(p.media_url, p.media_type)}
    <div class="pb">${renderBody(p.body)}</div>
    <div class="acts">
      <button class="bl${liked.has(p.id) ? ' liked' : ''}" onclick="toggleLike('${p.id}', this)">&hearts; <span class="lc">${p.like_count}</span></button>
      <a class="br" href="thread.html?id=${p.id}">Reply (${p.reply_count})</a>
      <a class="br" href="thread.html?id=${p.id}">View thread &rarr;</a>
      <span class="ai" style="cursor:pointer;" onclick="openReport('${p.id}')">Report</span>
    </div>
  </div>`;
}

async function toggleLike(postId, btn) {
  if (liked.has(postId)) return; // one like per browser
  const device = getDeviceId();
  const { error } = await sb.from('likes').insert({ post_id: postId, ip_hash: device });
  if (error) {
    if (error.code === '23505') { // unique violation — already liked from this device
      liked.add(postId);
      localStorage.setItem('oc_liked', JSON.stringify([...liked]));
    }
    return;
  }
  liked.add(postId);
  localStorage.setItem('oc_liked', JSON.stringify([...liked]));
  btn.classList.add('liked');
  const lc = btn.querySelector('.lc');
  lc.textContent = parseInt(lc.textContent, 10) + 1;
}

// ── NEW THREAD FORM ──
function togglePF() {
  document.getElementById('pf-box').classList.toggle('open');
}

async function submitPost() {
  const nameEl = document.getElementById('pf-name');
  const subjEl = document.getElementById('pf-subj');
  const bodyEl = document.getElementById('pf-body');
  const fileEl = document.getElementById('pf-file');
  const btn    = document.getElementById('pf-btn');
  const stEl   = document.getElementById('pf-st');
  const errEl  = document.getElementById('pf-err');
  clearErr(errEl);

  const body = bodyEl.value.trim();
  if (!body) { showErr(errEl, 'Comment cannot be empty.'); return; }
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
    const { error } = await sb.from('posts').insert({
      author: nameEl.value.trim().slice(0, 50) || 'Anonymous',
      subject: subjEl.value.trim().slice(0, 120) || null,
      body,
      media_url,
      media_type
    });
    if (error) throw error;
    nameEl.value = ''; subjEl.value = ''; bodyEl.value = '';
    fileEl.value = ''; document.getElementById('pf-fp').innerHTML = '';
    document.getElementById('pf-box').classList.remove('open');
    stEl.textContent = '';
    await loadFeed();
  } catch (e) {
    showErr(errEl, e.message || 'Failed to post.');
    stEl.textContent = '';
  } finally {
    btn.disabled = false;
  }
}

// ── TRENDING SIDEBAR ──
async function loadTrending() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [{ data: byLikes }, { data: byReplies }] = await Promise.all([
    sb.from('posts').select('*').eq('is_deleted', false).gte('created_at', since)
      .order('like_count', { ascending: false }).limit(3),
    sb.from('posts').select('*').eq('is_deleted', false).gte('created_at', since)
      .order('reply_count', { ascending: false }).limit(3)
  ]);

  document.getElementById('t-upd').textContent = 'updated ' + new Date().toLocaleTimeString();
  document.getElementById('t-liked').innerHTML = trendListHtml(byLikes, 'like_count', '&hearts;');
  document.getElementById('t-replied').innerHTML = trendListHtml(byReplies, 'reply_count', '&#9673;');
}

function trendListHtml(list, field, icon) {
  if (!list || !list.length) return `<div class="no-t">Nothing trending yet.</div>`;
  return list.map(p => `
    <a class="tcard" href="thread.html?id=${p.id}">
      <div class="ph"><span class="nm">${esc(p.author || 'Anonymous')}</span><span class="dt">${timeAgo(p.created_at)}</span></div>
      <div class="tsnip">${renderBody((p.body || '').slice(0, 140))}</div>
      <div class="tmeta">${icon} ${p[field]}</div>
    </a>`).join('');
}

// ── REALTIME: new posts appear live ──
function subscribeRealtime() {
  sb.channel('posts-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
      const p = payload.new;
      if (p.is_deleted) return;
      const feedEl = document.getElementById('feed-posts');
      const empty = document.getElementById('feed-empty');
      if (empty) feedEl.innerHTML = '';
      feedEl.insertAdjacentHTML('afterbegin', postCardHtml(p, true));
      const ctEl = document.getElementById('feed-ct');
      const n = feedEl.querySelectorAll('.pc').length;
      ctEl.textContent = `(${n})`;
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, payload => {
      const p = payload.new;
      const card = document.getElementById(`post-${p.id}`);
      if (card) card.outerHTML = postCardHtml(p);
    })
    .subscribe();
}

document.addEventListener('DOMContentLoaded', () => {
  loadFeed();
  loadTrending();
  subscribeRealtime();
  wireFilePreview('pf-file', 'pf-fp', 'pf-err');
  setInterval(loadTrending, 60000);
});
