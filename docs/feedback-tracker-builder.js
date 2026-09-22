/**
 * ITC Web App — Committee Feedback Tracker builder (Apps Script).
 *
 * Builds the whole tracker from docs/committee-feedback-tracker.md:
 * three tabs (How to use, Feedback tracker, Lists), headers, self-numbering
 * IDs, all six dropdown validations wired to the Lists tab, status colours,
 * and protection over the app-team columns and the Lists tab.
 *
 * How to run:
 *   1. Go to sheets.new → Extensions → Apps Script.
 *   2. Delete the placeholder code, paste this entire file, and save.
 *   3. Run buildFeedbackTracker from the toolbar and approve the
 *      one-time permission prompt.
 *
 * Re-running rebuilds every tab from scratch and wipes any feedback rows.
 * Use it once before go-live; afterwards, edit the Lists tab directly
 * for small value changes.
 */

const LAST_ROW = 500;

const HEADERS = [
  'ID', 'Date submitted', 'Committee', 'Submitted by',
  'Screen/Flow', 'Feedback type', 'Description', 'Screenshot',
  'Committee importance', 'Status', 'Priority (app team)', 'Owner',
  'Response / decision', 'Date updated',
];

// Column A ships empty on purpose — add your committee names after the build.
const COMMITTEES = [];

// Matches the app's screens and flows on main. Update when the app changes.
const SCREENS = [
  'Home', 'Schedule', 'Activity details', 'Booking flow', 'Checkout & payment',
  'Receipt', 'HYROX Cycle', 'HYROX Registration', 'Giving', 'Community',
  'Profile — overview', 'Profile — Bookings & History',
  'Profile — Membership Details', 'Profile — Indemnity / waiver',
  'Profile — Payments & Receipts', 'Profile — Privacy & Notifications',
  'Notifications', 'Sign in / magic link', 'Membership application',
  'Admin — members & approvals', 'Admin — activities',
  'Admin — giving campaigns', 'Something else',
];

const FEEDBACK_TYPES = [
  'Not working (bug)', 'Looks wrong (visual)', 'Wording / unclear text',
  'Confusing flow', 'Feature suggestion', 'Question',
];

const STATUSES = ['New', 'Under review', 'Accepted', 'In progress', 'Shipped', 'Declined', 'Deferred'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const IMPORTANCE = ['Critical', 'Important', 'Nice to have'];

const STATUS_COLORS = {
  'New': '#E0E0E0',
  'Under review': '#FFF2CC',
  'Accepted': '#CFE2FF',
  'In progress': '#FCE5CD',
  'Shipped': '#D9EAD3',
  'Declined': '#F4CCCC',
  'Deferred': '#D9D2E9',
};

const HOW_TO_USE = [
  ['HOW TO SUBMIT FEEDBACK', true],
  ['', false],
  ['1. Go to the Feedback tracker tab.', false],
  ['2. Use the first empty row. Fill in columns A–I only — the grey columns (J onwards) are for the app team.', false],
  ['3. One piece of feedback per row. If you have two separate suggestions, use two rows.', false],
  ['4. Pick the Screen/Flow closest to where the issue is, then a Feedback type. In Description, write what you saw, where, and what you expected — a stranger should understand it without asking you anything.', false],
  ['5. If you can, put a screenshot in the Screenshot cell: select the cell and press Ctrl+V (⌘V on Mac), or use Insert → Image → Image in cell. One screenshot per row is plenty.', false],
  ['6. Committee importance is your committee\u2019s honest view: Critical = blocks your committee from doing its work, Important = clearly worth doing, Nice to have = good idea, no urgency.', false],
  ['', false],
  ['WHAT HAPPENS NEXT', true],
  ['', false],
  ['• The app team reviews new rows regularly and sets a Status and a Response so you can see the outcome and the reason.', false],
  ['• Check back on your rows to see progress. The sheet is the single source of truth — there are no email notifications.', false],
  ['• Please don\u2019t edit or delete other committees\u2019 rows, and don\u2019t fill in the app-team columns.', false],
  ['', false],
  ['GOOD FEEDBACK LOOKS LIKE', true],
  ['', false],
  ['• "On Schedule, the Wednesday session shows a Book button, but it\u2019s free — should it say Add to Calendar instead?" (specific, actionable)', false],
  ['• "The app is confusing." (too vague — say what, where, and what you expected)', false],
];

function buildFeedbackTracker() {
  const ss = SpreadsheetApp.getActive();
  buildTrackerTab(ss);
  buildListsTab(ss);
  applyValidation(ss);
  applyStatusColors();
  buildHowToUseTab(ss);
  removePlaceholderSheet(ss);
  finish((message) => {
    try {
      SpreadsheetApp.getUi().alert(message);
    } catch (e) {
      Logger.log(message);
    }
  });
}

function buildTrackerTab(ss) {
  const old = ss.getSheetByName('Feedback tracker');
  if (old) ss.deleteSheet(old);
  const sheet = ss.insertSheet('Feedback tracker');

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  // Self-numbering IDs: each row numbers itself only once it has a date.
  const idFormulas = [];
  for (let r = 2; r <= LAST_ROW; r++) {
    idFormulas.push([`=IF(B${r}="","","FB-"&TEXT(${r - 1},"000"))`]);
  }
  sheet.getRange(2, 1, idFormulas.length, 1).setFormulas(idFormulas);

  // Readable widths + a visible boundary around the app-team zone (J–N).
  sheet.setColumnWidth(5, 190);   // Screen/Flow
  sheet.setColumnWidth(6, 160);   // Feedback type
  sheet.setColumnWidth(7, 340);   // Description
  sheet.setColumnWidth(8, 170);   // Screenshot
  sheet.setColumnWidth(11, 140);  // Priority (app team)
  sheet.setColumnWidth(13, 300);  // Response / decision
  sheet.getRange('J1:N' + LAST_ROW).setBackground('#F3F3F3');
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#E8EAED');
}

function buildListsTab(ss) {
  const old = ss.getSheetByName('Lists');
  if (old) ss.deleteSheet(old);
  const sheet = ss.insertSheet('Lists');
  const columns = [
    ['Committee', COMMITTEES],
    ['Screen/Flow', SCREENS],
    ['Feedback type', FEEDBACK_TYPES],
    ['Status', STATUSES],
    ['Priority', PRIORITIES],
    ['Committee importance', IMPORTANCE],
  ];
  columns.forEach(([label, values], i) => {
    sheet.getRange(1, i + 1).setValue(label);
    if (values.length) {
      sheet.getRange(2, i + 1, values.length, 1).setValues(values.map((v) => [v]));
    }
  });
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
  protectFromCommittees(sheet, 'Lists — app team only');
}

function applyValidation(ss) {
  const sheet = ss.getSheetByName('Feedback tracker');
  const dropdownRules = [
    ['C', 'Lists!$A$2:$A$20'],   // Committee
    ['E', 'Lists!$B$2:$B$40'],   // Screen/Flow
    ['F', 'Lists!$C$2:$C$20'],   // Feedback type
    ['I', 'Lists!$F$2:$F$20'],   // Committee importance
    ['J', 'Lists!$D$2:$D$20'],   // Status
    ['K', 'Lists!$E$2:$E$20'],   // Priority
  ];
  dropdownRules.forEach(([col, source]) => {
    sheet.getRange(`${col}2:${col}${LAST_ROW}`).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInRange(ss.getRange(source), true)
        .setAllowInvalid(false)
        .setHelpText('Pick a value from the dropdown.')
        .build()
    );
  });
  const dateValidation = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .build();
  sheet.getRange(`B2:B${LAST_ROW}`).setDataValidation(dateValidation);
  sheet.getRange(`N2:N${LAST_ROW}`).setDataValidation(dateValidation);
  protectFromCommittees(sheet, 'App team only — do not edit');
}

// Protects only the J–N zone; the rest of the tab keeps the sheet default.
function protectFromCommittees(sheet, description) {
  const range = sheet.getName() === 'Lists'
    ? sheet.getRange(`A1:F40`)
    : sheet.getRange(`J1:N${LAST_ROW}`);
  const protection = range.protect();
  protection.setDescription(description);
  const me = Session.getEffectiveUser();
  protection.removeEditors(
    protection.getEditors().filter((user) => user.getEmail() !== me.getEmail())
  );
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function applyStatusColors() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Feedback tracker');
  const statusRange = sheet.getRange(`J2:J${LAST_ROW}`);
  const rules = Object.entries(STATUS_COLORS).map(([status, color]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(color)
      .setRanges([statusRange])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
}

function buildHowToUseTab(ss) {
  const old = ss.getSheetByName('How to use');
  if (old) ss.deleteSheet(old);
  const sheet = ss.insertSheet('How to use');
  const rows = HOW_TO_USE.map(([text]) => [text]);
  sheet.getRange(1, 1, rows.length, 1).setValues(rows);
  sheet.setColumnWidth(1, 720);
  const text = sheet.getRange(1, 1, HOW_TO_USE.length, 1);
  text.setWrap(true).setFontSize(11).setVerticalAlignment('top');
  HOW_TO_USE.forEach(([, bold], i) => {
    if (bold) sheet.getRange(i + 1, 1).setFontWeight('bold');
  });
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1); // How to use reads first when the sheet opens.
}

function removePlaceholderSheet(ss) {
  const placeholder = ss.getSheetByName('Sheet1');
  if (placeholder && ss.getSheets().length > 1) ss.deleteSheet(placeholder);
}

function finish(notify) {
  SpreadsheetApp.flush();
  notify(
    'Feedback tracker built.\n\nRemaining manual steps (Step 7 in ' +
    'docs/committee-feedback-tracker.md):\n' +
    '1. Share the sheet with committee leads as Editors.\n' +
    '2. Tools → Notification rules → get emailed when changes are made.\n' +
    '3. Add your committee names on the Lists tab.'
  );
}
