# Committee Feedback Tracker Setup Guide

How to build and run the committee feedback tracker as a Google Sheet. The sheet lives outside this repo; this guide and the import file are the repo's copy of the template.

**Who this is for:** the person maintaining the sheet on behalf of the app team. Committee members only need the share link and the "How to use" tab.

**Time to set up:** about 15 minutes.

## What You Will Build

A Google Sheet with three tabs:

| Tab | Purpose | Who edits it |
| --- | --- | --- |
| How to use | Plain-language instructions for committee members | App team only |
| Feedback tracker | The main sheet — one row per piece of feedback | Committees fill columns A–H; app team fills columns I–M |
| Lists | Dropdown values (committees, app areas, statuses) | App team only |

## Step 1: Create The Sheet And Import The Tracker Tab

1. Go to [sheets.new](https://sheets.new) and create a blank spreadsheet.
2. Name it (suggested: **ITC Web App — Committee Feedback**).
3. Rename the default tab (`Sheet1`) to **Feedback tracker**.
4. In the repo, open `docs/feedback-tracker-import.csv` and copy the header row.
5. Back in the sheet, select cell `A1`, paste, then check each column landed in its own cell (paste as **Paste special → Values only** if formatting looks off).

You should now have 13 headers across row 1:

`ID` · `Date submitted` · `Committee` · `Submitted by` · `App area` · `Summary (one line)` · `Details` · `Committee importance` · `Status` · `Priority (app team)` · `Owner` · `Response / decision` · `Date updated`

6. Select row 1 and apply **View → Freeze → 1 row** so headers stay visible when scrolling.

## Step 2: Create The Lists Tab

Add a new tab named **Lists**. Enter these values, one list per column, starting at row 2 (row 1 holds the labels):

| A: Committee | B: App area | C: Status | D: Priority | E: Committee importance |
| --- | --- | --- | --- | --- |
| Leadership | Home | New | Critical | Critical |
| Events | Schedule & Booking | Under review | High | Important |
| Media & Comms | Giving / Shop | Accepted | Medium | Nice to have |
| Giving | Profile | In progress | Low | |
| Facilities | Community | Shipped | | |
| | Notifications | Declined | | |
| | Admin | Deferred | | |
| | Other | | | |

> The committee names above are placeholders. Rename them to match your actual committees before sharing the sheet. Leave a few blank rows under each list for growth — the validation ranges below already include them.

## Step 3: Add Dropdowns To The Tracker Tab

For each column below, select the range on **Feedback tracker**, then **Data → Data validation → Add rule**:

| Column | Range | Criteria | Values come from |
| --- | --- | --- | --- |
| C — Committee | `C2:C500` | Dropdown (from a range) | `=Lists!$A$2:$A$20` |
| E — App area | `E2:E500` | Dropdown (from a range) | `=Lists!$B$2:$B$20` |
| H — Committee importance | `H2:H500` | Dropdown (from a range) | `=Lists!$E$2:$E$20` |
| I — Status | `I2:I500` | Dropdown (from a range) | `=Lists!$C$2:$C$20` |
| J — Priority | `J2:J500` | Dropdown (from a range) | `=Lists!$D$2:$D$20` |

Set every rule to **Reject the input** when invalid so typos can't bypass the dropdowns.

Optional but recommended:

- **ID (column A):** paste `=IF(B2="","","FB-"&TEXT(ROW()-1,"000"))` into `A2` and fill down to `A500`. Each row numbers itself only once it has a submission date, so empty rows stay blank (`FB-001`, `FB-002`, …).
- **Date submitted (column B):** add a validation rule of type **is valid date**.
- **Date updated (column M):** same — **is valid date**.

## Step 4: Add The How To Use Tab

Add a tab named **How to use**, positioned first. Paste this text (one block per row is fine — this tab is for reading, not formatting):

> **How to submit feedback**
>
> 1. Go to the **Feedback tracker** tab.
> 2. Use the first empty row. Fill in columns A–H only — the grey columns (I onwards) are for the app team.
> 3. One piece of feedback per row. If you have two separate suggestions, use two rows.
> 4. Write the **Summary** as one short sentence a stranger could understand. Put detail, context, and "what we expected vs. what happened" in **Details**.
> 5. **Committee importance** is your committee's honest view: *Critical* = blocks your committee from doing its work, *Important* = clearly worth doing, *Nice to have* = good idea, no urgency.
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

1. On **Feedback tracker**, select columns `I` through `M` (click the column I header, shift-click column M).
2. **Data → Protect sheets and ranges.**
3. Add a description: **App team only — do not edit**.
4. Click **Set permissions**, choose **Restrict who can edit this range**, and select **Only you** (add co-maintainers by email if you have them).
5. Repeat for the **Lists** tab: protect the whole sheet the same way.

Committee members will now see those cells as locked. They keep full edit access to columns A–H.

## Step 6: Colour-Code Status

On **Feedback tracker**, select `I2:I500`, then **Format → Conditional formatting**. Add one rule per status using **Format cells if → Text contains**:

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
| E | App area | Committee | Dropdown from Lists |
| F | Summary (one line) | Committee | One short sentence |
| G | Details | Committee | Full context, expected vs. actual |
| H | Committee importance | Committee | Critical / Important / Nice to have |
| I | Status | App team | Lifecycle — see below |
| J | Priority (app team) | App team | The app team's own priority call |
| K | Owner | App team | Who is actioning it |
| L | Response / decision | App team | Outcome and reasoning, so committees see why |
| M | Date updated | App team | Last time the row changed |

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

- **Adding a committee or app area:** edit the Lists tab; dropdowns update automatically (the validation ranges already cover rows 2–20).
- **Archiving:** when the tracker gets long, copy rows with Status **Shipped** or **Declined** to an **Archive** tab and delete them from the tracker. Do this no more than once or twice a year.
- **Triage rhythm:** review New rows at least weekly, and update Response / decision so committees are never looking at silence.

## Out Of Scope For Now

Linking feedback rows to repo branches or issues is deliberately not in v1 — the Status column covers the lifecycle. If the volume justifies it later, add a **Linked work** column (K is a natural slot, pushing Owner right) and paste branch names there.
