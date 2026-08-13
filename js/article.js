// ─────────────────────────────────────────────────────────────
// SINGLE ARTICLE PAGE — /i/articles/<uuid> (also reachable via the
// legacy article.html?id=<uuid> form — see currentArticleId() in
// common.js). Shows the article's cover image (if any), title,
// author byline, full body, and Edit/Delete actions for the author
// only — same shape as list.html's hero, minus members/followers
// (an article has exactly one author, nothing to curate or follow).
// ─────────────────────────────────────────────────────────────
const articleId = currentArticleId();
let article = null; // the loaded article row
let isArticleAuthor = false;

async function loadArticle() {
  const contentEl = document.getElementById('article-content');
  if (!articleId) {
    contentEl.innerHTML = `<div id="feed-empty">No Article specified.</div>`;
    return;
  }

  const { data, error } = await sb.from('articles').select('*')
    .eq('id', articleId).eq('is_deleted', false).maybeSingle();
  if (error) { contentEl.innerHTML = `<div class="errmsg">Failed to load Article: ${esc(error.message)}</div>`; return; }
  if (!data) { contentEl.innerHTML = `<div id="feed-empty">This Article doesn't exist, or was deleted.</div>`; return; }
  article = data;

  document.title = `${article.title} — InteractInk`;
  setPageH1(article.title);
  setPageDescription(articleExcerpt(article.body, 200));
  setCanonical(articleUrl(article.id));
  if (article.cover_url) setPageImage(article.cover_url);
  setJsonLd({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: article.title,
    articleBody: article.body,
    datePublished: article.created_at,
    dateModified: article.updated_at,
    url: location.origin + articleUrl(article.id),
    image: article.cover_url || undefined,
  });

  isArticleAuthor = !!(currentSession && article.author_id === currentSession.user.id);

  const { data: author } = await sb.from('profiles')
    .select('username,display_name,avatar_url,verified').eq('id', article.author_id).maybeSingle();
  article._author = author;

  renderArticle();
}

function renderArticle() {
  const contentEl = document.getElementById('article-content');
  const actions = isArticleAuthor ? `
    <div class="article-hero-actions">
      <button type="button" class="list-edit-btn" onclick="location.href='editarticle.html?id=${encodeURIComponent(article.id)}'">Edit</button>
      <button type="button" class="list-delete-btn" onclick="deleteArticleConfirm(article.id, article.title)">Delete</button>
    </div>` : '';

  contentEl.innerHTML = `
    <div class="article-hero">
      ${article.cover_url ? `<img class="article-hero-cover" src="${esc(article.cover_url)}" alt="">` : ''}
      <div class="article-hero-title">${esc(article.title)}</div>
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          ${article._author ? `
          <div class="article-hero-byline">
            <a class="who-row" style="padding:0;" href="${profileUrl(article._author.username)}">
              <img class="avatar" style="width:32px;height:32px;" src="${esc(avatarUrl(article._author.avatar_url))}" alt="">
              <span class="who-row-txt">
                <span class="who-row-name">${esc(article._author.display_name || article._author.username)}${vBadge(article._author)}</span>
              </span>
            </a>
          </div>
          <div class="article-hero-meta">${fullDateTime(article.created_at)}${article.updated_at && article.updated_at !== article.created_at ? ' · Edited' : ''}</div>
          ` : ''}
        </div>
        ${actions}
      </div>
    </div>
    <div class="article-body">${renderBody(article.body)}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  await authReady; // see auth.js — otherwise isArticleAuthor can't be known yet
  loadArticle();
});
