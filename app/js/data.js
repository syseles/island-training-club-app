// ==========================================================================
// ITC prototype — seed data and pure helpers.
// No DOM access in this module; safe to unit-test in isolation.
// ==========================================================================

// Photo paths are relative to /app/index.html.
const PH = "../assets/itc/";

// --- Activity templates ----------------------------------------------------
// kind: "free"  -> open attendance, no booking, no capacity (per product brief)
// kind: "paid"  -> members book + pay per session at a fixed price
// HYROX capacity is a seeded placeholder; price, time and capacity are all
// editable in the Admin area.

export const SEED_ACTIVITIES = [
  {
    id: "wnt",
    name: "Wednesday Night Training",
    kind: "free",
    category: "Strength",
    weekday: 3, // Wednesday
    time: "19:30",
    durationMin: 60,
    location: "TBC",
    mapsQuery: "", // venue to be confirmed — no directions link until set
    photo: PH + "main.webp",
    blurb:
      "Our flagship all-level session. Structured strength and conditioning led by the community — come ready to move and we scale every workout to you.",
    memberNote: "Meeting point to be confirmed — check back before Wednesday. Bring water.",
    published: true,
  },
  {
    id: "run",
    name: "ITC Run Club",
    kind: "free",
    category: "Run",
    weekday: 1, // Monday
    time: "19:30",
    durationMin: 45,
    location: "TBC",
    mapsQuery: "", // venue to be confirmed — no directions link until set
    photo: PH + "running.webp",
    blurb:
      "Easy-pace social run along the harbour. All paces welcome — nobody gets left behind.",
    memberNote: "Bag drop with a leader at the start point.",
    published: true,
  },
  {
    id: "water",
    name: "ITC Swimming",
    kind: "free",
    category: "Water",
    weekday: 2, // Tuesday
    time: "19:30",
    durationMin: 90,
    location: "Victoria Park",
    mapsQuery: "Victoria Park, Hong Kong",
    photo: PH + "water.webp",
    blurb:
      "Community water session — skills, games and a good workout. Kit is provided, just bring a towel.",
    memberNote: "Changing facilities on site. Arrive 15 minutes early.",
    published: true,
  },
  {
    id: "hyrox-midtown",
    name: "ITC HYROX",
    kind: "paid",
    category: "HYROX",
    weekday: 6, // Saturday
    time: "11:00",
    durationMin: 75,
    location: "Midtown 28",
    mapsQuery: "Midtown 28, Hong Kong",
    photo: PH + "hyrox.webp",
    blurb:
      "Weekly hybrid race training: ski, sled, burpees and running intervals. Every session is purchased separately at one fixed price.",
    memberNote: "Gym entry fee is included in the session price.",
    price: 180, // HKD
    capacity: 18, // placeholder
    published: true,
  },
  {
    id: "hyrox",
    name: "ITC HYROX",
    kind: "paid",
    category: "HYROX",
    weekday: 6, // Saturday
    time: "11:15",
    durationMin: 75,
    location: "BFT Causeway Bay",
    mapsQuery: "BFT Causeway Bay, Hong Kong",
    photo: PH + "hyrox.webp",
    blurb:
      "Weekly hybrid race training: ski, sled, burpees and running intervals. Every session is purchased separately at one fixed price.",
    memberNote: "Gym entry fee is included in the session price.",
    price: 180, // HKD
    capacity: 18, // placeholder
    published: true,
  },
];

export const ANNOUNCEMENTS = [
  {
    id: "ann-1",
    title: "Sunday service at IECC",
    body: "Several of us worship at Island Evangelical Community Church on Sundays — 10:30 AM. Come as you are, and look for the ITC crowd after the service.",
    postedAt: daysAgo(3),
  },
  {
    id: "ann-2",
    title: "New Wednesday venue being scouted",
    body: "Leaders are trialling alternate spots for Wednesday Night Training. Watch the session page — venue updates land there first.",
    postedAt: daysAgo(6),
  },
];

// --- Leaders & culture (draft community content) ------------------------------

export const LEADERS = [
  {
    name: "Arnold Wong",
    role: "Founder · Head Coach",
    photo: PH + "community.webp",
    bio: "Started ITC so training in Hong Kong could be serious about fitness and serious about people at the same time.",
  },
  {
    name: "Tina",
    role: "Community Lead",
    photo: PH + "main.webp",
    bio: "Keeps Wednesday nights running and makes sure every first-timer leaves with a name and a next session.",
  },
  {
    name: "CM Chui",
    role: "Run Club Lead",
    photo: PH + "running.webp",
    bio: "Leads Monday harbour runs. Believes the best pace is the one you can talk at.",
  },
];

export const CULTURE = [
  {
    title: "Our foundation",
    body: "Island Training Club is built on a Christian foundation. We train hard, look out for each other, and welcome everyone — whatever you believe and however fit you are today.",
  },
  {
    title: "Purpose",
    body: "We exist to make Hong Kong healthier together: consistent training, real friendship, and a community that shows up for each other on and off the park.",
  },
  {
    title: "Values",
    body: "Everyone welcome · Show up for each other · Effort over ego · Leave the park better than we found it.",
  },
  {
    title: "Safety",
    body: "Sessions may be volunteer-led and involve physical activity. Work within your own limits, tell a leader about anything we should know, and consult a healthcare professional when appropriate. Participants aged 17 or under need a parent or guardian present.",
  },
  {
    title: "Community guidelines",
    body: "Be welcoming to first-timers. Respect leaders, venues and each other. No harassment, no exclusion, no hard sell. Photos are opt-in — consent is asked, never assumed.",
  },
];

// ============================================================================
// Pure helpers
// ============================================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

export function todayLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysAgo(n) {
  return addDays(todayLocal(), -n).getTime();
}

export function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

export function mondayOf(date) {
  const d = new Date(date.getTime());
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

export function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(d) {
  const date = d instanceof Date ? d : parseISO(d);
  return `${DAY_NAMES[date.getDay()]} · ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function fmtDateLong(d) {
  const date = d instanceof Date ? d : parseISO(d);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${pad(m)} ${suffix}`;
}

export function fmtMoney(hkd) {
  return `HK$${Number(hkd).toLocaleString("en-HK")}`;
}

export function initials(name) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// Donor IDs come from IECC as LASTNAME-NNNN(N): the member's surname, a
// hyphen, then a 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). The
// hyphen is mandatory — anything else is rejected with a re-entry error.
// Blank or "not applicable"-style answers mean "no donor ID" (null) — the
// member can add one later from the Profile tab.
const DONOR_ID_RE = /^[A-Za-z]+-\d{4,5}$/;
const DONOR_ID_NA_RE = /^(n\/?a|not applicable|none|no)$/i;

// Members type these on phones, where autocorrect rewrites "-" as an en/em
// dash (or they hit the spacebar instead). Canonicalize any dash/space
// separator to a plain hyphen so the stored ID always reads LASTNAME-NNNN(N).
function canonicalDonorId(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[‐-―_]/g, "-") // unicode dashes, underscore -> hyphen
    .replace(/\s*-\s*/g, "-") // tidy spaces around a hyphen
    .replace(/^([A-Za-z]+)\s+(\d{4,5})$/, "$1-$2") // space as the separator
    .toUpperCase();
}

export function normalizeDonorId(raw) {
  const v = canonicalDonorId(raw);
  if (!v || DONOR_ID_NA_RE.test(v)) return null;
  return v;
}

// Returns "format" when a non-blank, non-N/A value isn't a valid donor ID,
// null otherwise — forms use this to reject typos before anything is saved.
export function donorIdProblem(raw) {
  const v = canonicalDonorId(raw);
  if (!v || DONOR_ID_NA_RE.test(v)) return null;
  return DONOR_ID_RE.test(v) ? null : "format";
}

// --- Sessions -----------------------------------------------------------------
// A session is a dated instance of an activity template, generated on demand
// with a deterministic id (`${activityId}-${YYYY-MM-DD}`) so bookings survive
// reloads.

export function sessionsInRange(activities, fromDate, days) {
  const out = [];
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const act of activities) {
      if (!act.published) continue;
      if (date.getDay() !== act.weekday) continue;
      out.push({
        ...act,
        id: `${act.id}-${isoDate(date)}`,
        activityId: act.id,
        dateISO: isoDate(date),
        date,
      });
    }
  }
  return out;
}

// A session counts as past once its start time has passed — a date-only
// check would keep this morning's session "upcoming" (and bookable) all day.
// Works for live sessions and booking snapshots (both carry dateISO + time).
export function sessionStarted(s) {
  const [h, m] = s.time.split(":").map(Number);
  const start = parseISO(s.dateISO);
  start.setHours(h, m, 0, 0);
  return start.getTime() <= Date.now();
}

export function findSession(activities, sessionId) {
  // sessionId = `${activityId}-${YYYY-MM-DD}`; split off the date part
  const match = sessionId.match(/^(.*)-(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  const [, activityId, dateISO] = match;
  const act = activities.find((a) => a.id === activityId);
  if (!act) return null;

  const date = parseISO(dateISO);
  return { ...act, id: sessionId, activityId, dateISO, date };
}

// --- Calendar (.ics) ------------------------------------------------------------

export function buildICS(session) {
  const dt = session.dateISO.replaceAll("-", "");
  const start = `${dt}T${session.time.replace(":", "")}00`;
  const endDate = new Date(parseISO(session.dateISO).getTime() + session.durationMin * 60000);
  const end = `${dt}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Island Training Club//ITC App//EN",
    "BEGIN:VEVENT",
    `UID:${session.id}@islandtrainingclub`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${session.name} — Island Training Club`,
    `LOCATION:${session.location}`,
    `DESCRIPTION:${session.blurb.replace(/\n/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function mapsUrl(session) {
  const q = session.mapsQuery || session.location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// ============================================================================
// Weekly encouragement — rotating verse, Sunday–Saturday weeks
// ============================================================================
// To rotate: append verses to lengthen the cycle (it wraps when the list
// runs out). Prototype copy — final verse list to be confirmed with ITC.

export const WEEKLY_VERSES = [
  {
    ref: "Hebrews 12:1",
    text: "Let us run with perseverance the race marked out for us.",
  },
  {
    ref: "Isaiah 40:31",
    text: "Those who hope in the Lord will renew their strength; they will run and not grow weary.",
  },
  {
    ref: "1 Corinthians 9:24",
    text: "Run in such a way as to get the prize.",
  },
  {
    ref: "Philippians 4:13",
    text: "I can do all this through him who gives me strength.",
  },
  {
    ref: "Joshua 1:9",
    text: "Be strong and courageous — the Lord your God will be with you wherever you go.",
  },
  {
    ref: "Colossians 3:23",
    text: "Whatever you do, work at it with all your heart, as working for the Lord.",
  },
  {
    ref: "Galatians 6:9",
    text: "Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.",
  },
  {
    ref: "2 Timothy 4:7",
    text: "I have fought the good fight, I have finished the race, I have kept the faith.",
  },
];

const VERSE_EPOCH = new Date(2026, 6, 26); // Sunday — week one shows verses[0]

export function weeklyVerse(date = todayLocal()) {
  const sunday = addDays(date, -date.getDay()); // weeks run Sunday–Saturday
  const weeks = Math.round((sunday - VERSE_EPOCH) / (7 * 24 * 60 * 60 * 1000));
  const n = WEEKLY_VERSES.length;
  return WEEKLY_VERSES[((weeks % n) + n) % n];
}
