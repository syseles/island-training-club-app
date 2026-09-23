# Committee Feedback Tracker Setup Guide

How to build and run the committee feedback tracker as a Google Sheet. The sheet lives outside this repo; this guide and the import file are the repo's copy of the template.

**Who this is for:** the person maintaining the sheet on behalf of the app team. Committee members only need the share link and the "How to use" tab.

**Time to set up:** about 2 minutes with the Apps Script fast path, or about 15 minutes by hand.

## What You Will Build

A Google Sheet with three tabs:

| Tab | Purpose | Who edits it |
| --- | --- | --- |
| How to use | Plain-language instructions for committee members | App team only |
| Feedback tracker | The main sheet — one row per piece of feedback | Committees fill columns A–I; app team fills columns J–N |
| Lists | Dropdown values (committees, screens, feedback types, statuses) | App team only |

## Fast Path: Run The Builder Script

`docs/feedback-tracker-builder.js` is an Apps Script that performs Steps 2–6 for you — tabs, headers, self-numbering IDs, all six dropdowns, status colours, and protection over the app-team columns and the Lists tab.

1. Go to [sheets.new](https://sheets.new), then **Extensions → Apps Script**.
2. Delete the placeholder code, paste the entire contents of `docs/feedback-tracker-builder.js`, and save (Ctrl+S / ⌘S).
3. Select **buildFeedbackTracker** in the toolbar, click **Run**, and approve the one-time permission prompt.

The sheet is then ready except for Step 7 (share + notifications) and adding your committee names on the Lists tab. The script announces both when it finishes.

> **Re-running the script rebuilds every tab from scratch and wipes any feedback rows.** Run it once before go-live; afterwards, edit the Lists tab directly for small value changes. If the app gains or renames a screen, update the `SCREENS` list in the script (and the Lists tab) so the dropdown keeps matching reality.

The steps below remain the manual fallback if you'd rather build by hand.

## Step 1: Create The Sheet And Import The Tracker Tab

1. Go to [sheets.new](https://sheets.new) and create a blank spreadsheet.
2. Name it (suggested: **ITC Web App — Committee Feedback**).
3. Rename the default tab (`Sheet1`) to **Feedback tracker**.
4. In the repo, open `docs/feedback-tracker-import.csv` and copy the header row.
5. Back in the sheet, select cell `A1`, paste, then check each column landed in its own cell (paste as **Paste special → Values only** if formatting looks off).

You should now have 14 headers across row 1:

`ID` · `Date submitted` · `Committee` · `Submitted by` · `Screen/Flow` · `Feedback type` · `Description` · `Screenshot` · `Committee importance` · `Status` · `Priority (app team)` · `Owner` · `Response / decision` · `Date updated`

6. Select row 1 and apply **View → Freeze → 1 row** so headers stay visible when scrolling.

## Step 2: Create The Lists Tab

Add a new tab named **Lists**. Enter these values, one list per column, starting at row 2 (row 1 holds the labels):

> Faster: **File → Import → Upload** `docs/feedback-tracker-lists.csv` with **Insert new sheet(s)**, then rename the imported tab to **Lists**.

| A: Committee | B: Screen/Flow | C: Feedback type | D: Status | E: Priority | F: Committee importance |
| --- | --- | --- | --- | --- | --- |
| *(add your own)* | Home | Not working (bug) | New | Critical | Critical |
| | Schedule | Looks wrong (visual) | Under review | High | Important |
| | Activity details | Wording / unclear text | Accepted | Medium | Nice to have |
| | Booking flow | Confusing flow | In progress | Low | |
| | Checkout & payment | Feature suggestion | Shipped | | |
| | Receipt | Question | Declined | | |
| | | | Deferred | | |
| | | | | | |
| | Giving | | | | |
| | Community | | | | |
| | Profile — overview | | | | |
| | Profile — Bookings & History | | | | |
| | Profile — Membership Details | | | | |
| | Profile — Indemnity / waiver | | | | |
| | Profile — Payments & Receipts | | | | |
| | Profile — Privacy & Notifications | | | | |
| | Notifications | | | | |
| | Sign in / magic link | | | | |
| | Membership application | | | | |
| | Admin — members & approvals | | | | |
| | Admin — activities | | | | |
| | Admin — giving campaigns | | | | |
| | Something else | | | | |

The Screen/Flow list matches the app as it exists today: the five main tabs (Home, Schedule, Giving, Community, Profile), the booking journey (Activity details → Booking flow → Checkout & payment → Receipt), HYROX, and the admin screens. If a screen is added or renamed in the app, update this list — the dropdowns follow automatically.

> Column A (Committee) ships empty on purpose — add your actual committee names under the header before sharing the sheet. The Committee dropdown on the tracker stays empty until you do. Leave a few blank rows under each list for growth — the validation ranges below already include them.

## Step 3: Add Dropdowns To The Tracker Tab

For each column below, select the range on **Feedback tracker**, then **Data → Data validation → Add rule**:

| Column | Range | Criteria | Values come from |
| --- | --- | --- | --- |
| C — Committee | `C2:C500` | Dropdown (from a range) | `=Lists!$A$2:$A$20` |
| E — Screen/Flow | `E2:E500` | Dropdown (from a range) | `=Lists!$B$2:$B$40` |
| F — Feedback type | `F2:F500` | Dropdown (from a range) | `=Lists!$C$2:$C$20` |
| I — Committee importance | `I2:I500` | Dropdown (from a range) | `=Lists!$F$2:$F$20` |
| J — Status | `J2:J500` | Dropdown (from a range) | `=Lists!$D$2:$D$20` |
| K — Priority | `K2:K500` | Dropdown (from a range) | `=Lists!$E$2:$E$20` |

Set every rule to **Reject the input** when invalid so typos can't bypass the dropdowns.

Optional but recommended:

- **ID (column A):** paste `=IF(B2="","","FB-"&TEXT(ROW()-1,"000"))` into `A2` and fill down to `A500`. Each row numbers itself only once it has a submission date, so empty rows stay blank (`FB-001`, `FB-002`, …).
- **Date submitted (column B):** add a validation rule of type **is valid date**.
- **Date updated (column N):** same — **is valid date**.

## Step 4: Add The How To Use Tab

Add a tab named **How to use**, positioned first. Paste this text (one block per row is fine — this tab is for reading, not formatting):

> Faster: **File → Import → Upload** `docs/feedback-tracker-how-to-use.csv` with **Insert new sheet(s)**, rename the tab to **How to use**, and drag it to the first tab position.

> **How to submit feedback**
>
> 1. Go to the **Feedback tracker** tab.
> 2. Use the first empty row. Fill in columns A–I only — the grey columns (J onwards) are for the app team.
> 3. One piece of feedback per row. If you have two separate suggestions, use two rows.
> 4. Pick the **Screen/Flow** closest to where the issue is, then a **Feedback type**. In **Description**, write what you saw, where, and what you expected — a stranger should understand it without asking you anything.
> 5. If you can, put a screenshot in the **Screenshot** cell: select the cell and press Ctrl+V (⌘V on Mac), or use **Insert → Image → Image in cell**. One screenshot per row is plenty.
> 6. **Committee importance** is your committee's honest view: *Critical* = blocks your committee from doing its work, *Important* = clearly worth doing, *Nice to have* = good idea, no urgency.
>
> **What happens next**
>
> - The app team reviews new rows regularly and sets a **Status** and a **Response** so you can see the outcome and the reason.
> - Check back on your rows to see progress. The sheet is the single source of truth — there are no email notifications.
> - Please don't edit or delete other committees' rows, and don't fill in the app-team columns.
>
> **Good feedback looks like**
>
> - "On Schedule, the Wednesday session shows a Book button, but it's free — should it say Add to Calendar instead?" *(specific, actionable)*
> - "The app is confusing." *(too vague — say what, where, and what you expected)*

Adjust the wording to taste before sharing.

## Step 5: Protect The App-Team Columns

This is what lets committees have **Editor** access without being able to touch status and decisions.

1. On **Feedback tracker**, select columns `J` through `N` (click the column J header, shift-click column N).
2. **Data → Protect sheets and ranges.**
3. Add a description: **App team only — do not edit**.
4. Click **Set permissions**, choose **Restrict who can edit this range**, and select **Only you** (add co-maintainers by email if you have them).
5. Repeat for the **Lists** tab: protect the whole sheet the same way.

Committee members will now see those cells as locked. They keep full edit access to columns A–I.

## Step 6: Colour-Code Status

On **Feedback tracker**, select `J2:J500`, then **Format → Conditional formatting**. Add one rule per status using **Format cells if → Text contains**:

| Status | Suggested colour |
| --- | --- |
| New | Light grey |
| Under review | Light yellow |
| Accepted | Light blue |
| In progress | Light orange |
| Shipped | Light green |
| Declined | Light red |
| Deferred | Light purple |

## Step 7: Share And Turn On Notifications

1. **Share** the sheet with committee leads as **Editor** (they can add rows and view everything). View-only is fine for members who just want to read.
2. **Tools → Notification rules → When changes are made:** choose to get an email when *any changes are made* (daily digest is usually enough). This is how you learn a new row arrived, since committees don't email you directly.

## Column Reference

| Column | Field | Filled by | Notes |
| --- | --- | --- | --- |
| A | ID | Formula | `FB-001` style, self-numbering |
| B | Date submitted | Committee | When the feedback was entered |
| C | Committee | Committee | Dropdown from Lists |
| D | Submitted by | Committee | Person's name |
| E | Screen/Flow | Committee | Dropdown from Lists — matches the app's actual screens |
| F | Feedback type | Committee | Dropdown from Lists — bug, visual, wording, confusing flow, suggestion, question |
| G | Description | Committee | What you saw, where, and what you expected |
| H | Screenshot | Committee | Paste an image into the cell (Ctrl+V / ⌘V) |
| I | Committee importance | Committee | Critical / Important / Nice to have |
| J | Status | App team | Lifecycle — see below |
| K | Priority (app team) | App team | The app team's own priority call |
| L | Owner | App team | Who is actioning it |
| M | Response / decision | App team | Outcome and reasoning, so committees see why |
| N | Date updated | App team | Last time the row changed |

## Status Lifecycle

| Status | Meaning |
| --- | --- |
| New | Received, not yet looked at properly |
| Under review | Being discussed by the app team |
| Accepted | Agreed — will be built, priority and owner to follow |
| In progress | Actively being built |
| Shipped | Live in the app |
| Declined | Not doing it — the reason must be in Response / decision |
| Deferred | Valid, but not now — revisit noted in Response / decision |

Every move to **Declined** or **Deferred** should come with a written reason. That is what keeps committees trusting the sheet.

## Ongoing Maintenance

- **Adding a committee, screen, or feedback type:** edit the Lists tab; dropdowns update automatically (the validation ranges already cover rows 2–40).
- **Archiving:** when the tracker gets long, copy rows with Status **Shipped** or **Declined** to an **Archive** tab and delete them from the tracker. Do this no more than once or twice a year.
- **Triage rhythm:** review New rows at least weekly, and update Response / decision so committees are never looking at silence.

## Out Of Scope For Now

Linking feedback rows to repo branches or issues is deliberately not in v1 — the Status column covers the lifecycle. If the volume justifies it later, add a **Linked work** column (L is a natural slot, pushing Owner right) and paste branch names there.
