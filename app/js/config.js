// app/js/config.js
// Reads env vars injected via inline <script> in index.html and returns a
// configured Supabase client, or null when running without Supabase (local
// prototype). Exposes a single `supabase` named export so call-sites import
// it the same way regardless of configuration.

export const config = {
  url: typeof window !== "undefined" ? window.SUPABASE_URL || null : null,
  anonKey: typeof window !== "undefined" ? window.SUPABASE_ANON_KEY || null : null,
};

export const supabase = config.url && config.anonKey && typeof window !== "undefined" && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "itc.supabase.session",
      },
    })
  : null;

export const isLive = supabase !== null;