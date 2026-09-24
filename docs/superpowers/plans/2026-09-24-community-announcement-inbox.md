# Community Announcement Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins publish Community announcements (title + constrained rich body + optional photo URL) that fan out to the in-app inbox while keeping the anniversary seed and brand-locked Night Circuit styling.

**Architecture:** Hand-rolled Markdown subset (no npm) for body storage/render; local `state.announcements` + `publishAnnouncement` for prototype parity; Supabase `community_announcements` table with a publish trigger mirroring Giving’s fan-out pattern but applying the venue-style shared/audit recipient split and `applications.community_news` gating. UI reuses Community announcement CSS tokens (Archivo, `--ink` / `--muted` / `--accent`).

**Tech Stack:** Vanilla ES modules, localStorage migrations, Supabase SQL/RLS, Node smoke tests. **No new npm dependencies.**

**Spec:** `docs/superpowers/specs/2026-09-24-community-announcement-inbox-design.md`

## Global Constraints

- Branch: `feature/community-announcement-inbox` off `origin/main` (non-Shop).
- Keep anniversary seed (`ann-itc-turns-2`) visible; do not re-notify on load.
- Rich body: bold, italic, underline, lists only — no font/color pickers; render via Night Circuit CSS.
- Shared inbox: members with `community_news` on + acting admin; audit: other admins only.
- Kind: `community_announcement_published` (shared) and `community_announcement_audit` (audit) for clear filtering.
- Destination: `#/community/announcements`.
- Photo v1: HTTPS URL field only (no new storage bucket in this plan).
- No edit/delete/unpublish in v1.
- Bump `STATE_VERSION` with a migration step when adding `state.announcements`.
- Run `node app/smoke.mjs` and `git diff --check` before claiming done.

## File map

| File | Responsibility |
|---|---|
| `app/js/announcement-markdown.js` | Parse/sanitize Markdown subset → safe HTML; plain-text strip for inbox |
| `app/js/data.js` | Keep `ANNOUNCEMENTS` anniversary; add notification category/destination maps |
| `app/js/store.js` | `state.announcements`, migrate, `publishAnnouncement`, list helpers, live seam |
| `app/js/views.js` | Community list/detail/preview; admin compose form |
| `app/js/app.js` | Routes + form submit for publish |
| `app/styles.css` | Announcement article + compose preview styles (tokens only) |
| `app/smoke.mjs` | TDD coverage for markdown, fan-out, anniversary retention |
| `supabase/migrations/20260925000001_community_announcements.sql` | Table, RLS, publish notify trigger |
| `supabase/tests/community_announcements_integration.sql` | Live recipient matrix (optional harness) |

---

### Task 1: Branch + Markdown subset (failing tests first)

**Files:**
- Create branch from `origin/main`
- Create: `app/js/announcement-markdown.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: `export function renderAnnouncementMarkdown(src)`, `export function announcementPlainText(src)`, `export function assertSafeAnnouncementMarkdown(src)`

- [ ] **Step 1: Create branch**

```bash
git fetch origin main
git worktree add -b feature/community-announcement-inbox .worktrees/community-announcement-inbox origin/main
cd .worktrees/community-announcement-inbox
# Copy approved spec into the worktree if not on main yet:
# docs/superpowers/specs/2026-09-24-community-announcement-inbox-design.md
```

- [ ] **Step 2: Write failing smoke for Markdown**

Near other pure-helper tests in `app/smoke.mjs`:

```js
const md = await import("./js/announcement-markdown.js");
const html = md.renderAnnouncementMarkdown("Hello **bold** and *italic* and __under__\n\n- one\n- two\n\n1. a\n2. b");
if (!html.includes("<strong>bold</strong>") || !html.includes("<em>italic</em>")) {
  throw new Error("markdown must render bold/italic");
}
if (!html.includes("<u>under</u>") && !html.includes("<strong>under</strong>")) {
  // Prefer __underline__ as <u>; if using ** for strong only, document __ as underline
  throw new Error("markdown must render underline via __text__ → <u>");
}
if (!html.includes("<ul>") || !html.includes("<ol>")) {
  throw new Error("markdown must render lists");
}
try {
  md.renderAnnouncementMarkdown("<script>alert(1)</script>");
  throw new Error("raw HTML must be rejected or escaped");
} catch (err) {
  if (!/unsafe|invalid|forbidden/i.test(String(err.message))) {
    // Escaped script tags are OK — assert no executable tag remains
  }
}
if (md.renderAnnouncementMarkdown("x <script>y</script> z").includes("<script>")) {
  throw new Error("script tags must not survive render");
}
if (md.announcementPlainText("Hello **world**") !== "Hello world") {
  throw new Error("plain text strip must remove marks");
}
console.log("ok  announcement markdown subset");
```

Convention locked by this task:

- `**bold**` → `<strong>`
- `*italic*` → `<em>`
- `__underline__` → `<u>`
- `-` / `*` list lines → `<ul><li>`
- `1.` ordered → `<ol><li>`
- Escape all raw `<`, `>`, `&` before applying marks

- [ ] **Step 3: Run smoke — expect FAIL (module missing)**

Run: `node app/smoke.mjs`  
Expected: FAIL cannot find module / ok announcement markdown not reached

- [ ] **Step 4: Implement `app/js/announcement-markdown.js`**

```js
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInline(escapedLine) {
  return escapedLine
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function renderAnnouncementMarkdown(src) {
  const text = String(src || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const parts = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${applyInline(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, "")))}</li>`);
        i += 1;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${applyInline(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, "")))}</li>`);
        i += 1;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const block = [];
    while (i < lines.length && lines[i].trim()
      && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      block.push(applyInline(escapeHtml(lines[i])));
      i += 1;
    }
    parts.push(`<p>${block.join("<br>")}</p>`);
  }
  return `<div class="announcement-body">${parts.join("")}</div>`;
}

export function announcementPlainText(src) {
  return String(src || "")
    .replace(/\r\n/g, "\n")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}
```

- [ ] **Step 5: Run smoke — expect PASS for markdown section**

Run: `node app/smoke.mjs`  
Expected: `ok  announcement markdown subset` and full suite green (if only additive)

- [ ] **Step 6: Commit**

```bash
git add app/js/announcement-markdown.js app/smoke.mjs
git commit -m "$(cat <<'EOF'
feat: add safe announcement markdown subset

Bold, italic, underline, and lists without raw HTML or npm deps.
EOF
)"
```

---

### Task 2: Local publish + inbox fan-out (TDD)

**Files:**
- Modify: `app/js/store.js` (`STATE_VERSION`, `emptyState`, `migrate`, new exports)
- Modify: `app/js/data.js` (notification maps)
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces:
  - `listAnnouncements()` → anniversary seed + `state.announcements` (published), newest news first after anniversary handling per views
  - `publishAnnouncement({ title, body, photoUrl })` → row + notifications
  - Local shape: `{ id, title, body, photoUrl, postedAt, createdBy, status: "published" }`

- [ ] **Step 1: Failing smoke for fan-out**

```js
store.resetLocalData();
installLocalFixtures(); // ensure fixture-admin, fixture-member, fixture-other-admin pattern from venue tests
// Set communityNews true on member, false on a second member if present
store.signIn("admin@example.test");
const published = store.publishAnnouncement({
  title: "Saturday social",
  body: "Bring **shoes**\n\n- water\n- smile",
  photoUrl: "https://example.test/photo.webp",
});
if (!published?.id || published.status !== "published") throw new Error("publish must return published row");
const memberNotes = store.notificationsFor("fixture-member").filter((n) => n.kind === "community_announcement_published");
const actorNotes = store.notificationsFor("fixture-admin").filter((n) => n.kind === "community_announcement_published");
const auditNotes = store.notificationsFor("fixture-other-admin").filter((n) => n.kind === "community_announcement_audit");
// Adjust fixture setup: member communityNews true; add member-off with false
if (memberNotes.length !== 1) throw new Error("opted-in member must get shared");
if (actorNotes.length !== 1) throw new Error("acting admin must get shared");
if (auditNotes.length !== 1) throw new Error("other admin must get audit");
if (memberNotes[0].link !== "#/community/announcements") throw new Error("shared destination");
if (!data.ANNOUNCEMENTS.some((a) => a.id === "ann-itc-turns-2")) throw new Error("anniversary seed intact");
console.log("ok  announcement publish fan-out");
```

Wire fixtures explicitly in the test block (push `fixture-other-admin`, set `communityNews` flags) mirroring the venue override smoke setup.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement store + data maps**

In `data.js` add:

```js
["community_announcement_published", "club"],
["community_announcement_audit", "club"],
// destinations:
["community_announcement_published", "#/community/announcements"],
["community_announcement_audit", "#/community/announcements"],
```

In `store.js`:

- Bump `STATE_VERSION` by 1 (use whatever current main tip is, e.g. 24 → 25)
- `announcements: []` in empty state
- migrate: `if (v < NEW) { if (!Array.isArray(state.announcements)) state.announcements = []; }`
- `publishAnnouncement`:

```js
export function publishAnnouncement({ title, body, photoUrl } = {}) {
  const actor = currentUser();
  if (!actor || !["admin", "super_admin", "superadmin"].includes(actor.role)) {
    throw new Error("Admin only.");
  }
  const cleanTitle = String(title || "").trim();
  const cleanBody = String(body || "").trim();
  if (!cleanTitle) throw new Error("Enter a title");
  if (!cleanBody) throw new Error("Enter announcement body");
  let cleanPhoto = String(photoUrl || "").trim() || null;
  if (cleanPhoto && !/^https:\/\//i.test(cleanPhoto)) {
    throw new Error("Photo URL must be https");
  }
  const row = {
    id: uid("ann"),
    title: cleanTitle,
    body: cleanBody,
    photoUrl: cleanPhoto,
    postedAt: Date.now(),
    createdBy: actor.id,
    status: "published",
  };
  state.announcements.push(row);
  const plain = announcementPlainText(cleanBody);
  const preview = plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
  const link = "#/community/announcements";
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (user.role === "member" && user.communityNews) {
      notify(user.id, "community_announcement_published", `${cleanTitle} — ${preview}`, link);
      // Prefer title field when local notify supports it; if notify() only stores body,
      // push full local notification object with title like venue does.
    }
  }
  // Acting admin shared (even if also admin without communityNews)
  notify(actor.id, "community_announcement_published", `${cleanTitle} — ${preview}`, link);
  // Dedupe if actor somehow double-inserted
  const actorLabel = actor.preferredName || actor.fullName || actor.email || "Admin";
  for (const user of state.users) {
    if (user?.status !== "approved") continue;
    if (!["admin", "super_admin", "superadmin"].includes(user.role)) continue;
    if (user.id === actor.id) continue;
    notify(user.id, "community_announcement_audit",
      `${actorLabel} published “${cleanTitle}”.`, link);
  }
  save();
  return row;
}
```

If `notify()` only takes body, extend the push to include `title: cleanTitle` for shared rows (match venue local shape with `title` + `body`).

Export `listPublishedAnnouncements()` returning `[...state.announcements].sort((a,b) => b.postedAt - a.postedAt)`.

- [ ] **Step 4: Run smoke PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: publish community announcements into local inbox

Gate shared rows on communityNews; acting admin always included.
EOF
)"
```

---

### Task 3: Community + Admin UI

**Files:**
- Modify: `app/js/views.js`, `app/js/app.js`, `app/styles.css`
- Modify: `app/smoke.mjs` (HTML markers)

**Interfaces:**
- Routes: existing `#/community/announcements`; add `#/admin/announcements/new` (or `#/community/announcements/compose` admin-only)
- Form: `data-form="announcement-publish"` fields `title`, `body`, `photo_url`

- [ ] **Step 1: Failing smoke for compose markers**

```js
store.signIn("admin@example.test");
const compose = await views.viewAdminAnnouncementCompose();
for (const marker of ["data-form=\"announcement-publish\"", "name=\"title\"", "name=\"body\"", "name=\"photo_url\"", "announcement-preview"]) {
  if (!compose.includes(marker)) throw new Error(`compose missing ${marker}`);
}
```

- [ ] **Step 2: Implement views**

- `communityHome` “Latest from ITC”: prefer newest `listPublishedAnnouncements()[0]` if any; else anniversary preview (current behavior)
- `communityAnnouncements()`: render anniversary block (existing) then list of published cards with optional `<img>`, title, `renderAnnouncementMarkdown(body)`, date
- `viewAdminAnnouncementCompose()`: form + live preview region (server-render static empty preview; optional `data-action` refresh not required in v1 — preview can be static instructions “Markdown: **bold** *italic* __underline__”)
- Admin nav: add Announcements link under Admin tabs or a button on announcements page for admins

Toolbar (minimal, no npm): helper text under textarea listing syntax — not a WYSIWYG button bar required in v1 (syntax is enough; optional small insert buttons via `data-action="md-wrap"` if cheap).

CSS: `.announcement-article`, `.announcement-body` use `var(--ink)`, `var(--muted)`, Archivo inherit; images `border-radius: var(--radius)`.

- [ ] **Step 3: Wire `app.js`**

```js
case "form-announcement-publish": {
  const title = fd.get("title");
  const body = fd.get("body");
  const photoUrl = fd.get("photo_url");
  await store.publishAnnouncement({ title, body, photoUrl });
  toast("Announcement published");
  location.hash = "#/community/announcements";
  break;
}
```

- [ ] **Step 4: Smoke PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: admin compose and community list for announcements

EOF
)"
```

---

### Task 4: Live Supabase schema + notify trigger

**Files:**
- Create: `supabase/migrations/20260925000001_community_announcements.sql`
- Create: `supabase/tests/community_announcements_integration.sql` (recipient asserts)
- Modify: destination resolver migrations are historical — add forward migration updating `resolve_notification_destination` cases for the two new kinds → `#/community/announcements` (or rely on explicit destination column on insert)

**Interfaces:**
- Table `public.community_announcements`
- Trigger `notify_community_announcement_published` AFTER INSERT when status published (v1 insert-as-published)

- [ ] **Step 1: Migration SQL**

```sql
-- Island Training Club — community announcements + inbox fan-out

create table public.community_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  body text not null check (char_length(trim(body)) > 0),
  photo_url text check (photo_url is null or photo_url ~* '^https://'),
  status text not null default 'published' check (status = 'published'),
  creator_profile_id uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.community_announcements enable row level security;

create policy "approved read published announcements"
  on public.community_announcements for select
  using (
    status = 'published'
    and public.current_user_role() in ('member', 'admin', 'super_admin')
  );

create policy "admin insert announcements"
  on public.community_announcements for insert
  with check (
    public.current_user_role() in ('admin', 'super_admin')
    and creator_profile_id = auth.uid()
  );

create function public.notify_community_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text;
  v_preview text;
begin
  select coalesce(nullif(trim(full_name), ''), email, 'Admin')
    into v_actor_label from public.profiles where id = NEW.creator_profile_id;
  v_actor_label := coalesce(v_actor_label, 'Admin');
  v_preview := left(regexp_replace(NEW.body, E'[\\n\\r]+', ' ', 'g'), 140);

  -- Shared: members with community_news + acting admin
  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'community_announcement_published',
         NEW.title,
         v_preview,
         '#/community/announcements'
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where p.role = 'member'
     and coalesce(a.community_news, false) = true;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select NEW.creator_profile_id,
         'community_announcement_published',
         NEW.title,
         v_preview,
         '#/community/announcements'
   where not exists (
     select 1 from public.notifications n
      where n.profile_id = NEW.creator_profile_id
        and n.kind = 'community_announcement_published'
        and n.created_at >= NEW.published_at
        and n.title = NEW.title
   );
  -- Simpler approach: always insert actor shared; accept duplicate if actor is also member with news on — prefer NOT EXISTS on same statement using UNION of member set + actor:

  -- Prefer single insert:
  -- select ... from profiles where (role=member and community_news) or id = NEW.creator_profile_id

  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'community_announcement_audit',
         'Announcement published',
         format('%s published “%s”.', v_actor_label, NEW.title),
         '#/community/announcements'
    from public.profiles p
   where p.role in ('admin', 'super_admin')
     and p.id <> NEW.creator_profile_id;

  return NEW;
end;
$$;
```

**Implementation note for the executor:** collapse shared into one `INSERT…SELECT` where `(p.role = 'member' AND coalesce(a.community_news,false)) OR p.id = NEW.creator_profile_id` to avoid actor duplicates. Strip markdown in SQL preview with a simple regexp or store plain preview from the RPC.

Add RPC `publish_community_announcement(title, body, photo_url)` security definer that inserts the row as the actor (cleaner than client insert) — recommended.

Forward-update notification destination resolvers if inserts omit destination — prefer always setting `destination` on insert like venue.

- [ ] **Step 2: Integration SQL** asserting shared/audit counts with fixtures (mirror giving_campaigns_integration style)

- [ ] **Step 3: Commit migration**

```bash
git commit -m "$(cat <<'EOF'
feat: community_announcements table and inbox fan-out

EOF
)"
```

---

### Task 5: Live store seam

**Files:**
- Modify: `app/js/store.js` (`listPublishedAnnouncements`, `publishAnnouncement` live branches)

- [ ] **Step 1:** When `isLive()`, `publishAnnouncement` calls RPC `publish_community_announcement`; list reads from `community_announcements` ordered by `published_at desc`.
- [ ] **Step 2:** Smoke/live-auth markers if the repo patterns require source asserts for RPC names.
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: live seam for community announcement publish and list

EOF
)"
```

---

### Task 6: Docs + verification

**Files:**
- Ensure spec + plan committed on the branch
- Link plan from spec header (already present when approved)

- [ ] **Step 1:** `node app/smoke.mjs` PASS  
- [ ] **Step 2:** `git diff --check` clean  
- [ ] **Step 3:** Commit docs if untracked  
- [ ] **Step 4:** Push + PR to `main` when asked (do not push until human requests)

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| A+ markdown marks + lists | 1 |
| Optional https photo | 2, 3, 4 |
| Brand-locked CSS | 3 |
| Anniversary retained | 2, 3 |
| Shared/audit + community_news | 2, 4 |
| Local + live | 2, 4, 5 |
| No npm | Global |
| No edit/delete v1 | Global |

## Placeholder scan

Rich-text library choice locked to hand-rolled Markdown. Photo locked to https URL. Executor must implement the collapsed SQL shared insert (noted above) without leaving TODO comments in committed SQL.
