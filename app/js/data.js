// ==========================================================================
// ITC prototype — seed data and pure helpers.
// No DOM access in this module; safe to unit-test in isolation.
// ==========================================================================

// Photo paths are relative to /app/index.html.
const PH = "../assets/itc/";

// --- Activity templates ----------------------------------------------------
// kind: "free"  -> open attendance, no booking, no capacity (per product brief)
// kind: "paid"  -> members book + pay per session at a fixed price
// HYROX price/capacity are unresolved in the brief; seeded placeholders are
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
    location: "Tamar Park, Admiralty",
    mapsQuery: "Tamar Park, Hong Kong",
    photo: PH + "main.webp",
    blurb:
      "Our flagship all-level session. Structured strength and conditioning led by the community — come ready to move and we scale every workout to you.",
    memberNote: "Meet at the lime ITC flag near the main lawn. Bring water.",
    published: true,
  },
  {
    id: "run",
    name: "ITC Run Club",
    kind: "free",
    category: "Run",
    weekday: 1, // Monday
    time: "07:00",
    durationMin: 45,
    location: "Central Harbourfront",
    mapsQuery: "Central Harbourfront, Hong Kong",
    photo: PH + "running.webp",
    blurb:
      "Easy-pace social run along the harbour. All paces welcome — nobody gets left behind.",
    memberNote: "Bag drop with a leader at the start point.",
    published: true,
  },
  {
    id: "water",
    name: "Water Sports Evening",
    kind: "free",
    category: "Water",
    weekday: 2, // Tuesday
    time: "18:30",
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
    id: "trail",
    name: "Sunday Trail Run",
    kind: "free",
    category: "Run",
    weekday: 0, // Sunday
    time: "08:00",
    durationMin: 90,
    location: "Hong Kong trails",
    mapsQuery: "",
    photo: PH + "trail.webp",
    blurb:
      "Rotating trail route each week. Route and meet point are shared with approved members a few days before.",
    memberNote: "This week's route: Tai Tam reservoir loop, meet at Parkview gate.",
    published: true,
  },
  {
    id: "hyrox",
    name: "ITC HYROX",
    kind: "paid",
    category: "HYROX",
    weekday: 6, // Saturday
    time: "10:00",
    durationMin: 75,
    location: "Quarry Bay Studio",
    mapsQuery: "Quarry Bay, Hong Kong",
    photo: PH + "hyrox.webp",
    blurb:
      "Weekly hybrid race training: ski, sled, burpees and running intervals. Every session is purchased separately at one fixed price.",
    memberNote: "Gym entry fee is included in the session price.",
    price: 250, // HKD — placeholder until the operations workshop fixes it
    capacity: 18, // placeholder
    baseBooked: 14, // simulated demand from other members
    published: true,
  },
];

// --- Seed users --------------------------------------------------------------
// Roles: pending -> member -> admin -> superadmin.
// Demo logins surface these in the Account screen.

export const SEED_USERS = [
  {
    id: "u-super",
    role: "superadmin",
    status: "approved",
    fullName: "Isaac Kwok",
    preferredName: "Isaac",
    email: "owner@itc.hk",
    phone: "+852 9000 0000",
    ageConfirmed: true,
    emergencyName: "ITC Ops",
    emergencyPhone: "+852 9000 9999",
    heard: "Founder",
    appliedAt: daysAgo(120),
  },
  {
    id: "u-admin",
    role: "admin",
    status: "approved",
    fullName: "Daniel Lee",
    preferredName: "Dan",
    email: "admin@itc.hk",
    phone: "+852 9000 0002",
    ageConfirmed: true,
    emergencyName: "S. Lee",
    emergencyPhone: "+852 9000 9002",
    heard: "Founding member",
    appliedAt: daysAgo(118),
  },
  {
    id: "u-member",
    role: "member",
    status: "approved",
    fullName: "Ava Cheung",
    preferredName: "Ava",
    email: "member@itc.hk",
    phone: "+852 9000 0001",
    ageConfirmed: true,
    emergencyName: "K. Cheung",
    emergencyPhone: "+852 9000 9001",
    heard: "A friend runs with the club",
    appliedAt: daysAgo(34),
  },
  {
    id: "u-pend-1",
    role: "pending",
    status: "pending",
    fullName: "Marco Santos",
    preferredName: "Marco",
    email: "marco.santos@example.com",
    phone: "+852 6111 2222",
    ageConfirmed: true,
    emergencyName: "L. Santos",
    emergencyPhone: "+852 6333 4444",
    heard: "Instagram",
    appliedAt: daysAgo(2),
  },
  {
    id: "u-pend-2",
    role: "pending",
    status: "pending",
    fullName: "Jenny Wu",
    preferredName: "Jenny",
    email: "jenny.wu@example.com",
    phone: "+852 6555 6666",
    ageConfirmed: true,
    emergencyName: "P. Wu",
    emergencyPhone: "+852 6777 8888",
    heard: "Saw the club at Tamar Park",
    appliedAt: daysAgo(1),
  },
];

// --- Seed bookings -----------------------------------------------------------
// Snapshot fields keep the member area renderable even after the schedule
// window rolls forward.

export function seedBookings() {
  const past = saturdayOnOrBefore(todayLocal());
  const next = addDays(past, 7);
  const act = SEED_ACTIVITIES.find((a) => a.id === "hyrox");
  return [
    {
      id: "b-seed-past",
      userId: "u-member",
      sessionId: `hyrox-${isoDate(past)}`,
      status: "attended",
      createdAt: daysAgo(9),
      snapshot: sessionSnapshot(act, past),
    },
    {
      id: "b-seed-next",
      userId: "u-member",
      sessionId: `hyrox-${isoDate(next)}`,
      status: "confirmed",
      createdAt: daysAgo(3),
      snapshot: sessionSnapshot(act, next),
    },
  ];
}

export function seedReceipts() {
  const past = saturdayOnOrBefore(todayLocal());
  const next = addDays(past, 7);
  return [
    {
      id: "r-seed-past",
      number: "ITC-2026-0041",
      bookingId: "b-seed-past",
      userId: "u-member",
      amount: 250,
      currency: "HKD",
      cardLast4: "4242",
      status: "paid",
      issuedAt: daysAgo(9),
      line: `ITC HYROX — ${fmtDate(past)} 10:00 AM`,
    },
    {
      id: "r-seed-next",
      number: "ITC-2026-0048",
      bookingId: "b-seed-next",
      userId: "u-member",
      amount: 250,
      currency: "HKD",
      cardLast4: "4242",
      status: "paid",
      issuedAt: daysAgo(3),
      line: `ITC HYROX — ${fmtDate(next)} 10:00 AM`,
    },
  ];
}

function sessionSnapshot(act, date) {
  return {
    name: act.name,
    kind: act.kind,
    dateISO: isoDate(date),
    time: act.time,
    durationMin: act.durationMin,
    location: act.location,
    price: act.price ?? null,
  };
}

// --- Leaders & culture (draft community content) ------------------------------

export const LEADERS = [
  {
    name: "Isaac Kwok",
    role: "Founder · Head Coach",
    photo: PH + "community.webp",
    bio: "Started ITC so training in Hong Kong could be serious about fitness and serious about people at the same time.",
  },
  {
    name: "Daniel Lee",
    role: "Community Lead",
    photo: PH + "main.webp",
    bio: "Keeps Wednesday nights running and makes sure every first-timer leaves with a name and a next session.",
  },
  {
    name: "Ava Cheung",
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

function saturdayOnOrBefore(date) {
  const d = new Date(date.getTime());
  const offset = (d.getDay() + 1) % 7; // days since Saturday
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

// Donor ID is optional. Blank or "not applicable"-style answers mean "no
// donor ID" (null) — the member can add one later from the Profile tab.
export function normalizeDonorId(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^(n\/?a|not applicable|none|no)$/i.test(v)) return null;
  return v;
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
