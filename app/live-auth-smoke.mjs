// Focused regression for the Supabase OAuth -> synchronous view handoff.
// Run directly with: node app/live-auth-smoke.mjs

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};

const authUser = {
  id: "live-user-1",
  email: "runner@example.com",
  user_metadata: {
    full_name: "Riley Runner",
    avatar_url: "https://example.com/avatar.jpg",
  },
};
const profile = {
  id: authUser.id,
  email: authUser.email,
  full_name: "Riley Runner",
  avatar_url: authUser.user_metadata.avatar_url,
  role: "member",
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
};

const fakeSupabase = {
  auth: {
    getSession: async () => ({
      data: {
        session: {
          access_token: "test-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 9999999999,
          refresh_token: "test-refresh-token",
          user: authUser,
        },
      },
      error: null,
    }),
  },
  from(table) {
    if (table !== "profiles") throw new Error(`Unexpected table: ${table}`);
    return {
      select() {
        return {
          eq(column, value) {
            if (column !== "id" || value !== authUser.id) {
              throw new Error("Profile query did not target the signed-in user");
            }
            return {
              maybeSingle: async () => ({ data: profile, error: null }),
            };
          },
        };
      },
    };
  },
};

globalThis.window = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  supabase: { createClient: () => fakeSupabase },
};

const store = await import("./js/store.js");
const views = await import("./js/views.js");
store.load();

await store.getCurrentUser();
const renderedUser = store.currentUser();
if (!renderedUser || renderedUser.id !== authUser.id) {
  throw new Error("A fetched Supabase session was not available to synchronous views");
}

const home = views.viewHome();
if (!home.includes("Good to see you, Riley.")) {
  throw new Error("Home did not greet the signed-in Google user");
}
if (home.includes("Continue with Google")) {
  throw new Error("Home still asked the signed-in Google user to sign in");
}

console.log("ok  live OAuth session renders the signed-in home page");
