// ─────────────────────────────────────────────────────────────
// /robots.txt  (served by the "/robots.txt" -> "/api/robots" rewrite
// in vercel.json)
//
// Written as a serverless function instead of a static file for one
// reason: the "Sitemap:" line has to be an *absolute* URL, and a
// static file can't know what domain it's being served from (a
// Vercel Preview URL, a custom domain, staging vs. prod, ...). This
// builds it from the actual request host every time, so it's always
// correct no matter where the project is deployed.
//
// Disallows the pages that are personal/utility screens rather than
// indexable content (same list as the noindex meta tags on those
// pages — see README's "SEO / indexing" section) — a crawler
// shouldn't spend budget on someone's private settings or DM inbox,
// and none of it is public content anyway (RLS blocks it for a
// logged-out request same as it would for any other stranger).
// ─────────────────────────────────────────────────────────────
module.exports = function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${host}`;

  const body = `User-agent: *
Allow: /
Disallow: /settings
Disallow: /bookmarks
Disallow: /notifications
Disallow: /messages
Disallow: /messages/*
Disallow: /login
Disallow: /signup
Disallow: /editprofile
Disallow: /lists
Disallow: /search

Sitemap: ${origin}/sitemap.xml
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(body);
}
