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
    baseBooked: 9, // simulated demand from other members
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
    fullName: "Arnold Wong",
    preferredName: "Arnold",
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
    fullName: "Tina",
    preferredName: "Tina",
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
    fullName: "CM Chui",
    preferredName: "CM",
    email: "member@itc.hk",
    phone: "+852 9000 0001",
    ageConfirmed: true,
    emergencyName: "K. Cheung",
    emergencyPhone: "+852 9000 9001",
    heard: "A friend runs with the club",
    donorId: "IECC-10028",
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
      amount: 180,
      currency: "HKD",
      cardLast4: "4242",
      status: "paid",
      issuedAt: daysAgo(9),
      line: `ITC HYROX — ${fmtDate(past)} 11:15 AM`,
    },
    {
      id: "r-seed-next",
      number: "ITC-2026-0048",
      bookingId: "b-seed-next",
      userId: "u-member",
      amount: 180,
      currency: "HKD",
      cardLast4: "4242",
      status: "paid",
      issuedAt: daysAgo(3),
      line: `ITC HYROX — ${fmtDate(next)} 11:15 AM`,
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

// --- Giving campaign -------------------------------------------------------------
// The current donation campaign. FPS details and goal are placeholders for
// review with ITC leadership; baseRaisedHKD stands in for gifts made outside
// the app so the progress bar reflects the real campaign.

export const GIVING_CAMPAIGN = {
  id: "scm-2027",
  title: "Standard Chartered Marathon 2027",
  subtitle:
    "Support our runners as ITC raises funds for community outreach through IECC.",
  goalHKD: 50000,
  baseRaisedHKD: 18450,
  fpsId: "112 233 445", // placeholder FPS identifier
  fpsPayee: "Island Training Club",
};

export function seedDonations() {
  return [
    {
      id: "d-seed-1",
      userId: "u-member",
      name: "CM Chui",
      amount: 500,
      currency: "HKD",
      campaignId: "scm-2027",
      method: "FPS",
      ref: "SCM27-9K2F4A",
      note: "Run well, team!",
      status: "confirmed",
      createdAt: daysAgo(6),
    },
    {
      id: "d-seed-2",
      userId: "u-member",
      name: "CM Chui",
      amount: 200,
      currency: "HKD",
      campaignId: "scm-2027",
      method: "FPS",
      ref: "SCM27-7QW1XZ",
      note: "",
      status: "pending",
      createdAt: daysAgo(1),
    },
  ];
}

// --- Shop products (preview mockup — not in the initial launch) --------------------
// Prices are placeholders. Product shots are the concept imagery from the
// committee mockup (itcappmock.netlify.app), cropped per garment.

export const SHOP_PRODUCTS = [
  {
    id: "tee",
    name: "ITC Performance Tee",
    price: 280,
    image: PH + "product-tee.png",
    blurb:
      "Sweat-wicking training tee in black with lime piping. Built for Wednesday nights.",
    sizes: ["XS", "S", "M", "L", "XL"],
  },
  {
    id: "vest",
    name: "ITC Running Vest",
    price: 240,
    image: PH + "product-vest.png",
    blurb:
      "Race-day vest in neon lime with black trim.",
    sizes: ["XS", "S", "M", "L", "XL"],
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

// --- Weekly encouragement ------------------------------------------------------
// A bible verse for the Home page; rotates every Sunday. The cycle is anchored
// to Sunday 26 July 2026 so the first week shows Hebrews 12:1 — append more
// verses to lengthen the rotation (it wraps around when the list runs out).

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
