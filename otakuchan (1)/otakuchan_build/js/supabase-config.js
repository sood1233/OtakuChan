// ─────────────────────────────────────────────────────────────
// SUPABASE CONFIG
// Fill these in with your own project's values.
// Find them in: Supabase Dashboard → Project Settings → API
// SUPABASE_ANON_KEY is the public "anon" key — it is safe to
// expose in client-side code as long as Row Level Security (RLS)
// policies are enabled on every table (they are, see schema.sql).
// Never put your service_role key in frontend code.
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEDIA_BUCKET = 'media';
const MAX_FILE_MB = 5;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
