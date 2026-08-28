// WNT venue presentation rules. Pure: no DOM, store, map, or network access.

export const TAMAR_DEFAULT_MEETING_POINT = Object.freeze({
  lat: 22.2816182,
  lng: 114.1655613,
});

const ECC_PRESENTATIONS = new Map([
  ["island ecc 11/f", {
    src: "../assets/itc/venues/island-ecc-11.jpg",
    alt: "Route to The Well on 11/F at Island ECC",
    caption: "The Well · 11/F Island ECC",
  }],
  ["island ecc 9/f", {
    src: "../assets/itc/venues/island-ecc-9.jpg",
    alt: "Route to Kid’s Club Hall on 9/F at Island ECC",
    caption: "Kid’s Club Hall · 9/F Island ECC",
  }],
]);

export function normalizeVenueLocation(location) {
  let value = String(location || "").trim().toLocaleLowerCase();
  value = value.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");
  value = value.replace(/\b(9|11)\s*f\b/g, "$1/f");
  value = value.replace(/\s*,\s*/g, ", ");
  if (value === "tamar park" || value === "tamar park, admiralty") return "tamar park";
  return value;
}

export function normalizeMeetingPoint(lat, lng) {
  if (lat === null || lat === undefined || lat === ""
      || lng === null || lng === undefined || lng === "") return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    ? point
    : null;
}

export function venuePresentationFor(session = {}) {
  const query = String(session.mapsQuery || "").trim();
  const markerLabel = String(session.markerLabel || session.name || session.location || query);
  const isWnt = session.activityId === "wnt" || String(session.id || "").startsWith("wnt-");
  const venue = normalizeVenueLocation(session.location);

  if (isWnt && ECC_PRESENTATIONS.has(venue)) {
    return { kind: "image", ...ECC_PRESENTATIONS.get(venue), fallbackQuery: query };
  }
  if (isWnt && venue === "tamar park") {
    const point = normalizeMeetingPoint(session.meetingLat, session.meetingLng)
      || TAMAR_DEFAULT_MEETING_POINT;
    return { kind: "coordinates", ...point, markerLabel };
  }
  return query ? { kind: "geocode", query, markerLabel } : { kind: "none" };
}
