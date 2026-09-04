export const HYROX_BFT_ACTIVITY_ID = "hyrox-bft";
export const HYROX_MIDTOWN_ACTIVITY_ID = "hyrox-midtown";
export const HYROX_BFT_CAPACITY = 20;
export const HYROX_MIDTOWN_CAPACITY = 12;
export const HYROX_POOL_CAPACITY = 32;

const isoPattern = /^\d{4}-\d{2}-\d{2}$/;

function cycleDate(dateISO) {
  if (!isoPattern.test(dateISO)) throw new Error("Invalid HYROX cycle date.");
  const date = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateISO) {
    throw new Error("Invalid HYROX cycle date.");
  }
  if (date.getUTCDay() !== 6) throw new Error("HYROX cycle date must be a Saturday.");
  return date;
}

function shiftISO(dateISO, days) {
  const date = cycleDate(dateISO);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function hyroxCycleId(dateISO) {
  cycleDate(dateISO);
  return `hyrox-pool-${dateISO}`;
}

export function hyroxRegistrationOpensAt(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -5)}T18:00:00+08:00`);
}

export function hyroxPaymentReminderAt(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T17:00:00+08:00`);
}

export function hyroxPaymentDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T18:00:00+08:00`);
}

export function hyroxHolderGraceDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T19:00:00+08:00`);
}

export function hyroxPromotedPaymentDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T20:00:00+08:00`);
}

export function hyroxChoiceDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -1)}T21:00:00+08:00`);
}

export function allocateHyroxVenues(bookings, {
  bftSessionId,
  midtownSessionId,
  bftCapacity = HYROX_BFT_CAPACITY,
  midtownCapacity = HYROX_MIDTOWN_CAPACITY,
}) {
  const remaining = new Map([
    [bftSessionId, bftCapacity],
    [midtownSessionId, midtownCapacity],
  ]);

  return [...bookings]
    .sort((a, b) => (a.paidAt - b.paidAt) || a.id.localeCompare(b.id))
    .map((booking) => {
      const preferred = booking.venuePreference === "midtown"
        ? midtownSessionId
        : booking.venuePreference === "bft" ? bftSessionId : null;
      const first = preferred
        || (remaining.get(bftSessionId) > 0 ? bftSessionId : midtownSessionId);
      const alternate = first === bftSessionId ? midtownSessionId : bftSessionId;
      const sessionId = remaining.get(first) > 0 ? first : alternate;

      if (!sessionId || remaining.get(sessionId) <= 0) {
        throw new Error("HYROX venue capacity exceeded.");
      }

      remaining.set(sessionId, remaining.get(sessionId) - 1);
      return {
        bookingId: booking.id,
        sessionId,
        source: preferred === sessionId ? "preference" : "automatic",
      };
    });
}
