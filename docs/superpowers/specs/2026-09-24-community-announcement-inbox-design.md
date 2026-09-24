# Community Announcement Publish + Inbox

**Date:** 2026-09-24  
**Branch:** `feature/community-announcement-inbox` (off `main`)  
**Status:** Approved for implementation  
**Plan:** `docs/superpowers/plans/2026-09-24-community-announcement-inbox.md`  
**Depends on (product, not merge-blocking):** venue inbox fan-out pattern (`feature/venue-inbox-fanout` / PR #27) for shared/audit recipient split

## Problem

Community announcements are seed-only (`ANNOUNCEMENTS` in `data.js`). There is no admin publish path. Privacy preference `applications.community_news` is stored but unused. Leaders cannot send club news into the in-app inbox.

## Approved direction (A+)

Admin **compose and publish** a simple announcement:

- **Title** + **rich body** (bold, italic, underline, lists)
- **Optional photo**
- **Brand-locked** typography and color (Night Circuit / Archivo + CSS tokens — no font or color pickers)
- Fan-out to the in-app inbox using the **same shared/audit split** as venue confirmations
- Keep the existing **ITC anniversary seed** visible as today’s special Community card; new publishes are ordinary news items in the list

## Recipient split

| Row | Recipients | Purpose |
|---|---|---|
| Shared | Approved members with `community_news` **on**, plus **acting admin** (always, even if their toggle is off) | The announcement itself |
| Audit | Other `admin` / `super_admin` only (actor excluded) | Who published what |

- Kind: `community_announcement_published` (shared and audit may share kind; distinguish by title/body, or use `community_announcement_audit` for audit if cleaner in implementation)
- Destination: `#/community/announcements` (optionally `#/community/announcements/{id}` if deep-link needed)
- Shared title/body: announcement title + short plain lead or truncated body for inbox preview
- Audit title/body: e.g. “Announcement published” / “{Actor} published “{title}”.”

## Content model

### Fields

| Field | Notes |
|---|---|
| `id` | uuid / local id |
| `title` | required, plain text |
| `body` | required, constrained rich text (see below) |
| `photoUrl` / `photoPath` | optional |
| `postedAt` | publish timestamp |
| `createdBy` | acting admin profile id |
| `status` | `published` for v1 (no draft workflow required) |

### Rich body (v1)

Allowed:

- Bold, italic, underline
- Bullet and numbered lists
- Paragraphs / line breaks
- Optional single hero photo (separate field, not arbitrary inline gallery)

Not allowed:

- Custom font family or font size pickers
- Custom text/background color pickers
- Arbitrary HTML / scripts
- Full anniversary CMS fields (milestones, commitment block) — out of scope (option B)

Storage format: prefer a **safe subset** (e.g. Markdown or a small JSON/ProseMirror-like doc) rendered through a sanitizing renderer into HTML that only uses Community announcement CSS classes. Never store raw unsanitized HTML from the client as the source of truth without a sanitizer.

### Visual system (fixed)

From existing Night Circuit tokens:

- Font: Archivo (`--font` / `--font-display`)
- Title: display weight; body: default ink; secondary: `--muted`; accent kickers: `--accent`
- Surfaces: `--surface` / `--bg`; borders: `--line`

Compose UI may show a live preview using those classes so leaders see the athletic look before publish.

## Anniversary seed

- Keep current anniversary entry in `ANNOUNCEMENTS` (or migrate it once into the store/table as a `kind: anniversary` / flagged row) so Community pulse and Announcements still show it.
- New publishes are listed separately (newest first) and do not replace the anniversary card unless product later chooses otherwise.
- Anniversary does **not** re-fan-out on deploy; only explicit publishes notify.

## Admin UX

- Admin-only entry point (e.g. Admin → Community / Announcements → Compose, or a button on Community Announcements when role is admin)
- Fields: title, rich-text toolbar body, optional photo upload/URL (match existing asset patterns where possible)
- Primary action: **Publish** (immediate fan-out)
- v1: no edit/delete after publish (follow-up)

## Member UX

- Community home “Latest from ITC” can show newest published item (or anniversary if no news yet — exact priority in plan)
- `#/community/announcements` lists anniversary (if retained) + published items
- Inbox row opens announcements list (or specific item)

## Storage

### Live (Supabase)

- Table `public.announcements` (name may be `community_announcements` if clearer)
- RLS: approved members read published; admins insert/publish
- Publish path: security-definer RPC or trigger that writes notification rows per recipient rules above
- Resolve `community_news` from `applications.community_news` for members; acting admin always included in shared set

### Local prototype

- `state.announcements` array via `store.js` migrations (`STATE_VERSION` bump)
- `publishAnnouncement(form)` fans out with the same recipient matrix using local user flags (`communityNews`)

## Out of scope

- Option B rich anniversary CMS
- WhatsApp / email delivery (preference remains for future channels)
- Font/color pickers
- Multi-image galleries, video embeds
- Edit / unpublish / schedule
- Shop branch work

## Testing

- Smoke: publish as admin → members with `communityNews` true get shared; member with false does not; actor gets shared; other admin gets audit only; anniversary still renders
- Live SQL/integration: recipient matrix + RLS; sanitizer rejects unsafe markup
- Visual: announcement detail uses Archivo + Night Circuit tokens only

## Branching and merge

1. Base on `main` (post draft-watermark fix #28 when merged; does not require venue #27 to merge first, but reuse its recipient-split vocabulary)
2. PR into `main`
3. Do not land on `feature/shop-page`

## Open implementation notes (non-blocking for spec approval)

- Exact rich-text library vs hand-rolled Markdown toolbar in vanilla JS — prefer minimal Markdown + sanitize if no new npm deps (AGENTS.md: no npm dependencies)
- Photo: upload to existing hosting vs URL field in prototype — decide in plan from current Giving/profile photo patterns
- Whether inbox shared body is plain-text stripped of marks for notification list readability
