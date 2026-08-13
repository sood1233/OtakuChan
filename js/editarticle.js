// ─────────────────────────────────────────────────────────────
// WRITE / EDIT ARTICLE PAGE — /editarticle.html (create) or
// /editarticle.html?id=<uuid> (edit an existing one you own). Any
// logged-in account can create an article; editing requires being
// its author — enforced both here (redirect if not) and by RLS
// (supabase/articles.sql's articles_update_own policy) as the real
// backstop. Same "?id=" query-param pattern editprofile.html and
// the create-list modal use for reusing one form as both create
// and edit.
// ─────────────────────────────────────────────────────────────
let eaEditingId = null;
let eaOriginal = null;

function eaGetEditId() {
  return new URLSearchParams(location.search).get('id');
}

async function initEditArticle() {
  if (!requireLogin()) return;
  eaEditingId = eaGetEditId();
  if (!eaEditingId) return; // fresh create — form starts blank

  const { data, error } = await sb.from('articles').select('*')
    .eq('id', eaEditingId).eq('is_deleted', false).maybeSingle();
  if (error || !data) {
    toast('Could not load that Article to edit.', 'error');
    location.href = 'articles.html';
    return;
  }
  if (data.author_id !== currentSession.user.id) {
    toast("You can only edit your own Articles.", 'error');
    location.href = articleUrl(data.id);
    return;
  }
  eaOriginal = data;
  document.getElementById('ea-title-hdr').textContent = 'Edit Article';
  document.title = 'Edit Article — InteractInk';
  document.getElementById('ea-title').value = data.title;
  document.getElementById('ea-cover').value = data.cover_url || '';
  document.getElementById('ea-body').value = data.body;
  document.getElementById('ea-submit').textContent = 'Save';
}

async function submitArticle() {
  if (!requireLogin()) return;
  const titleEl = document.getElementById('ea-title');
  const coverEl = document.getElementById('ea-cover');
  const bodyEl = document.getElementById('ea-body');
  const errEl = document.getElementById('ea-err');
  const btn = document.getElementById('ea-submit');
  clearErr(errEl);

  const title = titleEl.value.trim();
  const cover_url = coverEl.value.trim();
  const body = bodyEl.value.trim();

  if (!title) { showErr(errEl, 'Give your article a title.'); return; }
  if (title.length > 120) { showErr(errEl, 'Title is too long (max 120 characters).'); return; }
  if (!body) { showErr(errEl, 'Your article needs some body text.'); return; }
  if (cover_url && !/^https?:\/\//i.test(cover_url)) { showErr(errEl, 'Cover image must be a valid https:// URL.'); return; }

  btn.disabled = true;
  btn.textContent = eaEditingId ? 'Saving…' : 'Publishing…';
  try {
    if (eaEditingId) {
      const { error } = await sb.from('articles')
        .update({ title, body, cover_url: cover_url || null })
        .eq('id', eaEditingId);
      if (error) throw error;
      toast('Article updated.');
      location.href = articleUrl(eaEditingId);
    } else {
      const { data, error } = await sb.from('articles').insert({
        title, body, cover_url: cover_url || null, author_id: currentSession.user.id
      }).select('*').single();
      if (error) throw error;
      toast('Article published.');
      location.href = articleUrl(data.id);
    }
  } catch (e) {
    showErr(errEl, e.message || 'Failed to save that Article.');
    btn.disabled = false;
    btn.textContent = eaEditingId ? 'Save' : 'Publish';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise requireLogin() below can misfire before session is known
  initEditArticle();
});
