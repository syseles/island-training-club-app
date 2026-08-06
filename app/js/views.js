// ==========================================================================
// ITC prototype — view renderers.
// Each view returns an HTML string. app.js owns the router, event
// delegation, and DOM mounting. Views read from the store but never mutate
// it directly (mutations live behind data-action handlers in app.js).
// ==========================================================================

import * as store from "./store.js";
import { isLive } from "./config.js";
import {
  LEADERS,
  CULTURE,
  ANNOUNCEMENTS,
  findSession,
  sessionStarted,
  sessionsInRange,
  weeklyVerse,
  mondayOf,
  addDays,
  todayLocal,
  isoDate,
  fmtDate,
  fmtDateLong,
  fmtTime,
  fmtMoney,
  initials,
  notificationRelativeTime,
  notificationHktTime,
  notificationDestination,
  notificationCategory,
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

const fmtDay = (ts) =>
  new Date(ts).toLocaleDateString("en-HK", { day: "numeric", month: "short", year: "numeric" });

const fmtMonthYear = (ts) =>
  new Date(ts).toLocaleDateString("en-HK", { month: "short", year: "numeric" });

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
    ? `<span class="badge free booked">Booked</span>`
    : s.kind === "free"
      ? `<span class="badge free">Free</span><span class="spots">Just show up</span>`
      : `${store.spotsLeft(s) > 0 ? `<span class="badge paid">${fmtMoney(s.price)}</span>` : ""}${spotsLabel(s)}`;
  return `
    <a class="session-row${past ? " is-past" : ""}${highlight ? " next" : ""}" href="#/activity/${s.id}">
      <time>${fmtTime(s.time)}</time>
      <div>
        <h3>${esc(s.name)}</h3>
        <p>${showDate ? `${esc(fmtDate(s.date))} · ${esc(s.location)}` : esc(s.location)}</p>
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
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5C7 16.5 3.5 13.2 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1.9-1.3 2.4-2.1 4-2.1 2.5 0 4.5 2 4.5 4.6 0 3.6-3.5 6.9-8.5 10.9Z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 8h13l-1.1 12.5H6.6Z"/><path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5v19"/><path d="M17 6.5H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H6.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.2 2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
};

// --- Bottom nav / avatar --------------------------------------------------------

// Live roles use super_admin; local seed roles use superadmin.
const ADMIN_ROLES = ["admin", "superadmin", "super_admin"];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);
const isSuperRole = (role) => ["superadmin", "super_admin"].includes(role);
const normalizedRole = (role) => role === "super_admin" ? "superadmin" : role;
const roleLabel = (role) => ({
  member: "Member",
  admin: "Admin",
  superadmin: "Super Admin",
}[normalizedRole(role)] || String(role || ""));

export const adminMemberFilters = { query: "", status: "all", role: "all" };

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: "home", href: "#/home" },
  { key: "schedule", label: "Schedule", icon: "calendar", href: "#/schedule" },
  { key: "community", label: "Community", icon: "people", href: "#/community" },
  { key: "account", label: "Account", icon: "user", href: "#/account" },
];

export function navHTML(routeKey, user) {
  const isAdmin = user && isAdminRole(user.role);
  const isSignedIn = !!user;
  return NAV_ITEMS.filter((i) => {
    if (!i.roles) return true;
    if (i.roles.includes("signed-in")) return isSignedIn;
    return i.roles.some((r) => isAdmin);
  })
    .map(
      (i) => `
      <a href="${i.href}" class="${i.key === routeKey ? "active" : ""}" ${i.key === routeKey ? 'aria-current="page"' : ""}>
        ${ICONS[i.icon]}<span>${i.key === "account" && user ? "Profile" : i.label}</span>
      </a>`
    )
    .join("");
}

export function avatarHTML(user) {
  return user ? initials(user.fullName) : ICONS.user;
}

export function notificationBellHTML(unreadCount = 0, active = false) {
  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);
  return `${ICONS.bell}${unreadCount ? `<span class="notification-badge" aria-hidden="true">${visibleCount}</span>` : ""}`;
}

// ============================================================================
// Views
// ============================================================================

export function viewHome() {
  const user = store.currentUser();
  // Same 14-day window bookings are made in — a confirmed booking can never
  // fall out of "My week" (e.g. next Saturday's booking seen on Sat evening).
  const upcoming = store.upcomingSessions(14);
  const name = user ? esc(user.preferredName || user.fullName.split(" ")[0]) : null;

  const guest = !user
    ? `
    <div class="card mt24"><div class="card-body">
      <span class="kicker">New to ITC?</span>
      <h3 class="mt8">Everyone is welcome</h3>
      <p class="hero-meta">Free activities are open to all — just show up. Membership is free too; sign in and an ITC leader approves every application before paid booking unlocks.</p>
      ${isLive()
        ? `<button class="btn mt16" type="button" data-action="sign-in-google">Continue with Google</button>`
        : `<a class="btn mt16" href="#/account">Sign in or join</a>`}
      <p class="muted small mt8">New here? You'll be guided through a short application after sign-in.</p>
    </div></div>`
    : "";

  // "My week" is signed-in-only: approved members see the sessions they've
  // booked (free ones included); other signed-in users see the upcoming
  // preview. Visitors get the free open-to-all preview instead.
  let weekSection;
  if (user) {
    let rows;
    let emptyMsg;
    if (user.status === "approved") {
      const bookedIds = new Set(
        store
          .bookingsForUser(user.id)
          .filter((b) => b.status === "confirmed" && !sessionStarted(b.snapshot))
          .map((b) => b.sessionId)
      );
      rows = upcoming.filter((s) => bookedIds.has(s.id));
      emptyMsg = `Nothing booked this week yet. <a href="#/schedule" style="color:var(--accent)">Find a session →</a>`;
    } else {
      // Signed in but not yet approved: paid booking is locked, so only
      // the free open sessions are actionable.
      rows = upcoming.filter((s) => s.kind === "free");
      emptyMsg = "No open sessions this week — check back soon.";
    }
    weekSection = `
    <div class="section-head">
      <h2>My Week</h2>
      <a href="#/schedule">See more →</a>
    </div>
    <div class="session-list">
      ${rows.length
        ? rows.map((s, i) => sessionRow(s, { highlight: i === 0 })).join("")
        : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
  } else {
    const freeRows = upcoming.filter((s) => s.kind === "free");
    weekSection = `
    <div class="section-head">
      <h2>This week — open to all</h2>
      <a href="#/schedule">See more →</a>
    </div>
    <div class="session-list">
      ${freeRows.length
        ? freeRows.map((s, i) => sessionRow(s, { highlight: i === 0 })).join("")
        : `<div class="empty">No open sessions this week — check back soon.</div>`}
    </div>`;
  }

  const verse = weeklyVerse();
  const encouragement = `
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Encouragement of the week</span>
      <p class="verse-text">“${esc(verse.text)}”</p>
      <p class="hero-meta">${esc(verse.ref)}</p>
    </div></div>`;

  return `
    <div class="kicker">${esc(fmtDateLong(todayLocal()))} · Hong Kong</div>
    <h1 class="display">${name ? `Good to see you, ${name}.` : "Train together."}</h1>
    ${user && user.status === "pending" ? pendingBanner() : ""}
    ${user ? encouragement : ""}
    ${guest}
    ${weekSection}
    <div class="section-head"><h2>The Club</h2><a href="#/community">More →</a></div>
    <a class="card" href="#/community" style="display:block;text-decoration:none">
      <img class="photo" src="../assets/itc/community.webp" alt="ITC community">
      <div class="card-body">
        <h3>Connect and grow with us</h3>
        <p class="hero-meta">Prayers, fellowship, ad-hoc meals and announcements from the church and the community.</p>
      </div>
    </a>`;
}

// --- Schedule ---------------------------------------------------------------------

export const scheduleState = {
  weekOffset: 0,
  selected: null, // ISO date
  filter: "all",
};

// Back to the default view — this week, today, no filter. The router calls
// this when the Schedule tab is entered fresh (back-navigation from an
// activity/checkout page keeps the week and day you were browsing).
export function resetScheduleState() {
  scheduleState.weekOffset = 0;
  scheduleState.selected = null; // viewSchedule re-picks today
  scheduleState.filter = "all";
}

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
    ? list.map((s) => sessionRow(s, { past: sessionStarted(s), showDate: false })).join("")
    : `<div class="empty">No ${scheduleState.filter === "all" ? "" : esc(scheduleState.filter) + " "}sessions on ${esc(fmtDate(scheduleState.selected))}.</div>`;

  return `
    <div class="kicker">Week of ${esc(fmtDateLong(monday))}</div>
    <h1 class="display">Find your next session</h1>
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
  const past = sessionStarted(s);
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
      <div class="btn-row ${s.mapsQuery ? "two" : ""}">
        <button class="btn" type="button" data-action="ics" data-session="${s.id}">Add to calendar</button>
        ${s.mapsQuery ? `<a class="btn ghost" href="${mapsHref(s)}" target="_blank" rel="noopener">Get directions</a>` : ""}
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
        <p>This is a paid member session. Sign in to book — new here? You'll be guided through a short free application after sign-in.</p>
      </div>
      <a class="btn mt16" href="#/account">Sign in to book</a>`;
  }

  const metaPaid =
    s.kind === "paid"
      ? `
      <div><small>Price</small><strong>${fmtMoney(s.price)} / session</strong></div>
      <div><small>Places</small><strong>${spots <= 0 ? "Full" : `${spots} of ${s.capacity} left`}</strong></div>`
      : "";

  const attendeeNames = store.attendeesFor(s);
  const attendees =
    s.kind === "paid"
      ? isMember
        ? `
      <div class="section-head"><h2>Who’s coming</h2></div>
      ${attendeeNames.length
        ? `<div class="attendees">${attendeeNames.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`
        : `<p class="muted small">No sign-ups yet — be the first.</p>`}`
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

// --- Community -----------------------------------------------------------------
// The Community tab is about connecting: prayer, fellowship, meals and news.
// Leaders and culture copy lives under Profile > About Island Training Club.

export function viewCommunity(section) {
  switch (section) {
    case undefined:
      return communityHome();
    case "prayers":
      return communityPrayers();
    case "fellowship":
      return communityFellowship();
    case "meals":
      return communityMeals();
    case "announcements":
      return communityAnnouncements();
    case "about":
      return communityAbout();
    default:
      return viewNotFound();
  }
}

function communityHome() {
  return `
    <div class="kicker">Community</div>
    <h1 class="display">Connect and grow with us.</h1>
    <p class="subcopy mt8">Island Training Club is a Hong Kong training community with a Christian foundation — open to everyone. Training is the doorway; here are the ways to go deeper.</p>
    <div class="link-cards">
      ${linkCard("#/community/prayers", "Prayers", "Ask for prayer, or pray with us")}
      ${linkCard("#/community/fellowship", "Fellowship", "Small groups and community life")}
      ${linkCard("#/community/meals", "Ad-Hoc Meals", "Share a meal with us after sessions")}
      ${linkCard("#/community/announcements", "Announcements", "News from the church and the community")}
      ${linkCard("#/community/about", "About Island Training Club", "Mission, coaches and leadership")}
    </div>`;
}

// Leaders and culture sit at the bottom of the Community tab, behind the
// About card — open to everyone, signed in or not.
function communityAbout() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · About Island Training Club</div>
    <h1 class="display sm">More than a workout.</h1>
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

function communityPrayers() {
  const user = store.currentUser();
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Prayers</div>
    <h1 class="display sm">Prayers.</h1>
    <p class="subcopy mt8">We pray for each other — injuries, exams, work, family, anything. Send a request and the leaders will pray with you this week; you’re also welcome to pray along.</p>
    <div class="card mt16"><div class="card-body">
      <h3>Ask for prayer</h3>
      <form id="form-prayer" novalidate>
        <div class="field">
          <label for="pr-name">Your name (optional)</label>
          <input id="pr-name" name="name" autocomplete="name" value="${esc(user?.fullName || "")}">
        </div>
        <div class="field">
          <label for="pr-text">Prayer request *</label>
          <textarea id="pr-text" name="request" rows="4" required placeholder="What can we pray about?"></textarea>
        </div>
        <div id="prayer-error"></div>
        <button class="btn mt16" type="submit">Send prayer request</button>
        <p class="muted small mt8">Requests go privately to ITC leaders — nothing is posted publicly. Prototype: stored on this device only.</p>
      </form>
    </div></div>`;
}

function communityFellowship() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Fellowship</div>
    <h1 class="display sm">Fellowship.</h1>
    <p class="subcopy mt8">Sessions are where we train; fellowship is where we become friends. Whatever you believe, you’re welcome at every one of these.</p>
    <div class="card mt16"><div class="card-body prose">
      <h3>Small groups</h3>
      <p>Midweek groups meet around the city — a short reflection, honest conversation and prayer for anyone who wants it. No Bible knowledge required.</p>
      <h3>Sundays at IECC</h3>
      <p>Many of us worship at Island Evangelical Community Church on Sunday mornings. Come along and sit with the ITC crowd — service starts 10:30 AM.</p>
      <h3>First-timers</h3>
      <p>New to church entirely? Say so at any session and a leader will happily walk you through what to expect — zero pressure, zero jargon.</p>
    </div></div>
    <button class="btn mt16" type="button" data-action="connect-interest" data-topic="fellowship groups">I’m interested — tell me more</button>
    <p class="muted small mt16 center">Draft content — fellowship details to be confirmed with ITC leadership.</p>`;
}

function communityMeals() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Ad-Hoc Meals</div>
    <h1 class="display sm">Ad-Hoc Meals.</h1>
    <p class="subcopy mt8">The best conversations happen over food. After some sessions we head straight to a nearby cha chaan teng — no programme, no agenda, just dinner. First-timers especially welcome.</p>
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Next meal</span>
      <h3 class="mt8">Post-training dinner — details TBC</h3>
      <p class="hero-meta">Date and venue are announced in the session WhatsApp group a few days ahead. Pay for your own meal; the company is free.</p>
    </div></div>
    <button class="btn mt16" type="button" data-action="connect-interest" data-topic="the next ad-hoc meal">Count me in</button>
    <p class="muted small mt16 center">Prototype placeholder — meal scheduling will plug in here.</p>`;
}

function communityAnnouncements() {
  return `
    <a class="back-link" href="#/community">← Community</a>
    <div class="kicker mt16">Community · Announcements</div>
    <h1 class="display sm">Announcements.</h1>
    <p class="subcopy mt8">News from the church and the community.</p>
    <div class="stack mt16">
      ${ANNOUNCEMENTS.map(
        (a) => `
        <div class="card"><div class="card-body">
          <span class="kicker dim">${fmtDay(a.postedAt)}</span>
          <h3 class="mt8">${esc(a.title)}</h3>
          <p class="hero-meta">${esc(a.body)}</p>
        </div></div>`
      ).join("")}
    </div>
    <p class="muted small mt16">Draft announcements — real posts come from ITC leadership and IECC comms.</p>`;
}

export async function viewAccount(section, editMode) {
  const user = store.currentUser();
  if (!user) return accountVisitor();
  if (user.status === "pending") {
    const application = await store.getMyApplication();
    if (isLive() && !application) return { redirect: "#/apply" };
    return accountPending(user, application);
  }
  if (user.status === "declined") return accountDeclined(user);

  const needsApplication = section === undefined || section === "details" || section === "indemnity" || section === "privacy";
  const application = needsApplication ? await store.getMyApplication() : null;

  switch (section) {
    case undefined:
      return accountMember(user, application);
    case "details":
      return editMode === "edit" ? accountDetailsEdit(user, application) : accountDetails(user, application);
    case "indemnity":
      return accountIndemnity(user, application);
    case "donor":
      return accountDonor(user);
    case "payments":
      return accountPayments(user);
    case "privacy":
      return editMode === "edit" ? accountPrivacyEdit(application) : accountPrivacy(user, application);
    case "history":
      return accountHistory(user);
    default:
      return viewNotFound();
  }
}

function accountVisitor() {
  if (isLive()) return accountVisitorLive();
  return accountVisitorLocal();
}

function accountVisitorLive() {
  return `
    <div class="kicker">Account</div>
    <h1 class="display">Sign in</h1>
    <p class="subcopy mt8">Use your Google account to sign in to Island Training Club. New here? You'll be guided through a short application after sign-in.</p>
    <div class="card mt24"><div class="card-body">
      <button class="btn mt16" type="button" data-action="sign-in-google">Continue with Google</button>
      <p class="muted small mt16">By continuing, you agree to be added to the ITC community roster. An ITC leader will review your application before you can book sessions.</p>
    </div></div>`;
}

function accountVisitorLocal() {
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
      <p class="muted small mt16">This local prototype has no password. Sign in with the email used for an application on this device.</p>
    </div></div>
    <div class="card mt16"><div class="card-body">
      <h3>Not a member yet?</h3>
      <p class="hero-meta">Apply in two minutes. You’ll keep browsing access while a leader reviews your application.</p>
      <a class="btn mt16" href="#/apply">Apply for membership</a>
    </div></div>`;
}

function accountPending(user, application) {
  const phone = application ? application.mobile : user.phone;
  const emergencyName = application ? application.emergency_name : user.emergencyName;
  const emergencyPhone = application ? application.emergency_phone : user.emergencyPhone;
  const heard = application ? application.heard_source : user.heard;
  const indemnityAt = application ? application.waiver_accepted_at : user.indemnityAcceptedAt;
  const photoConsent = application ? application.photo_consent : user.mediaConsent;
  return `
    <div class="kicker">Profile · ${esc(user.email)}</div>
    <h1 class="display">Thanks, ${esc(user.preferredName || user.fullName.split(" ")[0])}.</h1>
    ${pendingBanner()}
    <div class="card mt16"><div class="card-body">
      <h3>Your application</h3>
      <div class="receipt-lines">
        <div class="line"><span>Name</span><strong>${esc(user.fullName)}</strong></div>
        <div class="line"><span>Phone</span><strong>${esc(presentValue(phone))}</strong></div>
        <div class="line"><span>Emergency contact</span><strong>${esc(presentValue(emergencyName))} · ${esc(presentValue(emergencyPhone))}</strong></div>
        <div class="line"><span>Heard about ITC</span><strong>${esc(heardSourceLabel(heard))}</strong></div>
        ${user.donorId ? `<div class="line"><span>Donor ID</span><strong>${esc(user.donorId)}</strong></div>` : ""}
        <div class="line"><span>Indemnity</span><strong>${indemnityAt ? "Accepted" : "—"}</strong></div>
        <div class="line"><span>Photo consent</span><strong>${photoConsent ? "Yes" : "No"}</strong></div>
      </div>
    </div></div>
    <div class="btn-row">
      <a class="btn ghost" href="#/schedule">Browse the schedule</a>
      <button class="btn danger" type="button" data-action="signout">Sign out</button>
    </div>`;
}

function accountDeclined(user) {
  return `
    <div class="kicker">Profile · ${esc(user.email)}</div>
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

function accountMember(user, application) {
  const isAdmin = isAdminRole(user.role);
  const applicationMissing = isLive() && !application;
  const indemnityAt = application?.waiver_accepted_at || (!applicationMissing ? user.indemnityAcceptedAt : null);

  const roleLabel = {
    member: "Active member",
    admin: "Admin",
    superadmin: "Super admin",
    super_admin: "Super admin",
  }[user.role];

  const bookings = store.bookingsForUser(user.id).filter((b) => b.status !== "cancelled");
  const attended = bookings.filter((b) => b.status === "attended").length;

  return `
    <div class="kicker">Profile</div>

    <div class="profile-hero">
      <div class="ph-top">
        <div class="ph-avatar">${esc(initials(user.fullName))}</div>
        <div class="ph-id">
          <div class="ph-role">${roleLabel}</div>
          <h1>${esc(user.fullName)}</h1>
          <p>Member since ${fmtMonthYear(user.appliedAt)}</p>
        </div>
      </div>
      <div class="ph-stats">
        <div><strong>${bookings.length}</strong><span>Bookings</span></div>
        <div><strong>${attended}</strong><span>Attended</span></div>
      </div>
    </div>

    <div class="profile-rows">
      ${isAdmin ? profileRow("#/admin", ICONS.shield, "Admin Tools", "Approvals, activities and members") : ""}
      ${profileRow("#/account/details", ICONS.user, "Membership Details", applicationMissing ? "Application details unavailable" : "Contact and emergency information")}
      ${profileRow(
        "#/account/indemnity",
        ICONS.check,
        "Indemnity",
        applicationMissing
          ? "Application details unavailable"
          : indemnityAt
            ? `Indemnity confirmed on ${fmtDay(indemnityAt)}`
            : "To be accepted",
        { cls: indemnityAt ? "ok" : applicationMissing ? "" : "todo" }
      )}
      ${profileRow("#/account/donor", ICONS.heart, "Donor Profile", "Donor ID and e-receipt details")}
      ${profileRow("#/account/payments", ICONS.dollar, "Payments & Receipts", "Bookings, donations and orders")}
      ${profileRow("#/account/privacy", ICONS.bell, "Privacy & Notifications", applicationMissing ? "Application details unavailable" : "Consent and communication choices")}
      ${profileRow("#/account/history", ICONS.clock, "History", "Activity history")}
    </div>

    <div class="btn-row">
      <button class="btn ghost" type="button" data-action="signout">Sign out</button>
    </div>`;
}

// Tappable Profile row: icon tile + title + one-line status, separated by
// hairlines. (Community keeps the chunkier linkCard treatment.)
function profileRow(href, icon, title, status, { cls = "" } = {}) {
  return `
    <a class="profile-row" href="${href}">
      <span class="pr-icon">${icon}</span>
      <span class="pr-text">
        <strong>${esc(title)}</strong>
        <span class="pr-status${cls ? ` ${cls}` : ""}">${esc(status)}</span>
      </span>
      ${ICONS.chevron}
    </a>`;
}

function applicationUnavailableCard() {
  return `
    <div class="card mt16"><div class="card-body">
      <span class="kicker">Application</span>
      <h3 class="mt8">Application details unavailable</h3>
      <p class="hero-meta">We couldn’t find the membership application details for this approved account. Please contact an ITC leader so they can review the account record.</p>
    </div></div>`;
}

function accountLine(label, value) {
  return `<div class="line"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function presentValue(value, fallback = "Not provided") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function heardSourceLabel(value) {
  return {
    friend: "Friend",
    family: "Family",
    search: "Search",
    social: "Social media",
    event: "Event",
    other: "Other",
  }[value] || presentValue(value);
}

function accountDetails(user, application) {
  if (isLive() && !application) {
    return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Membership Details</div>
    <h1 class="display sm">Membership Details.</h1>
    ${applicationUnavailableCard()}`;
  }
  const memberSince = application?.submitted_at || user.appliedAt;
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Membership Details</div>
    <h1 class="display sm">Membership Details.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        ${accountLine("Full name", user.fullName)}
        ${accountLine("Preferred name", presentValue(application ? application.preferred_name : user.preferredName))}
        ${accountLine("Email", user.email)}
        ${accountLine("Member since", fmtDay(memberSince))}
        ${accountLine("Mobile / WhatsApp number", presentValue(application?.mobile || user.phone))}
        ${accountLine("Age status", application?.is_minor ? "Under 18" : "18 or over")}
        ${application?.is_minor ? accountLine("Guardian name", presentValue(application?.guardian_name)) : ""}
        ${application?.is_minor ? accountLine("Guardian phone", presentValue(application?.guardian_phone)) : ""}
        ${accountLine("Emergency contact name", presentValue(application?.emergency_name || user.emergencyName))}
        ${accountLine("Emergency contact phone", presentValue(application?.emergency_phone || user.emergencyPhone))}
        ${accountLine("How you heard about ITC", heardSourceLabel(application?.heard_source || user.heard))}
        ${application?.heard_detail ? accountLine("Detail", application.heard_detail) : ""}
      </div>
      <a class="btn ghost mt16" href="#/account/details/edit">Update details</a>
    </div></div>`;
}

// Tappable card that opens a detail page. The face shows the title plus a
// one-line description or status (and an optional second line), so the page
// it leads to stays uncluttered. Used on Community (Profile uses profileRow).
function linkCard(href, title, status, { sub = "", cls = "" } = {}) {
  return `
    <a class="card link-card" href="${href}">
      <div class="card-body">
        <div class="lc-text">
          <h3>${esc(title)}</h3>
          <p class="lc-status${cls ? ` ${cls}` : ""}">${esc(status)}</p>
          ${sub ? `<p class="lc-sub">${esc(sub)}</p>` : ""}
        </div>
        ${ICONS.chevron}
      </div>
    </a>`;
}

// Draft indemnity wording — final text to be confirmed with ITC leadership
// before launch. The apply form captures acceptance at join time; this page
// catches members who joined before that requirement existed.
function accountIndemnity(user, application) {
  if (isLive() && !application) {
    return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Indemnity</div>
    <h1 class="display sm">Health &amp; Liability Indemnity.</h1>
    ${applicationUnavailableCard()}
    <p class="muted small mt16">Draft wording — the final indemnity will be confirmed with ITC leadership before launch.</p>`;
  }
  const at = application?.waiver_accepted_at || user.indemnityAcceptedAt;
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Indemnity</div>
    <h1 class="display sm">Health &amp; Liability Indemnity.</h1>
    ${
      at
        ? `
      <div class="banner mt16">
        <span class="kicker">Indemnity confirmed on ${fmtDay(at)}</span>
        <p>You’re confirmed to join ITC activities.</p>
      </div>`
        : `
      <div class="banner warn mt16">
        <span class="kicker">To be accepted</span>
        <p>Please read the indemnity below, then accept and confirm — it’s required for joining ITC activities.</p>
      </div>`
    }
    <div class="card mt16"><div class="card-body prose">
      <h3>Health declaration</h3>
      <p>I confirm that I am physically fit and in good health, and I know of no medical reason I should not take part in Island Training Club (ITC) activities. If my health changes, I will seek professional medical advice before taking part again.</p>
      <h3>Participation at my own risk</h3>
      <p>I understand that ITC activities are recreational, may be volunteer-led, and involve inherent physical risk. I take part at my own risk, will work within my own limits, and will follow the instructions of ITC leaders at all times.</p>
      <h3>Release &amp; indemnity</h3>
      <p>To the fullest extent permitted by law, I release and indemnify ITC, its leaders, members and volunteers against any claim, loss, injury or damage arising from my participation in ITC activities.</p>
      <h3>Emergency contact</h3>
      <p>I confirm the emergency contact details in my membership application are accurate, and I will keep them up to date.</p>
    </div></div>
    ${
      at
        ? ""
        : `
      <form id="form-indemnity" class="mt16" novalidate>
        <label class="check"><input type="checkbox" name="indemnityAccept" required>
          <span>I have read and accept the health &amp; liability indemnity above. *</span></label>
        <div id="indemnity-error"></div>
        <button class="btn mt16" type="submit">Accept &amp; Confirm</button>
      </form>`
    }
    <p class="muted small mt16">Draft wording — the final indemnity will be confirmed with ITC leadership before launch.</p>`;
}

function accountDonor(user) {
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Donor Profile</div>
    <h1 class="display sm">Donor Profile.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        <div class="line"><span>Donor ID</span><strong>${user.donorId ? esc(user.donorId) : "Not provided"}</strong></div>
      </div>
      ${
        user.donorId
          ? ""
          : `
        <form id="form-donor-id" class="mt16" novalidate>
          <div class="field">
            <label for="donor-id">Add your Donor ID</label>
            <input id="donor-id" name="donorId" placeholder="e.g. CHUI-08879" autocomplete="off">
            <div class="hint">Format: your last name, a hyphen, then the 4- or 5-digit number from your IECC donor record (e.g. CHUI-08879 or CHUI-8879). Left this blank at sign-up? Add it here any time — leaders use it to match your giving to your donor record.</div>
          </div>
          <div id="donor-error"></div>
          <button class="btn ghost sm" type="submit">Save Donor ID</button>
        </form>`
      }
    </div></div>`;
}

function accountPayments(user) {
  const receipts = store.receiptsForUser(user.id);
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Payments &amp; Receipts</div>
    <h1 class="display sm">Payments &amp; Receipts.</h1>
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
    }`;
}

function privacyAcceptedValue(application) {
  return application?.privacy_accepted_at ? fmtDay(application.privacy_accepted_at) : "Not recorded";
}

function accountPrivacy(user, application) {
  if (isLive() && !application) {
    return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Privacy &amp; Notifications</div>
    <h1 class="display sm">Privacy &amp; Notifications.</h1>
    ${applicationUnavailableCard()}`;
  }
  const onOff = (value) => value ? "On" : "Off";
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Privacy &amp; Notifications</div>
    <h1 class="display sm">Privacy &amp; Notifications.</h1>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        ${accountLine("Photo/video consent", application?.photo_consent ? "Allowed" : "Not allowed")}
        ${accountLine("Privacy policy accepted", privacyAcceptedValue(application))}
        ${accountLine("WhatsApp session reminders", onOff(application?.whatsapp_reminders))}
        ${accountLine("Email receipts", onOff(application?.email_receipts))}
        ${accountLine("Community news", onOff(application?.community_news))}
      </div>
      <a class="btn ghost mt16" href="#/account/privacy/edit">Update details</a>
    </div></div>`;
}

function accountPrivacyEdit(application) {
  if (isLive() && !application) {
    return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Privacy &amp; Notifications</div>
    <h1 class="display sm">Privacy &amp; Notifications.</h1>
    ${applicationUnavailableCard()}`;
  }
  return `
    <a class="back-link" href="#/account/privacy">← Privacy &amp; Notifications</a>
    <div class="kicker mt16">Profile · Privacy &amp; Notifications</div>
    <h1 class="display sm">Privacy &amp; Notifications.</h1>
    <p class="subcopy mt8">Update your consent and communication preferences.</p>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        ${accountLine("Privacy policy accepted", privacyAcceptedValue(application))}
      </div>
    </div></div>
    <form data-form="privacy-preferences" class="form-grid mt16">
      <label class="check"><input type="checkbox" name="photo_consent" ${application?.photo_consent ? "checked" : ""}> <span>Photo/video consent</span></label>
      <label class="check"><input type="checkbox" name="whatsapp_reminders" ${application?.whatsapp_reminders ? "checked" : ""}> <span>WhatsApp session reminders</span></label>
      <label class="check"><input type="checkbox" name="email_receipts" ${application?.email_receipts ? "checked" : ""}> <span>Email receipts</span></label>
      <label class="check"><input type="checkbox" name="community_news" ${application?.community_news ? "checked" : ""}> <span>Community news</span></label>
      <button class="btn btn-primary" type="submit">Save changes</button>
    </form>`;
}

function bookingCard(b) {
  const s = b.snapshot;
  const live = b.status === "confirmed" && !sessionStarted(s);
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
}

function accountHistory(user) {
  const history = store
    .bookingsForUser(user.id)
    .filter((b) => !(b.status === "confirmed" && !sessionStarted(b.snapshot)));
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · History</div>
    <h1 class="display sm">History.</h1>
    ${history.length ? history.map(bookingCard).join("") : `<div class="empty">Past sessions will appear here.</div>`}`;
}

// --- Apply ---------------------------------------------------------------------------------

export async function viewApplyLive() {
  const cu = await store.getCurrentUser();
  if (!cu) return { redirect: "#/account" };
  if (cu.role !== "pending") {
    return `<section class="card"><p class="muted">Your application has already been processed.</p></section>`;
  }
  const existing = await store.getMyApplication();
  if (existing) {
    return `
      <section class="card">
        <p class="kicker">Application</p>
        <h2 class="display">Awaiting review</h2>
        <p class="muted">Your application was submitted on ${fmtDate(existing.submitted_at)}. An admin will review it shortly.</p>
      </section>
    `;
  }
  return applyFormHtml(cu);
}

function applyFormHtml(cu) {
  const displayName = cu?.profile?.full_name || cu?.email || "";
  return `
    <section class="card">
      <p class="kicker">Application</p>
      <h2 class="display">Tell us about you</h2>
      <p class="muted">Signed in as <strong>${esc(displayName)}</strong>${cu?.email ? ` · ${esc(cu.email)}` : ""}. We collect this so the team can approve your application and reach you in an emergency.</p>
      <form data-form="apply" class="form-grid">
        ${applyField("text", "mobile", "Mobile / WhatsApp number", true)}
        ${ageStatusField()}
        <div data-minor-only hidden>
          ${applyField("text", "guardian_name", "Guardian name", false)}
          ${applyField("text", "guardian_phone", "Guardian phone", false)}
        </div>
        ${applyField("text", "emergency_name", "Emergency contact name", true)}
        ${applyField("text", "emergency_phone", "Emergency contact phone", true)}
        ${applySelect("heard_source", "How did you hear about ITC?", ["friend","family","search","social","event","other"], true)}
        ${applyField("text", "heard_detail", "Detail (optional)", false)}
        ${applyField("text", "preferred_name", "Preferred name (optional)", false)}
        <label class="check"><input type="checkbox" name="photo_consent"> I consent to photos/videos of me being used on ITC channels. (Optional)</label>
        <label class="check"><input type="checkbox" name="waiver" required> I accept the participation waiver. (⏳ text pending ITC review)</label>
        <label class="check"><input type="checkbox" name="privacy" required> I accept the privacy policy. (⏳ text pending ITC review)</label>
        <label class="check"><input type="checkbox" name="guidelines" required> I accept the community guidelines. (⏳ text pending ITC review)</label>
        <button class="btn btn-primary" type="submit">Submit application</button>
      </form>
    </section>
  `;
}

function ageStatusField(isMinor) {
  return `
    <fieldset class="field age-status">
      <legend>Are you 18 or over? *</legend>
      <label><input type="radio" name="age_over_18" value="yes" ${isMinor === false ? "checked" : ""} required> Yes</label>
      <label><input type="radio" name="age_over_18" value="no" ${isMinor === true ? "checked" : ""} required> No</label>
    </fieldset>`;
}

function applyField(type, name, label, required, value = "") {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}${required ? " *" : ""}</span>
      <input type="${type}" name="${name}" value="${esc(value || "")}" ${required ? "required" : ""}>
    </label>
  `;
}

function applySelect(name, label, options, required, value = "") {
  const selectOptions = value && !options.includes(value) ? [value, ...options] : options;
  return `
    <label class="field">
      <span class="field-label">${esc(label)}${required ? " *" : ""}</span>
      <select name="${name}" ${required ? "required" : ""}>
        ${required ? "" : `<option value="">—</option>`}
        ${selectOptions.map((o) => `<option value="${o}" ${o === value ? "selected" : ""}>${esc(heardSourceLabel(o))}</option>`).join("")}
      </select>
    </label>
  `;
}

function accountDetailsEdit(user, application) {
  if (isLive() && !application) {
    return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Membership Details</div>
    <h1 class="display sm">Membership Details.</h1>
    ${applicationUnavailableCard()}`;
  }
  return `
    <a class="back-link" href="#/account/details">← Membership Details</a>
    <div class="kicker mt16">Profile · Membership Details</div>
    <h1 class="display sm">Membership Details.</h1>
    <p class="subcopy mt8">Update the details from your membership application.</p>
    <div class="card mt16"><div class="card-body">
      <div class="receipt-lines" style="margin-top:0;border-top:0">
        ${accountLine("Full name", user.fullName)}
        ${accountLine("Email", user.email)}
      </div>
    </div></div>
    <form data-form="membership-details" class="form-grid mt16">
      ${applyField("text", "mobile", "Mobile / WhatsApp number", true, application?.mobile || user.phone)}
      ${ageStatusField(application?.is_minor)}
      <div data-minor-only ${application?.is_minor ? "" : "hidden"}>
        ${applyField("text", "guardian_name", "Guardian name", !!application?.is_minor, application?.guardian_name)}
        ${applyField("text", "guardian_phone", "Guardian phone", !!application?.is_minor, application?.guardian_phone)}
      </div>
      ${applyField("text", "emergency_name", "Emergency contact name", true, application?.emergency_name || user.emergencyName)}
      ${applyField("text", "emergency_phone", "Emergency contact phone", true, application?.emergency_phone || user.emergencyPhone)}
      ${applySelect("heard_source", "How did you hear about ITC?", ["friend","family","search","social","event","other"], true, application?.heard_source || user.heard)}
      ${applyField("text", "heard_detail", "Detail (optional)", false, application?.heard_detail)}
      ${applyField("text", "preferred_name", "Preferred name (optional)", false, application ? application.preferred_name : user.preferredName)}
      <button class="btn btn-primary" type="submit">Save changes</button>
    </form>`;
}

export function viewApply() {
  if (isLive()) return viewApplyLive();
  return viewApplyLocal();
}

function viewApplyLocal() {
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
        <input id="ap-donor" name="donorId" placeholder="e.g. CHUI-08879" autocomplete="off">
        <div class="hint">For members who already give through IECC — your last name, a hyphen, then a 4- or 5-digit number (e.g. CHUI-8879). Leave blank or write “Not applicable” — you can add it later from your Profile.</div>
      </div>
      ${ageStatusField()}
      <div data-minor-only hidden>
        <div class="field-row">
          <div class="field"><label for="ap-guardian-name">Guardian name *</label><input id="ap-guardian-name" name="guardianName"></div>
          <div class="field"><label for="ap-guardian-phone">Guardian phone *</label><input id="ap-guardian-phone" name="guardianPhone" type="tel"></div>
        </div>
      </div>
      <label class="check"><input type="checkbox" name="indemnity" required>
        <span>I accept the health &amp; liability indemnity — I confirm I am fit to take part, I join ITC activities at my own risk, and I release ITC and its leaders from liability. *</span></label>
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
  if (sessionStarted(s)) return { redirect: `#/activity/${sessionId}` };
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
  if (!b || !user || (b.userId !== user.id && !isAdminRole(user.role))) {
    return viewNotFound("Booking not found.");
  }
  const s = b.snapshot;
  const receipt = store.receiptForBooking(b.id);
  const live = b.status === "confirmed" && !sessionStarted(s);

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
  if (!r || !user || (r.userId !== user.id && !isAdminRole(user.role))) {
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

export async function viewAdmin(tab = "approvals") {
  const user = store.currentUser();
  if (!user || !isAdminRole(user.role)) {
    return { redirect: "#/account" };
  }
  const tabs = `
    <nav class="admin-tabs">
      ${["approvals", "activities", "members"]
        .map((t) => `<a href="#/admin/${t}" class="${t === tab ? "active" : ""}"${t === tab ? ' aria-current="page"' : ""}>${t}</a>`)
        .join("")}
    </nav>`;

  // Live mode reads real data (Supabase applications + profiles); local
  // mode keeps the local prototype lists.
  let memberUsers = null;
  if (tab === "members") {
    memberUsers = isLive()
      ? (await store.listProfiles())
          .map((p) => ({
            id: p.id,
            fullName: p.full_name || p.email,
            email: p.email,
            role: p.role === "super_admin" ? "superadmin" : p.role,
            status: p.role === "pending" ? "pending" : p.role === "declined" ? "declined" : "approved",
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      : [...store.allUsers()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  const body =
    tab === "activities"
      ? adminActivities()
      : tab === "members"
        ? adminMembers(user, memberUsers)
        : adminApprovals(await store.listApprovalCandidates());

  return `
    <div class="kicker">Admin</div>
    <h1 class="display">Club ops.</h1>
    ${tabs}
    ${body}`;
}

function adminApprovals(pending) {
  if (!pending.length) {
    return `<div class="empty">No pending members. New signups will land here.</div>`;
  }

  const ready = pending.filter((item) => item.applicationSubmitted);
  const awaiting = pending.filter((item) => !item.applicationSubmitted);
  const section = (title, items, emptyCopy, renderCard) => `
    <section class="approval-group">
      <div class="section-head"><h2>${title} (${items.length})</h2></div>
      ${items.length ? items.map(renderCard).join("") : `<div class="empty">${emptyCopy}</div>`}
    </section>`;
  const decisionButton = (u, action, extraClass = "") => `
    <button class="btn ${extraClass}sm" type="button" data-action="${action}" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}">${action === "approve" ? "Approve" : "Decline"}</button>`;
  const joinedDate = (u) => new Date(u.appliedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short" });
  const readyCard = (u) => `
    <div class="card booking-card applicant" id="approval-${esc(u.id)}" data-approval-card data-applicant-name="${esc(u.fullName)}"><div class="card-body">
      <header>
        <div>
          <div class="kicker dim" style="margin-top:0">Applied ${joinedDate(u)}</div>
          <h3 class="mt8">${esc(u.fullName)}</h3>
        </div>
        <span class="badge warn">Pending</span>
      </header>
      <dl>
        <dt>Email</dt><dd>${esc(u.email)}</dd>
        <dt>Phone</dt><dd>${esc(u.phone)}</dd>
        <dt>Emergency</dt><dd>${esc(u.emergencyName)} · ${esc(u.emergencyPhone)}</dd>
        <dt>Heard via</dt><dd>${esc(u.heard)}</dd>
        <dt>Age 18+ / guardian</dt><dd>${u.isMinor ? "Under 18 · guardian required" : "18 or over"}</dd>
        <dt>Indemnity</dt><dd>${u.indemnityAcceptedAt ? "Accepted" : "—"}</dd>
        <dt>Photo consent</dt><dd>${u.mediaConsent ? "Yes" : "No"}</dd>
      </dl>
      <div class="actions">
        ${decisionButton(u, "approve")}
        ${decisionButton(u, "decline", "danger ")}
      </div>
      <div class="decision-error" role="alert" hidden></div>
    </div></div>`;
  const awaitingCard = (u) => `
    <div class="card booking-card applicant applicant-awaiting" id="approval-${esc(u.id)}" data-approval-card data-applicant-name="${esc(u.fullName)}"><div class="card-body">
      <header>
        <div>
          <div class="kicker dim" style="margin-top:0">Joined ${joinedDate(u)}</div>
          <h3 class="mt8">${esc(u.fullName)}</h3>
        </div>
        <span class="badge neutral">Awaiting</span>
      </header>
      <dl><dt>Email</dt><dd>${esc(u.email)}</dd></dl>
      <p class="hero-meta mt8"><strong>Application not submitted</strong></p>
      <p class="muted small">This pending profile has not finished the membership application yet, so approval stays locked until they submit it.</p>
      <div class="actions">
        <button class="btn sm" type="button" data-action="approve" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}" disabled>Approve</button>
        <button class="btn danger sm" type="button" data-action="decline" data-user="${esc(u.id)}" data-applicant-name="${esc(u.fullName)}" disabled>Decline</button>
      </div>
    </div></div>`;

  return [
    section("Ready for review", ready, "No applications ready for review.", readyCard),
    section("Awaiting application", awaiting, "No members awaiting an application.", awaitingCard),
  ].join("");
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

function adminMembers(viewer, users) {
  const canEdit = isSuperRole(viewer.role);
  const query = adminMemberFilters.query.trim().toLocaleLowerCase();
  const filtered = users.filter((u) => {
    const matchesQuery = !query || `${u.fullName || ""} ${u.email || ""}`.toLocaleLowerCase().includes(query);
    const matchesStatus = adminMemberFilters.status === "all" || u.status === adminMemberFilters.status;
    const matchesRole = adminMemberFilters.role === "all" || normalizedRole(u.role) === adminMemberFilters.role;
    return matchesQuery && matchesStatus && matchesRole;
  });
  const option = (value, label, selected) =>
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`;
  const filterChip = (key, value, label) =>
    `<button id="member-filter-${key}-${value}" type="button" data-action="admin-member-filter" data-filter-key="${key}" data-filter-value="${value}" aria-pressed="${adminMemberFilters[key] === value}">${label}</button>`;
  const activeFilters = [
    query ? `search “${esc(adminMemberFilters.query.trim())}”` : "",
    adminMemberFilters.status !== "all" ? `status ${adminMemberFilters.status[0].toUpperCase()}${adminMemberFilters.status.slice(1)}` : "",
    adminMemberFilters.role !== "all" ? `role ${roleLabel(adminMemberFilters.role)}` : "",
  ].filter(Boolean).join(", ");
  const rows = filtered.map((u) => {
    const role = normalizedRole(u.role);
    const roleBadge =
      u.status === "pending"
        ? '<span class="badge warn">Pending</span>'
        : u.status === "declined"
          ? '<span class="badge danger">Declined</span>'
          : `<span class="badge ${role === "member" ? "free" : role === "admin" ? "paid" : "warn"}">${roleLabel(role)}</span>`;
    const editor = canEdit && u.status === "approved" && u.id !== viewer.id
      ? `<div class="member-role-actions">
          <label class="sr-only" for="member-role-${esc(u.id)}">Role for ${esc(u.fullName)}</label>
          <select id="member-role-${esc(u.id)}" class="role-select" data-change="set-role" data-user="${esc(u.id)}" data-member-name="${esc(u.fullName)}" data-current-role="${role}">
            ${["member", "admin", "superadmin"].map((r) => option(r, roleLabel(r), role)).join("")}
          </select>
          <button class="btn danger sm" type="button" data-action="revoke-member" data-user="${esc(u.id)}" data-member-name="${esc(u.fullName)}">Revoke access</button>
        </div>`
      : roleBadge;
    return `
      <div class="member-row">
        <div class="who"><strong>${esc(u.fullName)}</strong><span>${esc(u.email)}</span></div>
        ${editor}
      </div>`;
  }).join("");
  const hasActiveFilters = adminMemberFilters.query.length > 0 ||
    adminMemberFilters.status !== "all" || adminMemberFilters.role !== "all";
  return `
    <p class="muted small mt16">${canEdit ? "Role changes are Super Admin only." : "Only a Super Admin can change roles."}</p>
    <div class="member-filters" aria-label="Filter members">
      <div class="field"><label for="member-search">Search members</label><input id="member-search" type="search" value="${esc(adminMemberFilters.query)}" placeholder="Name or email" data-input="member-search"></div>
      <fieldset class="admin-filter-group">
        <legend>Status</legend>
        <div class="admin-filter-chips">
          ${filterChip("status", "all", "All")}${filterChip("status", "approved", "Approved")}${filterChip("status", "pending", "Pending")}${filterChip("status", "declined", "Declined")}
        </div>
      </fieldset>
      <fieldset class="admin-filter-group">
        <legend>Role</legend>
        <div class="admin-filter-chips">
          ${filterChip("role", "all", "All roles")}${filterChip("role", "member", "Member")}${filterChip("role", "admin", "Admin")}${filterChip("role", "superadmin", "Super Admin")}
        </div>
      </fieldset>
      ${hasActiveFilters ? '<button class="admin-filters-clear" type="button" data-action="admin-member-filters-clear">Clear filters</button>' : ""}
    </div>
    <div class="member-results">${rows || `<div class="empty">No members match${activeFilters ? ` ${activeFilters}` : " these filters"}.</div>`}</div>`;
}

export function viewAdminActivity(id) {
  const user = store.currentUser();
  if (!user || !isAdminRole(user.role)) {
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

// --- Notifications (live / Supabase) -----------------------------------------------------------

export const notificationFilters = { kind: "all" };

const ADMIN_NOTIFICATION_FILTERS = [
  ["all", "All"],
  ["application", "Applications"],
  ["decision", "Decisions"],
  ["role", "Role changes"],
  ["club", "Club updates"],
  ["personal", "My account"],
];
const MEMBER_NOTIFICATION_FILTERS = ADMIN_NOTIFICATION_FILTERS.filter(([kind]) =>
  ["all", "club", "personal"].includes(kind)
);
const NOTIFICATION_CATEGORY_LABELS = {
  application: "Application",
  decision: "Decision",
  role: "Role change",
  club: "Club update",
  personal: "My account",
};

export async function viewNotifications(now = new Date(), prefetchedRows = null) {
  const user = store.currentUser();
  const rows = prefetchedRows ?? await store.listMyNotifications();
  const admin = isAdminRole(user?.role);
  const availableFilters = admin ? ADMIN_NOTIFICATION_FILTERS : MEMBER_NOTIFICATION_FILTERS;
  const availableKinds = new Set(availableFilters.map(([kind]) => kind));
  const activeKind = availableKinds.has(notificationFilters.kind) ? notificationFilters.kind : "all";
  notificationFilters.kind = activeKind;

  // Keep the existing member boundary even for unknown future admin kinds:
  // malformed categories fall back safely without exposing operational rows.
  const visibleRows = rows.filter((notification) => {
    const kind = typeof notification?.kind === "string" ? notification.kind.trim() : "";
    return admin || !kind.startsWith("admin_");
  }).sort((a, b) => {
    const aTime = Date.parse(a?.created_at);
    const bTime = Date.parse(b?.created_at);
    return (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
  });
  const filteredRows = activeKind === "all"
    ? visibleRows
    : visibleRows.filter((notification) => notificationCategory(notification?.kind) === activeKind);

  const notificationRow = (notification) => {
    const unread = !notification?.read_at;
    const kind = typeof notification?.kind === "string" ? notification.kind.trim() : "";
    const category = notificationCategory(kind);
    const relativeTime = notificationRelativeTime(notification?.created_at, now);
    const exactTime = notificationHktTime(notification?.created_at);
    const time = relativeTime && exactTime
      ? `<span>${esc(relativeTime)}</span><span>${esc(exactTime)}</span>`
      : `<span>Time unavailable</span>`;
    return `
      <button class="notification-row${unread ? " unread" : ""}" type="button"
        data-action="notification-open"
        data-notification-id="${esc(notification?.id)}"
        data-notification-read="${unread ? "false" : "true"}"
        data-destination="${esc(notificationDestination(kind))}">
        <span class="notification-unread" ${unread ? `aria-label="Unread"` : `aria-hidden="true"`}></span>
        <span class="notification-copy">
          <span class="notification-kind-badge">${esc(NOTIFICATION_CATEGORY_LABELS[category])}</span>
          <strong>${esc(notification?.title)}</strong>
          <span>${esc(notification?.body)}</span>
        </span>
        <span class="notification-time">${time}</span>
      </button>`;
  };

  const activeLabel = availableFilters.find(([kind]) => kind === activeKind)?.[1] || "All";
  const emptyCopy = activeKind === "all" ? "No notifications in All." : `No ${activeLabel} notifications.`;
  const wholeInboxEmpty = visibleRows.length === 0;
  const filterButtons = availableFilters.map(([kind, label]) => `
    <button type="button" data-action="notification-filter" data-notification-filter="${kind}"
      aria-pressed="${kind === activeKind ? "true" : "false"}">${esc(label)}</button>`).join("");

  return `
    <header class="notification-header">
      <p class="kicker">Inbox</p>
      <h1 class="display sm">Notifications</h1>
    </header>
    <div class="notification-filter-scroll">
      <div class="notification-filter-chips" role="group" aria-label="Filter notifications">${filterButtons}</div>
    </div>
    ${wholeInboxEmpty
      ? `<div class="empty notification-inbox-empty"><p>New notifications will appear here.</p></div>`
      : ""}
    <section class="card notification-section" aria-label="${esc(activeLabel)} notifications">
      <div class="card-body">
        ${filteredRows.length
          ? `<div class="notification-list">${filteredRows.map(notificationRow).join("")}</div>`
          : `<p class="notification-empty">${esc(emptyCopy)}</p>`}
      </div>
    </section>`;
}
