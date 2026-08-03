// ==========================================================================
// ITC prototype — view renderers.
// Each view returns an HTML string. app.js owns the router, event
// delegation, and DOM mounting. Views read from the store but never mutate
// it directly (mutations live behind data-action handlers in app.js).
// ==========================================================================

import * as store from "./store.js";
import {
  LEADERS,
  CULTURE,
  findSession,
  sessionsInRange,
  mondayOf,
  addDays,
  todayLocal,
  isoDate,
  fmtDate,
  fmtDateLong,
  fmtTime,
  fmtMoney,
  initials,
} from "./data.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const todayISO = () => isoDate(todayLocal());

// --- Shared fragments ---------------------------------------------------------

function badgeFor(s) {
  return s.kind === "free"
    ? `<span class="badge free">Free · No booking</span>`
    : `<span class="badge paid">Paid · ${fmtMoney(s.price)}</span>`;
}

function spotsLabel(s) {
  const spots = store.spotsLeft(s);
  if (spots <= 0) return `<span class="badge neutral">Full</span>`;
  return `<span class="spots">${spots} spot${spots === 1 ? "" : "s"} left</span>`;
}

function sessionRow(s, { past, showDate = true, highlight } = {}) {
  // A session the signed-in member has already booked shows a "Booked"
  // badge instead of price/spots, so Home, Schedule and the booking itself
  // all tell the same story.
  const user = store.currentUser();
  const booked = user ? store.userBookingFor(user.id, s.id) : null;
  const end = booked
    ? `<span class="badge free">Booked</span>`
    : s.kind === "free"
      ? `<span class="badge free">Free</span><span class="spots">Just show up</span>`
      : `${store.spotsLeft(s) > 0 ? `<span class="badge paid">${fmtMoney(s.price)}</span>` : ""}${spotsLabel(s)}`;
  return `
    <a class="session-row ${past ? "is-past" : ""}" href="#/activity/${s.id}">
      <time>${fmtTime(s.time)}<small>${esc(s.category)}</small></time>
      <div>
        <h3>${esc(s.name)}</h3>
        <p>${esc(fmtDate(s.date))} · ${esc(s.location)}</p>
      </div>
      <div class="row-end">${end}</div>
    </a>`;
}

function pendingBanner() {
  return `
    <div class="banner warn mt16">
      <span class="kicker">Application under review</span>
      <p>An ITC leader will review your application. Until then you can browse free activities, leaders and culture — booking unlocks once you’re approved.</p>
    </div>`;
}

function memberOnlyNote(text = "Approved members see more here.") {
  return `<div class="locked-note">🔒 ${esc(text)}</div>`;
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 15.3c2.6.3 4.4 1.7 5 4.7"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.4c0 4.4 3 7.6 7 9.8 4-2.2 7-5.4 7-9.8V5.8Z"/><path d="m9 11.5 2.2 2.2L15.5 9"/></svg>',
  check: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>',
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
};

// --- Bottom nav / avatar --------------------------------------------------------

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: "home", href: "#/home" },
  { key: "schedule", label: "Schedule", icon: "calendar", href: "#/schedule" },
  { key: "community", label: "Community", icon: "people", href: "#/community" },
  { key: "account", label: "Account", icon: "user", href: "#/account" },
  { key: "admin", label: "Admin", icon: "shield", href: "#/admin", roles: ["admin", "superadmin"] },
];

export function navHTML(routeKey, user) {
  const isAdmin = user && ["admin", "superadmin"].includes(user.role);
  return NAV_ITEMS.filter((i) => !i.roles || isAdmin)
    .map(
      (i) => `
      <a href="${i.href}" class="${i.key === routeKey ? "active" : ""}" ${i.key === routeKey ? 'aria-current="page"' : ""}>
        ${ICONS[i.icon]}<span>${i.label}</span>
      </a>`
    )
    .join("");
}

export function avatarHTML(user) {
  return user ? initials(user.fullName) : ICONS.user;
}

// ============================================================================
// Views
// ============================================================================

export function viewHome() {
  const user = store.currentUser();
  const next = store.nextSession();
  const upcoming = store.upcomingSessions(7);
  const name = user ? esc(user.preferredName || user.fullName.split(" ")[0]) : null;

  // "My week" shows a signed-in member only the sessions they've booked
  // (free ones included); the full week stays discoverable via Schedule.
  let rows = upcoming.slice(0, 3);
  let emptyMsg = "No upcoming sessions — check back soon.";
  if (user && user.status === "approved") {
    const bookedIds = new Set(
      store
        .bookingsForUser(user.id)
        .filter((b) => b.status === "confirmed" && b.snapshot.dateISO >= todayISO())
        .map((b) => b.sessionId)
    );
    rows = upcoming.filter((s) => bookedIds.has(s.id));
    emptyMsg = `Nothing booked this week yet. <a href="#/schedule" style="color:var(--accent)">Find a session →</a>`;
  }

  const hero = next
    ? `
    <a class="card hero-card" href="#/activity/${next.id}" style="display:block;text-decoration:none">
      <img class="photo" src="${next.photo}" alt="">
      <div class="card-body">
        <span class="kicker">Next up · ${esc(fmtDate(next.date))} · ${fmtTime(next.time)}</span>
        <h3>${esc(next.name)}</h3>
        <p class="hero-meta">${esc(next.location)} · ${next.durationMin} min</p>
        <div class="mt8">${badgeFor(next)}${next.kind === "paid" ? ` ${spotsLabel(next)}` : ""}</div>
        <span class="btn mt16">${next.kind === "free" ? "View details" : `View & book · ${fmtMoney(next.price)}`}</span>
      </div>
    </a>`
    : `<div class="empty">No upcoming sessions — check back soon.</div>`;

  const guest = !user
    ? `
    <div class="card mt24"><div class="card-body">
      <span class="kicker">New to ITC?</span>
      <h3 class="mt8">Everyone is welcome</h3>
      <p class="hero-meta">Free activities are open to all — just show up. Membership is free too; an ITC leader approves every application before paid booking unlocks.</p>
      <div class="btn-row two">
        <a class="btn" href="#/apply">Apply to join</a>
        <a class="btn ghost" href="#/account">Sign in</a>
      </div>
    </div></div>`
    : "";

  return `
    <div class="kicker">${esc(fmtDateLong(todayLocal()))} · Hong Kong</div>
    <h1 class="display">${name ? `Good to see you, ${name}.` : "Train together."}</h1>
    ${user && user.status === "pending" ? pendingBanner() : ""}
    ${hero}
    ${guest}
    <div class="section-head">
      <h2>This week</h2>
      <a href="#/schedule">Full schedule →</a>
    </div>
    <div class="session-list">
      ${rows.length
        ? rows.map((s, i) => sessionRow(s, { highlight: i === 0 })).join("")
        : `<div class="empty">${emptyMsg}</div>`}

    </div>
    <div class="section-head"><h2>The Club</h2><a href="#/community">More →</a></div>
    <a class="card" href="#/community" style="display:block;text-decoration:none">
      <img class="photo" src="../assets/itc/community.webp" alt="ITC community">
      <div class="card-body">
        <h3>More than a workout</h3>
        <p class="hero-meta">Meet the leaders and read what the club stands for.</p>
      </div>
    </a>`;
}

// --- Schedule ---------------------------------------------------------------------

export const scheduleState = {
  weekOffset: 0,
  selected: null, // ISO date
  filter: "all",
};

const FILTERS = [
  ["all", "All"],
  ["free", "Free"],
  ["paid", "Paid"],
  ["Run", "Run"],
  ["Strength", "Strength"],
  ["HYROX", "HYROX"],
  ["Water", "Water"],
];

function matchesFilter(s, filter) {
  if (filter === "all") return true;
  if (filter === "free" || filter === "paid") return s.kind === filter;
  return s.category === filter;
}

export function viewSchedule() {
  const t = todayLocal();
  const monday = addDays(mondayOf(t), scheduleState.weekOffset * 7);
  if (!scheduleState.selected) {
    scheduleState.selected = scheduleState.weekOffset === 0 ? isoDate(t) : isoDate(monday);
  }
  const weekSessions = sessionsInRange(store.activities(), monday, 7);
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const cells = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const iso = isoDate(d);
    const has = weekSessions.some((s) => s.dateISO === iso);
    return `
      <button type="button" class="day-cell ${iso === scheduleState.selected ? "active" : ""} ${has ? "has-sessions" : ""}"
        data-action="sched-day" data-date="${iso}">
        ${dayNames[i]}<strong>${d.getDate()}</strong><span class="dot"></span>
      </button>`;
  }).join("");

  const list = weekSessions
    .filter((s) => s.dateISO === scheduleState.selected)
    .filter((s) => matchesFilter(s, scheduleState.filter));

  const listHTML = list.length
    ? list.map((s) => sessionRow(s, { past: s.dateISO < todayISO() })).join("")
    : `<div class="empty">No ${scheduleState.filter === "all" ? "" : esc(scheduleState.filter) + " "}sessions on ${esc(fmtDate(scheduleState.selected))}.</div>`;

  return `
    <div class="kicker">Week of ${esc(fmtDateLong(monday))}</div>
    <h1 class="display">Find your session.</h1>
    <div class="week-strip">${cells}</div>
    <div class="week-nav">
      <button type="button" data-action="sched-week" data-dir="-1">← Prev week</button>
      <button type="button" data-action="sched-week" data-dir="1">Next week →</button>
    </div>
    <div class="filter-row">
      ${FILTERS.map(
        ([key, label]) => `
        <button type="button" class="chip ${scheduleState.filter === key ? "active" : ""}"
          data-action="sched-filter" data-filter="${key}">${label}</button>`
      ).join("")}
    </div>
    <div class="session-list">${listHTML}</div>
    <p class="muted small mt16">Free sessions are open to everyone — no booking, no capacity. Paid sessions (HYROX) are booked and paid in the app by approved members.</p>`;
}

// --- Activity detail ------------------------------------------------------------------

export function viewActivity(sessionId) {
  const s = findSession(store.activities(), sessionId);
  if (!s) return viewNotFound("That session doesn’t exist.");

  const user = store.currentUser();
  const isMember = user && user.status === "approved";
  const past = s.dateISO < todayISO();
  const spots = store.spotsLeft(s);
  const booking = user ? store.userBookingFor(user.id, s.id) : null;

  let actionBlock = "";
  if (past) {
    actionBlock = `<div class="banner mt16"><p>This session has already happened. See you at the next one.</p></div>`;
  } else if (s.kind === "free") {
    // Product rule: free activities never show booking, capacity or checkout.
    actionBlock = `
      <div class="free-banner">
        ${ICONS.pin}
        <div><strong>Free · No booking needed.</strong><br><span class="muted small">Everyone is welcome — just show up${s.id.startsWith("wnt") ? " and look for the lime ITC flag" : ""}.</span></div>
      </div>
      <div class="btn-row two">
        <button class="btn" type="button" data-action="ics" data-session="${s.id}">Add to calendar</button>
        <a class="btn ghost" href="${mapsHref(s)}" target="_blank" rel="noopener">Get directions</a>
      </div>`;
  } else if (booking) {
    actionBlock = `
      <div class="banner mt16">
        <span class="kicker">You’re booked</span>
        <p>Booking ref ${esc(booking.id.toUpperCase())} · paid ${fmtMoney(s.price)}.</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="#/booking/${booking.id}">Manage booking</a>
      </div>`;
  } else if (spots <= 0) {
    actionBlock = `<button class="btn mt16" disabled>Session full</button>`;
  } else if (isMember) {
    actionBlock = `
      <a class="btn mt16" href="#/checkout/${s.id}">Book & pay · ${fmtMoney(s.price)}</a>
      <p class="muted small mt8 center">Paid per session · receipt issued instantly · manage from your account</p>`;
  } else if (user && user.status === "pending") {
    actionBlock = `
      <div class="banner warn mt16">
        <span class="kicker">Booking locked</span>
        <p>Paid sessions unlock once an ITC leader approves your membership.</p>
      </div>`;
  } else if (user && user.status === "declined") {
    actionBlock = `
      <div class="banner mt16"><p>Your application wasn’t approved. Contact an ITC leader if you think this is a mistake.</p></div>`;
  } else {
    actionBlock = `
      <div class="banner mt16">
        <span class="kicker">Members only</span>
        <p>This is a paid member session. Apply for free membership — a leader approves every application — then book and pay here.</p>
      </div>
      <div class="btn-row two">
        <a class="btn" href="#/apply">Apply to join</a>
        <a class="btn ghost" href="#/account">Sign in</a>
      </div>`;
  }

  const metaPaid =
    s.kind === "paid"
      ? `
      <div><small>Price</small><strong>${fmtMoney(s.price)} / session</strong></div>
      <div><small>Places</small><strong>${spots <= 0 ? "Full" : `${spots} of ${s.capacity} left`}</strong></div>`
      : "";

  const attendees =
    s.kind === "paid"
      ? isMember
        ? `
      <div class="section-head"><h2>Who’s coming</h2></div>
      <div class="attendees">${store.attendeesFor(s).map((n) => `<span>${esc(n)}</span>`).join("")}</div>`
        : `<div class="section-head"><h2>Who’s coming</h2></div>${memberOnlyNote("Member-only: the attendee list is visible after approval.")}`
      : "";

  const leaderNote = s.memberNote
    ? isMember
      ? `<div class="banner mt16"><span class="kicker">Leader note</span><p>${esc(s.memberNote)}</p></div>`
      : memberOnlyNote("Leader notes (meet points, routes, kit) are shared with approved members.")
    : "";

  return `
    <a class="back-link" href="#/schedule">← Schedule</a>
    <img class="detail-photo" src="${s.photo}" alt="">
    <div class="mt16">${badgeFor(s)}</div>
    <h1 class="display sm">${esc(s.name)}</h1>
    <div class="meta-grid">
      <div><small>When</small><strong>${esc(fmtDate(s.date))}<br>${fmtTime(s.time)}</strong></div>
      <div><small>Where</small><strong>${esc(s.location)}</strong></div>
      <div><small>Length</small><strong>${s.durationMin} min</strong></div>
      ${metaPaid}
    </div>
    <p class="subcopy mt16">${esc(s.blurb)}</p>
    ${leaderNote}
    ${actionBlock}
    ${attendees}`;
}

function mapsHref(s) {
  const q = s.mapsQuery || s.location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// --- Community --------------------------------------------------------------------------

export function viewCommunity() {
  return `
    <div class="kicker">Community</div>
    <h1 class="display">More than a workout.</h1>
    <p class="subcopy mt8">Island Training Club is a Hong Kong training community with a Christian foundation — open to everyone.</p>
    <div class="section-head"><h2>Leaders</h2></div>
    <div class="stack">
      ${LEADERS.map(
        (l) => `
        <div class="card leader-card">
          <img src="${l.photo}" alt="${esc(l.name)}">
          <div class="card-body">
            <h3>${esc(l.name)}</h3>
            <div class="role">${esc(l.role)}</div>
            <p>${esc(l.bio)}</p>
          </div>
        </div>`
      ).join("")}
    </div>
    <div class="section-head"><h2>Culture</h2></div>
    <div class="card"><div class="card-body prose">
      ${CULTURE.map((c) => `<h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>`).join("")}
    </div></div>
    <p class="muted small mt16">Community copy is draft placeholder text for review with ITC leadership.</p>`;
}

// --- Account ---------------------------------------------------------------------------------

export function viewAccount() {
  const user = store.currentUser();
  if (!user) return accountVisitor();
  if (user.status === "pending") return accountPending(user);
  if (user.status === "declined") return accountDeclined(user);
  return accountMember(user);
}

function accountVisitor() {
  return `
    <div class="kicker">Account</div>
    <h1 class="display">Join the club.</h1>
    <p class="subcopy mt8">Membership is free. An ITC leader approves every application — approval unlocks paid booking and member content.</p>
    <div class="card mt24"><div class="card-body">
      <h3>Sign in</h3>
      <form id="form-signin" novalidate>
        <div class="field">
          <label for="signin-email">Email</label>
          <input id="signin-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div id="signin-error"></div>
        <button class="btn mt16" type="submit">Sign in</button>
      </form>
      <p class="muted small mt16">Prototype: there is no password — sign in with a seeded email, or use a one-tap demo profile.</p>
      <div class="btn-row">
        <button class="btn ghost sm" type="button" data-action="demo-signin" data-role="member">Demo · Continue as member (Ava)</button>
        <button class="btn ghost sm" type="button" data-action="demo-signin" data-role="admin">Demo · Continue as admin (Dan)</button>
        <button class="btn ghost sm" type="button" data-action="demo-signin" data-role="superadmin">Demo · Continue as super admin (Isaac)</button>
      </div>
    </div></div>
    <div class="card mt16"><div class="card-body">
      <h3>Not a member yet?</h3>
      <p class="hero-meta">Apply in two minutes. You’ll keep browsing access while a leader reviews your application.</p>
      <a class="btn mt16" href="#/apply">Apply for membership</a>
    </div></div>`;
}

function accountPending(user) {
  return `
    <div class="kicker">Account · ${esc(user.email)}</div>
    <h1 class="display">Thanks, ${esc(user.preferredName || user.fullName.split(" ")[0])}.</h1>
    ${pendingBanner()}
    <div class="card mt16"><div class="card-body">
      <h3>Your application</h3>
      <div class="receipt-lines">
        <div class="line"><span>Name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Phone</span><strong>${esc(user.phone)}</strong></div>
        <div class="line"><span>Emergency contact</span><strong>${esc(user.emergencyName)} · ${esc(user.emergencyPhone)}</strong></div>
        <div class="line"><span>Heard about ITC</span><strong>${esc(user.heard)}</strong></div>
        ${user.donorId ? `<div class="line"><span>Donor ID</span><strong>${esc(user.donorId)}</strong></div>` : ""}
        <div class="line"><span>Photo consent</span><strong>${user.mediaConsent ? "Yes" : "No"}</strong></div>
      </div>
      <p class="muted small mt16">Want to see the approval side? Sign out, then use the admin demo profile — your application will be waiting in the queue.</p>
    </div></div>
    <div class="btn-row">
      <a class="btn ghost" href="#/schedule">Browse the schedule</a>
      <button class="btn danger" type="button" data-action="signout">Sign out</button>
    </div>`;
}

function accountDeclined(user) {
  return `
    <div class="kicker">Account · ${esc(user.email)}</div>
    <h1 class="display">Application update.</h1>
    <div class="banner warn mt16">
      <span class="kicker">Not approved</span>
      <p>Your membership application wasn’t approved this time. Please speak to an ITC leader at any free session if you’d like to talk it through.</p>
    </div>
    <div class="btn-row">
      <a class="btn ghost" href="#/schedule">Browse free activities</a>
      <button class="btn danger" type="button" data-action="signout">Sign out</button>
    </div>`;
}

function accountMember(user) {
  const bookings = store.bookingsForUser(user.id);
  const history = bookings.filter((b) => !(b.status === "confirmed" && b.snapshot.dateISO >= todayISO()));
  const receipts = store.receiptsForUser(user.id);
  const isAdmin = ["admin", "superadmin"].includes(user.role);

  const roleBadge = {
    member: '<span class="badge free">Member</span>',
    admin: '<span class="badge paid">Admin</span>',
    superadmin: '<span class="badge warn">Super admin</span>',
  }[user.role];

  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.snapshot.dateISO >= todayISO());

  const bookingCard = (b) => {
    const s = b.snapshot;
    const live = b.status === "confirmed" && s.dateISO >= todayISO();
    const status =
      b.status === "cancelled"
        ? '<span class="badge danger">Cancelled</span>'
        : b.status === "attended"
          ? '<span class="badge neutral">Attended</span>'
          : '<span class="badge free">Booked</span>';
    return `
      <div class="card booking-card"><div class="card-body">
        <header>
          <div>
            <div class="kicker dim" style="margin-top:0">${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</div>
            <h3 class="mt8">${esc(s.name)}</h3>
          </div>
          ${status}
        </header>
        <p>${esc(s.location)} · ${s.durationMin} min · paid ${fmtMoney(s.price)}</p>
        <div class="actions">
          <a class="btn ghost sm" href="#/booking/${b.id}">${live ? "Manage" : "Details"}</a>
        </div>
      </div></div>`;
  };

  return `
    <div class="kicker">Profile</div>
    <div class="mt16">${roleBadge}</div>

    ${isAdmin ? `<a class="btn ghost mt16" href="#/admin">Open admin tools →</a>` : ""}

    <div class="section-head"><h2>Membership details</h2></div>
    <div class="card"><div class="card-body">
      <div class="receipt-lines">
        <div class="line"><span>Full name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Preferred name</span><strong>${esc(user.preferredName)}</strong></div>
        <div class="line"><span>Email</span><strong>${esc(user.email)}</strong></div>
        <div class="line"><span>Member since</span><strong>${new Date(user.appliedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short", year: "numeric" })}</strong></div>
        <div class="line"><span>Phone / WhatsApp</span><strong>${esc(user.phone)}</strong></div>
        <div class="line"><span>Emergency contact</span><strong>${esc(user.emergencyName)} · ${esc(user.emergencyPhone)}</strong></div>
      </div>
      <p class="muted small mt16">Profile editing is stubbed in the prototype — fields come from the application form.</p>
    </div></div>

    <div class="section-head"><h2>Donor profile</h2></div>
    <div class="card"><div class="card-body">
      <div class="receipt-lines">
        <div class="line"><span>Donor ID</span><strong>${user.donorId ? esc(user.donorId) : "Not provided"}</strong></div>
      </div>
      ${
        user.donorId
          ? ""
          : `
        <form id="form-donor-id" class="mt16" novalidate>
          <div class="field">
            <label for="donor-id">Add your Donor ID</label>
            <input id="donor-id" name="donorId" placeholder="e.g. IECC-10028" autocomplete="off">
            <div class="hint">Left this blank or wrote “Not applicable” at sign-up? Add it here any time — leaders use it to match your giving to your IECC donor record.</div>
          </div>
          <div id="donor-error"></div>
          <button class="btn ghost sm" type="submit">Save Donor ID</button>
        </form>`
      }
    </div></div>

    <div class="section-head"><h2>Payments &amp; receipts</h2></div>

    ${
      receipts.length
        ? `<div class="session-list">${receipts
            .map(
              (r) => `
            <a class="session-row" href="#/receipt/${r.id}">
              <time>${new Date(r.issuedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" })}<small>${esc(r.number)}</small></time>
              <div><h3>${esc(r.line)}</h3><p>Card •••• ${esc(r.cardLast4)}</p></div>
              <div class="row-end"><strong>${fmtMoney(r.amount)}</strong>${
                r.status === "refunded" ? '<span class="badge danger">Refunded</span>' : '<span class="badge neutral">Paid</span>'
              }</div>
            </a>`
            )
            .join("")}</div>`
        : `<div class="empty">No payments yet.</div>`
    }

    <div class="section-head"><h2>History</h2></div>
    ${history.length ? history.map(bookingCard).join("") : `<div class="empty">Past sessions will appear here.</div>`}

    <div class="section-head"><h2>Profile</h2></div>
    <div class="card"><div class="card-body">
      <div class="receipt-lines">
        <div class="line"><span>Full name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Preferred name</span><strong>${esc(user.preferredName)}</strong></div>
        <div class="line"><span>Phone / WhatsApp</span><strong>${esc(user.phone)}</strong></div>
        <div class="line"><span>Emergency contact</span><strong>${esc(user.emergencyName)} · ${esc(user.emergencyPhone)}</strong></div>
        <div class="line"><span>Photo consent</span><strong>${user.mediaConsent ? "Yes" : "No"}</strong></div>
      </div>
      <p class="muted small mt16">Profile editing is stubbed in the prototype — fields come from the application form.</p>
    </div></div>

    <div class="btn-row">
      <button class="btn ghost" type="button" data-action="signout">Sign out</button>
      <button class="btn danger sm" type="button" data-action="reset-demo">Reset demo data</button>
    </div>`;
}

// --- Apply ---------------------------------------------------------------------------------

export function viewApply() {
  return `
    <a class="back-link" href="#/account">← Account</a>
    <div class="kicker mt16">Membership application</div>
    <h1 class="display sm">Apply to join ITC.</h1>
    <p class="subcopy mt8">Free to apply. A leader reviews every application — usually within a day or two. Approval never depends on fitness level.</p>
    <form id="form-apply" class="mt16" novalidate>
      <div class="field-row">
        <div class="field"><label for="ap-full">Full name *</label><input id="ap-full" name="fullName" required autocomplete="name"></div>
        <div class="field"><label for="ap-pref">Preferred name *</label><input id="ap-pref" name="preferredName" required></div>
      </div>
      <div class="field"><label for="ap-email">Email *</label><input id="ap-email" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="ap-phone">Mobile / WhatsApp *</label><input id="ap-phone" name="phone" type="tel" required autocomplete="tel" placeholder="+852 …"></div>
      <div class="field-row">
        <div class="field"><label for="ap-en">Emergency contact name *</label><input id="ap-en" name="emergencyName" required></div>
        <div class="field"><label for="ap-ep">Emergency contact phone *</label><input id="ap-ep" name="emergencyPhone" type="tel" required></div>
      </div>
      <div class="field">
        <label for="ap-heard">How did you hear about ITC?</label>
        <select id="ap-heard" name="heard">
          <option>A friend</option>
          <option>Instagram</option>
          <option>Saw a session in the park</option>
          <option>Web search</option>
          <option>Other</option>
        </select>
      </div>
      <div class="field">
        <label for="ap-donor">Donor ID (optional)</label>
        <input id="ap-donor" name="donorId" placeholder="e.g. IECC-10028" autocomplete="off">
        <div class="hint">For members who already give through IECC. Leave blank or write “Not applicable” — you can add it later from your Profile.</div>
      </div>
      <label class="check"><input type="checkbox" name="ageConfirmed" required>
        <span>I confirm I am 18 or over, or that a parent/guardian will accompany me to sessions. *</span></label>
      <label class="check"><input type="checkbox" name="waiver" required>
        <span>I accept the participation waiver — activities are recreational, may be volunteer-led, and involve inherent physical risk. *</span></label>
      <label class="check"><input type="checkbox" name="guidelines" required>
        <span>I accept the ITC community guidelines. *</span></label>
      <label class="check"><input type="checkbox" name="privacy" required>
        <span>I accept the privacy policy. *</span></label>
      <label class="check"><input type="checkbox" name="mediaConsent">
        <span>(Optional) I consent to being included in ITC photos and videos.</span></label>
      <div id="apply-error"></div>
      <button class="btn mt24" type="submit">Submit application</button>
      <p class="muted small mt8">Draft form — final fields and waiver wording to be confirmed with ITC leadership.</p>
    </form>`;
}

// --- Checkout --------------------------------------------------------------------------------

export function viewCheckout(sessionId) {
  const s = findSession(store.activities(), sessionId);
  if (!s || s.kind !== "paid") return viewNotFound("That checkout doesn’t exist.");
  const user = store.currentUser();
  if (!user || user.status !== "approved") {
    return { redirect: `#/activity/${sessionId}` };
  }
  if (store.userBookingFor(user.id, s.id)) {
    const b = store.userBookingFor(user.id, s.id);
    return { redirect: `#/booking/${b.id}` };
  }
  if (store.spotsLeft(s) <= 0) return { redirect: `#/activity/${sessionId}` };

  return `
    <a class="back-link" href="#/activity/${s.id}">← ${esc(s.name)}</a>
    <div class="kicker mt16">Checkout</div>
    <h1 class="display sm">Book & pay.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Session</span><strong>${esc(s.name)}</strong></div>
        <div class="line"><span>When</span><strong>${esc(fmtDate(s.date))} · ${fmtTime(s.time)}</strong></div>
        <div class="line"><span>Where</span><strong>${esc(s.location)}</strong></div>
        <div class="line"><span>Length</span><strong>${s.durationMin} min</strong></div>
        <div class="line total"><span>Total</span><strong>${fmtMoney(s.price)}</strong></div>
      </div>
    </div></div>
    <form id="form-checkout" class="mt16" data-session="${s.id}" novalidate>
      <div class="card"><div class="card-body">
        <h3>Payment</h3>
        <div class="field"><label for="cc-name">Name on card</label><input id="cc-name" name="cardName" autocomplete="cc-name" value="${esc(user.fullName)}" required></div>
        <div class="field"><label for="cc-num">Card number</label><input id="cc-num" name="cardNumber" inputmode="numeric" autocomplete="cc-number" value="4242 4242 4242 4242" required></div>
        <div class="field-row">
          <div class="field"><label for="cc-exp">Expiry</label><input id="cc-exp" name="cardExp" inputmode="numeric" placeholder="MM/YY" value="12/28" required></div>
          <div class="field"><label for="cc-cvc">CVC</label><input id="cc-cvc" name="cardCvc" inputmode="numeric" value="424" required></div>
        </div>
        <p class="muted small mt8">Test checkout — no real charge. Any card details work.</p>
      </div></div>
      <button class="btn mt16" id="pay-btn" type="submit">Pay ${fmtMoney(s.price)}</button>
      <p class="muted small mt8 center">Cancellation & refund policy is being finalised — the prototype auto-refunds on cancellation.</p>
    </form>`;
}

// --- Booking confirmation / manage ------------------------------------------------------------

export function viewBooking(bookingId) {
  const b = store.getBooking(bookingId);
  const user = store.currentUser();
  if (!b || !user || (b.userId !== user.id && !["admin", "superadmin"].includes(user.role))) {
    return viewNotFound("Booking not found.");
  }
  const s = b.snapshot;
  const receipt = store.receiptForBooking(b.id);
  const live = b.status === "confirmed" && s.dateISO >= todayISO();

  const head = live
    ? `<div class="confirm-mark">${ICONS.check}</div>
       <h1 class="display sm center mt16">You’re booked in.</h1>
       <p class="subcopy center mt8">Booking ref <span class="mono">${esc(b.id.toUpperCase())}</span></p>`
    : `<h1 class="display sm mt16">Booking ${b.status === "cancelled" ? "cancelled" : "details"}.</h1>`;

  return `
    ${head}
    <div class="card mt24"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Session</span><strong>${esc(s.name)}</strong></div>
        <div class="line"><span>When</span><strong>${esc(fmtDate(s.dateISO))} · ${fmtTime(s.time)}</strong></div>
        <div class="line"><span>Where</span><strong>${esc(s.location)}</strong></div>
        <div class="line"><span>Status</span><strong>${esc(b.status)}</strong></div>
        <div class="line total"><span>Paid</span><strong>${fmtMoney(s.price)}</strong></div>
      </div>
    </div></div>
    <div class="btn-row">
      ${live ? `<button class="btn ghost" type="button" data-action="ics-booking" data-booking="${b.id}">Add to calendar</button>` : ""}
      ${receipt ? `<a class="btn ghost" href="#/receipt/${receipt.id}">View receipt · ${esc(receipt.number)}</a>` : ""}
      ${live ? `<button class="btn danger" type="button" data-action="cancel-booking" data-booking="${b.id}">Cancel & refund</button>` : ""}
      <a class="btn" href="#/schedule">Back to schedule</a>
    </div>`;
}

// --- Receipt -----------------------------------------------------------------------------------

export function viewReceipt(receiptId) {
  const r = store.getReceipt(receiptId);
  const user = store.currentUser();
  if (!r || !user || (r.userId !== user.id && !["admin", "superadmin"].includes(user.role))) {
    return viewNotFound("Receipt not found.");
  }
  return `
    <a class="back-link" href="#/account">← Account</a>
    <div class="kicker mt16">Receipt</div>
    <h1 class="display sm">${esc(r.number)}</h1>
    <p class="subcopy mt8">Issued ${new Date(r.issuedAt).toLocaleString("en-HK", { dateStyle: "medium", timeStyle: "short" })} · ${r.status === "refunded" ? "Refunded" : "Paid"}</p>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Item</span><strong>${esc(r.line)}</strong></div>
        <div class="line"><span>Payment method</span><strong>Card •••• ${esc(r.cardLast4)}</strong></div>
        <div class="line total"><span>Total (${esc(r.currency)})</span><strong>${fmtMoney(r.amount)}</strong></div>
      </div>
    </div></div>
    <p class="muted small mt16">Prototype: receipts render in-app. The real product will email a copy and record the payment provider reference.</p>`;
}

// --- Admin --------------------------------------------------------------------------------------

export function viewAdmin(tab = "approvals") {
  const user = store.currentUser();
  if (!user || !["admin", "superadmin"].includes(user.role)) {
    return { redirect: "#/account" };
  }
  const tabs = `
    <nav class="admin-tabs">
      ${["approvals", "activities", "members"]
        .map((t) => `<a href="#/admin/${t}" class="${t === tab ? "active" : ""}">${t}</a>`)
        .join("")}
    </nav>`;

  const body =
    tab === "activities" ? adminActivities() : tab === "members" ? adminMembers(user) : adminApprovals();

  return `
    <div class="kicker">Admin</div>
    <h1 class="display">Club ops.</h1>
    ${tabs}
    ${body}`;
}

function adminApprovals() {
  const pending = store.pendingApplicants();
  if (!pending.length) {
    return `<div class="empty">No pending applications. New signups will land here.</div>`;
  }
  return pending
    .map(
      (u) => `
      <div class="card booking-card applicant"><div class="card-body">
        <header>
          <div>
            <div class="kicker dim" style="margin-top:0">Applied ${new Date(u.appliedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" })}</div>
            <h3 class="mt8">${esc(u.fullName)}</h3>
          </div>
          <span class="badge warn">Pending</span>
        </header>
        <dl>
          <dt>Email</dt><dd>${esc(u.email)}</dd>
          <dt>Phone</dt><dd>${esc(u.phone)}</dd>
          <dt>Emergency</dt><dd>${esc(u.emergencyName)} · ${esc(u.emergencyPhone)}</dd>
          <dt>Heard via</dt><dd>${esc(u.heard)}</dd>
          <dt>Age 18+ / guardian</dt><dd>${u.ageConfirmed ? "Confirmed" : "—"}</dd>
          <dt>Photo consent</dt><dd>${u.mediaConsent ? "Yes" : "No"}</dd>
        </dl>
        <div class="actions">
          <button class="btn sm" type="button" data-action="approve" data-user="${u.id}">Approve</button>
          <button class="btn danger sm" type="button" data-action="decline" data-user="${u.id}">Decline</button>
        </div>
      </div></div>`
    )
    .join("");
}

function adminActivities() {
  const acts = store.activities();
  return `
    <div class="session-list">
      ${acts
        .map(
          (a) => `
        <a class="session-row" href="#/admin/activity/${a.id}">
          <time>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][a.weekday]}<small>${a.time}</small></time>
          <div>
            <h3>${esc(a.name)}</h3>
            <p>${esc(a.location)}${a.kind === "paid" ? ` · ${fmtMoney(a.price)} · cap ${a.capacity}` : " · open attendance"}</p>
          </div>
          <div class="row-end">
            ${a.kind === "free" ? '<span class="badge free">Free</span>' : '<span class="badge paid">Paid</span>'}
            ${a.published ? "" : '<span class="badge neutral">Hidden</span>'}
          </div>
        </a>`
        )
        .join("")}
    </div>
    <a class="btn ghost mt16" href="#/admin/activity/new">+ New activity</a>`;
}

function adminMembers(viewer) {
  const users = [...store.allUsers()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const canEdit = viewer.role === "superadmin";
  return `
    <p class="muted small mt16">${users.filter((u) => u.status === "approved").length} approved · ${store.pendingApplicants().length} pending. ${canEdit ? "Role changes are super-admin only." : "Only a super admin can change roles."}</p>
    ${users
      .map((u) => {
        const roleBadge =
          u.status === "pending"
            ? '<span class="badge warn">Pending</span>'
            : u.status === "declined"
              ? '<span class="badge danger">Declined</span>'
              : `<span class="badge ${u.role === "member" ? "free" : u.role === "admin" ? "paid" : "warn"}">${u.role}</span>`;
        const editor =
          canEdit && u.status === "approved" && u.id !== viewer.id
            ? `<select class="role-select" data-change="set-role" data-user="${u.id}">
                 ${["member", "admin", "superadmin"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
               </select>`
            : roleBadge;
        return `
          <div class="member-row">
            <div class="who"><strong>${esc(u.fullName)}</strong><span>${esc(u.email)}</span></div>
            ${editor}
          </div>`;
      })
      .join("")}`;
}

export function viewAdminActivity(id) {
  const user = store.currentUser();
  if (!user || !["admin", "superadmin"].includes(user.role)) {
    return { redirect: "#/account" };
  }
  const isNew = id === "new";
  const a = isNew
    ? {
        id: "",
        name: "",
        kind: "free",
        category: "Strength",
        weekday: 3,
        time: "19:00",
        durationMin: 60,
        location: "",
        mapsQuery: "",
        blurb: "",
        memberNote: "",
        photo: "../assets/itc/main.webp",
        price: 250,
        capacity: 18,
        baseBooked: 0,
        published: true,
      }
    : store.getActivity(id);
  if (!a) return viewNotFound("Activity not found.");

  const paidOnly = (inner) => `<div class="paid-only ${a.kind === "paid" ? "" : "hidden"}">${inner}</div>`;

  return `
    <a class="back-link" href="#/admin/activities">← Activities</a>
    <div class="kicker mt16">Admin · Activity</div>
    <h1 class="display sm">${isNew ? "New activity." : "Edit activity."}</h1>
    <form id="form-activity" class="mt16" data-activity="${esc(a.id)}" novalidate>
      <div class="field"><label for="ac-name">Name *</label><input id="ac-name" name="name" value="${esc(a.name)}" required></div>
      <div class="field-row">
        <div class="field">
          <label for="ac-kind">Type</label>
          <select id="ac-kind" name="kind" data-change="kind-toggle">
            <option value="free" ${a.kind === "free" ? "selected" : ""}>Free — open attendance</option>
            <option value="paid" ${a.kind === "paid" ? "selected" : ""}>Paid — book & pay in app</option>
          </select>
        </div>
        <div class="field">
          <label for="ac-cat">Category</label>
          <select id="ac-cat" name="category">
            ${["Strength", "Run", "HYROX", "Water", "Other"].map((c) => `<option ${a.category === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="ac-day">Day of week</label>
          <select id="ac-day" name="weekday">
            ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
              .map((d, i) => `<option value="${i}" ${a.weekday === i ? "selected" : ""}>${d}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field"><label for="ac-time">Start time</label><input id="ac-time" name="time" type="time" value="${esc(a.time)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="ac-dur">Duration (min)</label><input id="ac-dur" name="durationMin" type="number" min="15" step="15" value="${a.durationMin}"></div>
        <div class="field"><label for="ac-loc">Location *</label><input id="ac-loc" name="location" value="${esc(a.location)}" required></div>
      </div>
      ${paidOnly(`
        <div class="field-row">
          <div class="field"><label for="ac-price">Price (HKD, fixed per session)</label><input id="ac-price" name="price" type="number" min="0" value="${a.price ?? 250}"></div>
          <div class="field"><label for="ac-cap">Capacity</label><input id="ac-cap" name="capacity" type="number" min="1" value="${a.capacity ?? 18}"></div>
        </div>
        <div class="field"><label for="ac-base">Simulated existing bookings</label><input id="ac-base" name="baseBooked" type="number" min="0" value="${a.baseBooked ?? 0}">
          <div class="hint">Prototype only — stands in for other members’ bookings.</div></div>
      `)}
      <div class="field"><label for="ac-blurb">Description</label><textarea id="ac-blurb" name="blurb" rows="3">${esc(a.blurb)}</textarea></div>
      <div class="field"><label for="ac-note">Leader note (members only)</label><textarea id="ac-note" name="memberNote" rows="2">${esc(a.memberNote || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="published" ${a.published ? "checked" : ""}>
        <span>Published — visible on the schedule</span></label>
      <button class="btn mt24" type="submit">${isNew ? "Create activity" : "Save changes"}</button>
    </form>`;
}

// --- Fallback -----------------------------------------------------------------------------------

export function viewNotFound(msg = "Page not found.") {
  return `
    <div class="empty mt24">
      <p>${esc(msg)}</p>
      <a class="btn ghost mt16" href="#/home" style="display:inline-flex;width:auto;padding:12px 22px">Back home</a>
    </div>`;
}
