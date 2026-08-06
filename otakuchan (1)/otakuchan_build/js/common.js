// ─────────────────────────────────────────────────────────────
// COMMON HELPERS — shared by board.js and thread.js
// ─────────────────────────────────────────────────────────────

// A random per-browser id used only to stop the same visitor
// double-liking a post. Not a tracking id — it never leaves
// the browser attached to anything but a like row.
function getDeviceId() {
  let id = localStorage.getItem('oc_device');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('oc_device', id);
  }
  return id;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// Renders body text with basic greentext (> lines) support.
// Input is escaped first, so this cannot inject HTML.
function renderBody(body) {
  return esc(body)
    .split('\n')
    .map(line => line.trim().startsWith('&gt;') ? `<span class="gt">${line}</span>` : line)
    .join('\n');
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function shortId(id) {
  return id.slice(0, 8);
}

function mediaTypeFor(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function validateFile(file, errEl) {
  if (!ALLOWED_MIME.includes(file.type)) {
    showErr(errEl, 'Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, MP4, WebM.');
    return false;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    showErr(errEl, `File too large. Max ${MAX_FILE_MB}MB.`);
    return false;
  }
  return true;
}

function showErr(el, msg) {
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.display = 'block';
}

function clearErr(el) {
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

// Uploads a file to the media bucket and returns { media_url, media_type }
async function uploadMedia(file) {
  const type = mediaTypeFor(file);
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { media_url: data.publicUrl, media_type: type };
}

function renderMedia(url, type, extraClass = '') {
  if (!url) return '';
  if (type === 'video') {
    return `<div class="pm"><video src="${esc(url)}" controls preload="metadata"></video></div>`;
  }
  return `<div class="pm"><img src="${esc(url)}" class="${extraClass}" onclick="this.classList.toggle('exp')" loading="lazy"></div>`;
}

// ── FILE PREVIEW WIDGET ──
function wireFilePreview(inputId, previewId, errElId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  input.addEventListener('change', () => {
    preview.innerHTML = '';
    const file = input.files[0];
    if (!file) return;
    const errEl = errElId ? document.getElementById(errElId) : null;
    if (!validateFile(file, errEl)) { input.value = ''; return; }
    clearErr(errEl);
    const url = URL.createObjectURL(file);
    const type = mediaTypeFor(file);
    const el = type === 'video'
      ? Object.assign(document.createElement('video'), { src: url, controls: true })
      : Object.assign(document.createElement('img'), { src: url });
    preview.appendChild(el);
    const rm = document.createElement('span');
    rm.className = 'rm-f';
    rm.textContent = 'remove file';
    rm.onclick = () => { input.value = ''; preview.innerHTML = ''; };
    preview.appendChild(document.createElement('br'));
    preview.appendChild(rm);
  });
}

// ── REPORT MODAL (shared across board + thread pages) ──
let reportTarget = null; // { postId, replyId }

function openReport(postId, replyId = null) {
  reportTarget = { postId, replyId };
  document.getElementById('modal-report').classList.add('open');
}
function closeReport() {
  document.getElementById('modal-report').classList.remove('open');
  reportTarget = null;
}
async function submitReport() {
  if (!reportTarget) return;
  const reason = document.getElementById('report-reason').value;
  const details = document.getElementById('report-details').value.trim().slice(0, 500);
  try {
    await sb.from('reports').insert({
      post_id: reportTarget.postId,
      reply_id: reportTarget.replyId,
      reason,
      details
    });
    closeReport();
    alert('Report submitted. Moderators will review it.');
  } catch (e) {
    alert('Could not submit report: ' + e.message);
  }
}
