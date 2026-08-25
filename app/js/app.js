// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import * as views from "./views.js";
import { isLive, supabase } from "./config.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("bottom-nav");
const notificationEl = document.getElementById("top-notifications");
const avatarEl = document.getElementById("top-avatar");
const toastStack = document.getElementById("toast-stack");
const MAP_FALLBACK_HTML = `<p class="muted small activity-map-fallback" role="status">Couldn't find the venue on the map — tap Get directions instead.</p>`;

export function loadActivityMapModule() {
  return import("./map.js");
}

export async function mountCommittedActivityMap(host, options = {}) {
  const {
    ownsGeneration = () => true,
    loadModule = loadActivityMapModule,
  } = options;
  try {
    const { mountActivityMap } = await loadModule();
    return await mountActivityMap(host, { ownsGeneration });
  } catch (_err) {
    if (ownsGeneration() && host?.isConnected) host.innerHTML = MAP_FALLBACK_HTML;
    return false;
  }
}

// --- Toasts --------------------------------------------------------------------

export function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = `toast${isErr ? " err" : ""}`;
  el.setAttribute("role", isErr ? "alert" : "status");
  el.textContent = msg;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// --- Router ----------------------------------------------------------------------

function parseHash() {
  return location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
}

const NAV_FOR = {
  home: "home",
  schedule: "schedule",
  activity: "schedule",
  community: "community",
  giving: "giving",
  notifications: "notifications",
  account: "account",
  apply: "account",
  checkout: "account",
  pay: "account",
  booking: "account",
  receipt: "account",
  admin: "admin",
};

let prevPage = null;
let renderGeneration = 0;
let notificationRouteRows = null;
let pendingNotificationRouteRequest = null;
const controlBusy = new WeakSet();
const APPLY_DRAFT_DEBOUNCE_MS = 500;
let applyDraftTimer = null;

// --- Async render + busy + feedback helpers (canonical Auth baseline) ---

async function withBusyControl(control, busyLabel, work, options = {}) {
  const busyKey = options.busyKey || control;
  if (!control || !busyKey || controlBusy.has(busyKey)) return;
  controlBusy.add(busyKey);
  const controls = [...new Set(options.controls || [control])];
  const disabledStates = controls.map((item) => [item, Boolean(item.disabled)]);
  const label = control.textContent;
  const canReplaceLabel = options.replaceLabel ?? control.tagName !== "SELECT";
  const announceWithoutReplacing = options.announceWithoutReplacing === true;
  const hadAriaLabel = control.hasAttribute("aria-label");
  const ariaLabel = control.getAttribute("aria-label");
  controls.forEach((item) => { item.disabled = true; });
  control.setAttribute("aria-busy", "true");
  if (canReplaceLabel) control.textContent = busyLabel;
  if (announceWithoutReplacing) {
    control.setAttribute("aria-label", busyLabel);
    control.classList.toggle("is-busy", true);
  }
  try {
    return await work();
  } finally {
    controlBusy.delete(busyKey);
    disabledStates.forEach(([item, disabled]) => { item.disabled = disabled; });
    control.removeAttribute("aria-busy");
    if (canReplaceLabel) control.textContent = label;
    if (announceWithoutReplacing) {
      if (hadAriaLabel) control.setAttribute("aria-label", ariaLabel);
      else control.removeAttribute("aria-label");
      control.classList.toggle("is-busy", false);
    }
  }
}

function campaignMutationControls(form, control = null) {
  const controls = [...(form?.querySelectorAll?.("input, textarea, select, button") || [])];
  if (control && !controls.includes(control)) controls.push(control);
  return controls;
}

function withCampaignMutationControl(form, control, busyLabel, work) {
  return withBusyControl(control, busyLabel, work, {
    busyKey: form,
    controls: campaignMutationControls(form, control),
  });
}

function lockCampaignMutationControls(form) {
  campaignMutationControls(form).forEach((control) => { control.disabled = true; });
}

function campaignFormPayload(form) {
  const fd = new FormData(form);
  return {
    id: form.dataset.campaign || "",
    title: fd.get("title"), description: fd.get("description"), goalHKD: fd.get("goalHKD"),
    fpsId: fd.get("fpsId"), fpsPayee: fd.get("fpsPayee"),
  };
}

function clearCampaignError(form) {
  const host = form?.querySelector?.("#campaign-error");
  if (host) { host.textContent = ""; host.className = ""; host.removeAttribute("role"); }
}

function showCampaignError(control, message) {
  const host = control?.closest?.("form")?.querySelector?.("#campaign-error");
  if (host) { host.textContent = message; host.className = "form-error"; host.setAttribute("role", "alert"); }
}

async function refreshAfterAdminMutation(successMessage) {
  toast(successMessage);
  try {
    await renderWithFeedback();
    return { refreshed: true, message: "" };
  } catch (err) {
    const detail = err.message || "Refresh failed";
    const message = `Change saved, but this Admin view could not refresh. ${detail}`;
    toast(message, true);
    return { refreshed: false, message };
  }
}

function lockAdminMutationControls(control) {
  const group = control?.closest?.(".member-role-actions");
  const controls = group?.querySelectorAll?.("button, select") || [control];
  [...controls].forEach((item) => { item.disabled = true; });
}

function clearFieldError(field) {
  if (!field?.id) return;
  const errorId = `${field.id}-error`;
  document.getElementById(errorId)?.remove();
  const describedBy = (field.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (describedBy.length) field.setAttribute("aria-describedby", describedBy.join(" "));
  else field.removeAttribute("aria-describedby");
  field.removeAttribute("aria-invalid");
}

function showFieldError(form, field, errorHost, message) {
  if (!form || !field || !errorHost) return;
  clearFieldError(field);
  errorHost.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = "form-error";
  alert.id = `${field.id}-error`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  errorHost.appendChild(alert);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute(
    "aria-describedby",
    [field.getAttribute("aria-describedby"), alert.id].filter(Boolean).join(" ")
  );
  field.focus();
}

export async function maybeRedirectToApply() {
  if (!isLive()) return;
  const cu = await store.getCurrentUser();
  if (!cu || cu.role !== "pending") return;
  const app = await store.getMyApplication();
  if (!app && window.location.hash !== "#/apply") {
    window.location.hash = "#/apply";
  }
}

function renderNotificationChrome(user, active, generation, rowsPromise = null) {
  notificationEl.hidden = !user;
  notificationEl.innerHTML = user ? views.notificationBellHTML(0, active) : "";
  if (!user) {
    notificationEl.removeAttribute("aria-label");
    notificationEl.removeAttribute("aria-current");
    return null;
  }

  notificationEl.setAttribute("aria-label", "Notifications");
  if (active) notificationEl.setAttribute("aria-current", "page");
  else notificationEl.removeAttribute("aria-current");

  // Best-effort and detached from ordinary route renders. The Notifications
  // page passes its own request so page content and the badge share one query.
  const request = rowsPromise || store.listMyNotifications();
  request.then((rows) => {
    if (generation !== renderGeneration) return;
    const unreadCount = rows.filter((row) => !row.read_at).length;
    notificationEl.innerHTML = views.notificationBellHTML(unreadCount, active);
    notificationEl.setAttribute(
      "aria-label",
      unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"
    );
  }).catch(() => {});
  return request;
}

async function renderWithFeedback() {
  const generation = ++renderGeneration;
  const routeLoader = document.getElementById("route-loader");
  viewEl.setAttribute("aria-busy", "true");
  const timer = setTimeout(() => {
    if (generation === renderGeneration) {
      if (routeLoader) routeLoader.hidden = false;
    }
  }, 300);
  try {
    await render(generation);
  } catch (err) {
    if (generation === renderGeneration) throw err;
  } finally {
    clearTimeout(timer);
    if (generation === renderGeneration) {
      if (routeLoader) routeLoader.hidden = true;
      viewEl.removeAttribute("aria-busy");
    }
  }
}

async function render(generation = renderGeneration) {
  const parts = parseHash();
  const [page, arg, arg2] = parts.length ? parts : ["home"];

  // Route rows are valid only for the Notifications render that committed
  // them. Invalidate before any replacement can await or fail.
  notificationRouteRows = null;

  // Entering the Schedule tab fresh (bottom nav, Home, Profile…) resets it
  // to this week + today — a week offset left over from earlier browsing
  // must not hide today's sessions. Back links from activity/checkout keep
  // the week and day you were looking at.
  if (page === "schedule" && !["schedule", "activity", "checkout"].includes(prevPage)) {
    views.resetScheduleState();
  }

  const notificationsActive = page === "notifications";
  const routeUser = store.currentUser();
  let notificationRowsPromise = null;
  let nextNotificationRouteRows = null;

  // Commit the bell and its active state before the Notifications request can
  // delay route content. This same promise is also consumed by the page.
  if (notificationsActive) {
    notificationRowsPromise = pendingNotificationRouteRequest
      || (routeUser ? store.listMyNotifications() : Promise.resolve([]));
    pendingNotificationRouteRequest = null;
    renderNotificationChrome(routeUser, true, generation, notificationRowsPromise);
  }

  let out;
  switch (page) {
    case "home":
      out = views.viewHome();
      break;
    case "schedule":
      out = views.viewSchedule();
      break;
    case "activity":
      out = views.viewActivity(arg);
      break;
    case "community":
      out = views.viewCommunity(arg);
      break;
    case "giving":
      out = await views.viewGiving({ ownsGeneration: () => generation === renderGeneration });
      break;
    case "account":
      out = await views.viewAccount(arg, arg2);
      break;
    case "apply": {
      const u = store.currentUser();
      out = u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();
      break;
    }
    case "notifications":
      nextNotificationRouteRows = await notificationRowsPromise;
      out = await views.viewNotifications(new Date(), nextNotificationRouteRows);
      break;
    case "checkout":
      out = views.viewCheckout(arg);
      break;
    case "pay":
      out = views.viewPay(arg);
      break;
    case "booking":
      out = views.viewBooking(arg);
      break;
    case "receipt":
      out = views.viewReceipt(arg);
      break;
    case "admin":
      out = arg === "activity"
        ? await views.viewAdminActivity(arg2)
        : arg === "campaign"
          ? await views.viewAdminCampaign(arg2)
          : arg === "users"
            ? { redirect: "#/admin/members" }
            : await views.viewAdmin(arg || "approvals");
      break;
    default:
      out = views.viewNotFound();
  }

  // A newer route may finish while this view was awaiting live data. Only
  // the latest generation may redirect or commit shared page chrome.
  if (generation !== renderGeneration) return;

  if (out && typeof out === "object" && out.redirect) {
    location.hash = out.redirect;
    return;
  }

  // Keep the local filter cache paired with this generation's HTML commit.
  if (notificationsActive) notificationRouteRows = nextNotificationRouteRows;
  viewEl.innerHTML = out;
  const user = store.currentUser();
  navEl.innerHTML = views.navHTML(NAV_FOR[page] ?? "home", user);
  avatarEl.classList.toggle("is-empty", !user);
  avatarEl.innerHTML = views.avatarHTML(user);
  if (!notificationsActive) renderNotificationChrome(user, false, generation);
  if (page === "activity") {
    const mapHost = viewEl.querySelector("#activity-map");
    if (mapHost) {
      void mountCommittedActivityMap(mapHost, {
        ownsGeneration: () => generation === renderGeneration,
      });
    }
  }
  window.scrollTo({ top: 0 });
  viewEl.focus({ preventScroll: true });
  prevPage = page;
}

document.addEventListener("input", async (e) => {
  const field = e.target;
  if (field?.getAttribute?.("aria-invalid") === "true") clearFieldError(field);
  if (field?.dataset?.input === "member-search") {
    views.adminMemberFilters.query = field.value;
    const cursor = field.selectionStart;
    await renderWithFeedback();
    const nextSearch = document.getElementById("member-search");
    nextSearch?.focus();
    nextSearch?.setSelectionRange?.(cursor, cursor);
  }
});

// --- Apply/details forms: toggle minor-only fields when age status changes --------

document.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== "age_over_18") return;
  const form = t.closest("form");
  if (!form || (!["apply", "membership-details"].includes(form.dataset.form) && form.id !== "form-apply")) return;
  const block = form.querySelector("[data-minor-only]");
  if (!block) return;
  const isMinor = t.value === "no";
  block.hidden = !isMinor;
  block.querySelectorAll("input").forEach((input) => {
    input.required = isMinor;
    if (!isMinor) input.value = "";
  });
});

function collectApplyDraftFields(form) {
  const fields = {};
  for (const [name, value] of new FormData(form).entries()) fields[name] = value;
  form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
    fields[input.name] = input.checked;
  });
  return fields;
}

function updateApplyDraftStatus(form, draft) {
  const status = form.querySelector("[data-draft-status]");
  if (!status || !draft) return;
  const time = new Date(draft.savedAt).toLocaleTimeString("en-HK", {
    hour: "numeric",
    minute: "2-digit",
  });
  status.textContent = `Saved at ${time}`;
}

function saveApplyDraftForm(form) {
  const draft = store.saveApplyDraft({ fields: collectApplyDraftFields(form) });
  updateApplyDraftStatus(form, draft);
  return draft;
}

const scheduleApplyDraftSave = (e) => {
  const form = e.target?.closest?.('form[data-form="apply"]');
  if (!form) return;
  clearTimeout(applyDraftTimer);
  applyDraftTimer = setTimeout(() => saveApplyDraftForm(form), APPLY_DRAFT_DEBOUNCE_MS);
};
document.addEventListener("input", scheduleApplyDraftSave);
document.addEventListener("change", scheduleApplyDraftSave);

// --- ICS download -------------------------------------------------------------------

function downloadICS(session) {
  const blob = new Blob([buildICS(session)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `itc-${session.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Calendar file downloaded");
}

// --- Click delegation -----------------------------------------------------------------

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  // Repeated forms route through the submit delegate via data-action. If a
  // nested submit button resolves to its parent form here, preventDefault()
  // below cancels the browser's submit event before that handler can run.
  if (!el || el instanceof HTMLFormElement) return;
  const { action } = el.dataset;
  e.preventDefault?.();

  switch (action) {
    case "notification-filter": {
      const kind = el.dataset.notificationFilter;
      const allowedKinds = ["all", "application", "decision", "role", "club", "personal"];
      if (parseHash()[0] !== "notifications" || !allowedKinds.includes(kind) || !notificationRouteRows) break;
      views.notificationFilters.kind = kind;
      viewEl.innerHTML = await views.viewNotifications(new Date(), notificationRouteRows);
      viewEl.querySelector(
        `[data-action="notification-filter"][data-notification-filter="${kind}"]`
      )?.focus();
      break;
    }
    case "admin-member-filter": {
      const { filterKey, filterValue } = el.dataset;
      const allowedValues = {
        status: ["all", "approved", "pending", "declined"],
        role: ["all", "member", "admin", "superadmin"],
      };
      if (!allowedValues[filterKey]?.includes(filterValue)) break;
      views.adminMemberFilters[filterKey] = filterValue;
      await renderWithFeedback();
      document.getElementById(`member-filter-${filterKey}-${filterValue}`)?.focus();
      break;
    }
    case "admin-member-filters-clear":
      views.adminMemberFilters.query = "";
      views.adminMemberFilters.status = "all";
      views.adminMemberFilters.role = "all";
      await renderWithFeedback();
      document.getElementById("member-search")?.focus();
      break;
    case "save-draft": {
      const form = el.closest('form[data-form="apply"]');
      if (!form) break;
      clearTimeout(applyDraftTimer);
      const draft = saveApplyDraftForm(form);
      toast(draft ? "Draft saved on this device" : "Unable to save draft", !draft);
      break;
    }
    case "discard-draft":
      clearTimeout(applyDraftTimer);
      store.clearApplyDraft();
      toast("Application draft discarded");
      await renderWithFeedback();
      break;
    case "sign-in-google":
      try {
        await withBusyControl(el, "Connecting…", () => store.signInWithGoogle());
      } catch (err) {
        toast(err.message || "Sign-in failed", true);
      }
      break;
    case "notification-open": {
      const destination = el.dataset.destination || "#/account";
      if (el.dataset.notificationRead !== "true") {
        try {
          await withBusyControl(
            el,
            "Opening…",
            () => store.markNotificationRead(el.dataset.notificationId),
            { replaceLabel: false, announceWithoutReplacing: true }
          );
        } catch {
          toast("Failed to mark notification read", true);
          break;
        }
      }

      // Let the single hashchange route path render and report destination
      // failures. A successful mark-read must never be relabelled as failed
      // because the destination itself could not load.
      location.hash = destination;
      break;
    }
    case "revoke-member": {
      const viewer = store.currentUser();
      if (!viewer || !["superadmin", "super_admin"].includes(viewer.role) || viewer.id === el.dataset.user) break;
      const name = el.dataset.memberName || "this member";
      if (!window.confirm(`Revoke ${name}’s access and move them to Pending?`)) break;
      let refreshResult = null;
      try {
        await withBusyControl(el, "Revoking…", async () => {
          if (isLive()) {
            await store.updateProfileRole(el.dataset.user, "pending");
          } else if (!store.setRole(el.dataset.user, "pending")) {
            throw new Error("Unable to confirm revoked access.");
          }
          refreshResult = await refreshAfterAdminMutation(`${name} moved to Pending.`);
        });
        if (refreshResult && !refreshResult.refreshed) lockAdminMutationControls(el);
      } catch (err) {
        toast(err.message || "Unable to revoke access", true);
      }
      break;
    }
    case "approve":
    case "decline": {
      if (el.disabled) break;
      const name = el.dataset.applicantName || "this member";
      if (action === "decline" && !window.confirm(`Decline ${name}’s membership application?`)) break;

      const decision = action === "approve" ? "member" : "declined";
      const card = el.closest("[data-approval-card]");
      const controls = [...(card?.querySelectorAll('[data-action="approve"], [data-action="decline"]') || [el])];
      const decisionError = card?.querySelector(".decision-error");
      if (decisionError) {
        decisionError.textContent = "";
        decisionError.hidden = true;
      }
      controls.forEach((control) => { control.disabled = true; });
      let mutationSucceeded = false;
      let refreshResult = null;
      try {
        await withBusyControl(el, action === "approve" ? "Approving…" : "Declining…", async () => {
          await store.decideApplication(el.dataset.user, decision);
          mutationSucceeded = true;
          refreshResult = await refreshAfterAdminMutation(action === "approve" ? "Approved." : "Declined.");
        });
        if (refreshResult && !refreshResult.refreshed && decisionError) {
          decisionError.textContent = refreshResult.message;
          decisionError.setAttribute("role", "alert");
          decisionError.hidden = false;
        }
      } catch (err) {
        const message = err.message || "Decision failed";
        if (decisionError) {
          decisionError.textContent = message;
          decisionError.setAttribute("role", "alert");
          decisionError.hidden = false;
        }
        toast(message, true);
      } finally {
        controls.forEach((control) => { control.disabled = mutationSucceeded && !refreshResult?.refreshed; });
      }
      break;
    }
    case "sched-day":
      views.scheduleState.selected = el.dataset.date;
      render();
      break;

    case "sched-week": {
      const st = views.scheduleState;
      st.weekOffset += Number(el.dataset.dir);
      st.selected =
        st.weekOffset === 0
          ? isoDate(todayLocal())
          : isoDate(addDays(mondayOf(todayLocal()), st.weekOffset * 7));
      render();
      break;
    }

    case "sched-filter":
      views.scheduleState.filter = el.dataset.filter;
      render();
      break;

    case "ics": {
      const s = findSession(store.activities(), el.dataset.session);
      if (s) downloadICS(s);
      break;
    }

    case "ics-booking": {
      const b = store.getBooking(el.dataset.booking);
      if (b) {
        downloadICS({
          id: b.sessionId,
          name: b.snapshot.name,
          dateISO: b.snapshot.dateISO,
          time: b.snapshot.time,
          durationMin: b.snapshot.durationMin,
          location: b.snapshot.location,
          blurb: "",
        });
      }
      break;
    }

    case "signout": {
      try {
        await withBusyControl(el, "Signing out…", async () => {
          await store.signOutLive();
          toast("Signed out");
          location.hash = "#/account";
          await renderWithFeedback();
        });
      } catch (err) {
        toast(err.message || "Sign-out failed", true);
      }
      break;
    }
    case "cancel-booking":
      if (confirm("Cancel this booking? A full refund will be issued (prototype rule).")) {
        try {
          store.cancelBooking(el.dataset.booking);
          toast("Booking cancelled — refund issued");
          render();
        } catch (err) { toast(err.message || "Unable to cancel booking", true); }
      }
      break;

    case "release-reservation":
      if (confirm("Release this reservation? Your spot may go to the waitlist.")) {
        try {
          const released = store.releaseReservation(el.dataset.booking);
          toast(released ? "Reservation released" : "Nothing to release", !released);
          render();
        } catch (err) { toast(err.message || "Unable to release reservation", true); }
      }
      break;

    case "defer-to":
      if (confirm("Move this booking to the selected session?")) {
        try {
          const moved = await store.deferBooking(el.dataset.booking, el.dataset.session);
          toast("Booking moved — payment carried over");
          location.hash = `#/booking/${moved.id}`;
          render();
        } catch (err) { toast(err.message || "Unable to move booking", true); }
      }
      break;

    case "connect-interest":
      // Stub for fellowship/meal sign-ups — the real flow will notify leaders.
      toast(`Noted — a leader will reach out about ${el.dataset.topic}`);
      break;

    case "giving-amount": {
      const input = document.getElementById("give-amount");
      if (input) input.value = el.dataset.amount;
      el.closest(".chip-row")?.querySelectorAll(".chip")
        .forEach((chip) => chip.classList.toggle("active", chip === el));
      break;
    }
    case "giving-back":
      views.givingState.step = 1;
      await renderWithFeedback();
      break;
    case "giving-confirm": {
      const g = views.givingState;
      const user = store.currentUser();
      try {
        await withBusyControl(el, "Recording…", async () => {
          store.recordDonation({ userId: user?.id, name: g.name, amount: g.amount, note: g.note, ref: g.ref, campaignId: g.campaignId });
          g.step = 3;
          toast("Gift recorded — awaiting confirmation");
          await renderWithFeedback();
        });
      } catch (err) { toast(err.message || "Unable to record gift", true); }
      break;
    }
    case "giving-reset":
      views.resetGivingState();
      await renderWithFeedback();
      break;
    case "campaign-publish": {
      const form = el.closest?.("form");
      if (!form || controlBusy.has(form) || !form.reportValidity()) break;
      clearCampaignError(form);
      const payload = campaignFormPayload(form);
      const name = String(payload.title || "").trim() || "this campaign";
      if (!window.confirm(`Publish “${name}”? Approved members will be notified.`)) break;
      try {
        await withCampaignMutationControl(form, el, "Publishing…", async () => {
          const campaign = await store.saveGivingCampaign(payload);
          await store.publishGivingCampaign(campaign.id);
          await refreshAfterAdminMutation(`“${name}” published.`);
        });
      } catch (err) { showCampaignError(el, err.message); toast(err.message || "Unable to publish campaign", true); }
      break;
    }
    case "campaign-close": {
      const form = el.closest?.("form");
      if (!form || controlBusy.has(form)) break;
      const name = el.dataset.campaignName || "this campaign";
      if (!window.confirm(`Close “${name}”? Closed campaigns cannot be edited or republished.`)) break;
      try {
        await withCampaignMutationControl(form, el, "Closing…", async () => {
          await store.closeGivingCampaign(el.dataset.campaign);
          await refreshAfterAdminMutation(`“${name}” closed.`);
        });
      } catch (err) { showCampaignError(el, err.message); toast(err.message || "Unable to close campaign", true); }
      break;
    }

    case "join-waitlist":
      try {
        const pos = store.joinWaitlist(store.currentUser().id, el.dataset.session);
        toast(`You're #${pos} on the waitlist`);
      } catch (err) { toast(err.message, true); }
      render();
      break;

    case "leave-waitlist":
      store.leaveWaitlist(store.currentUser().id, el.dataset.session);
      toast("Left the waitlist");
      render();
      break;

    case "join-interest":
      try {
        const pos = store.joinInterest(store.currentUser().id, el.dataset.session);
        toast(`You're #${pos} in line for Midtown`);
      } catch (err) { toast(err.message, true); }
      render();
      break;

    case "leave-interest":
      store.leaveInterest(store.currentUser().id, el.dataset.session);
      toast("Left the Midtown list");
      render();
      break;

    case "duty-claim":
      store.setDuty(store.currentUser().id, el.dataset.week);
      toast("You're on duty this week");
      render();
      break;

    case "confirm-payment": {
      const res = store.confirmBookingPayment(el.dataset.booking);
      toast(res ? "Payment confirmed — member notified" : "Nothing to confirm", !res);
      render();
      break;
    }

    case "midtown-toggle":
      store.setMidtownOpen(el.dataset.session, el.dataset.open === "1");
      toast(el.dataset.open === "1" ? "Midtown opened — interest list converting" : "Midtown closed");
      render();
      break;

    case "venue-tbc-toggle":
      store.setVenueTBC(el.dataset.session, el.dataset.on === "1");
      toast(el.dataset.on === "1" ? "Venue marked TBC" : "Venue confirmed");
      render();
      break;

    case "reset-week-venue": {
      const control = el;
      withBusyControl(control, "Resetting\u2026", async () => {
        try {
          await store.setWeekVenue(el.dataset.session, { location: null, mapsQuery: null });
          toast("Venue reset to the activity default");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to reset venue", true);
        }
      }, { busyKey: control });
      break;
    }

    case "copy-fps":
      if (el.dataset.phone && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(el.dataset.phone);
        toast("FPS number copied");
      } else {
        toast("Copy unsupported on this device");
      }
      break;

    case "copy-gym":
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(el.dataset.msg);
        toast("Gym message copied");
      } else {
        toast("Copy unsupported on this device");
      }
      break;
  }
});

// --- Form delegation ---------------------------------------------------------------------

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.dataset.form === "apply") {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Submitting…", async () => {
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.photo_consent = !!fd.get("photo_consent");
      try {
        await store.saveMyApplication(payload);
        toast(form.dataset.toast || "Application submitted.");
        location.hash = "#/home";
        await renderWithFeedback();
      } catch (err) {
        toast(err.message || "Submit failed", true);
      }
    });
    return;
  }

  const formAction = form.id || form.dataset.action;

  switch (formAction) {
    case "form-signin": {
      e.preventDefault();
      const email = new FormData(form).get("email");
      const res = store.signIn(email);
      const errEl = form.querySelector("#signin-error");
      if (!res.ok) {
        errEl.innerHTML = `<div class="form-error">No account found for that email — apply for membership below, then sign in with the same email to check your application.</div>`;
        return;
      }
      toast(`Welcome back, ${res.user.preferredName || res.user.fullName}`);
      location.hash = "#/home";
      render();
      break;
    }

    case "form-apply": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const errEl = form.querySelector("#apply-error");
      if (donorIdProblem(fd.get("donorId"))) {
        errEl.innerHTML = `<div class="form-error">That Donor ID doesn’t look right — it needs a hyphen between your last name and the 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). Please enter it again, or leave it blank if you don’t have one.</div>`;
        return;
      }
      const res = store.applyForMembership({
        fullName: fd.get("fullName") || "",
        preferredName: fd.get("preferredName") || "",
        email: fd.get("email") || "",
        phone: fd.get("phone") || "",
        emergencyName: fd.get("emergencyName") || "",
        emergencyPhone: fd.get("emergencyPhone") || "",
        heard: fd.get("heard") || "",
        ageConfirmed: fd.get("ageConfirmed") === "on",
        mediaConsent: fd.get("mediaConsent") === "on",
        donorId: fd.get("donorId") || "",
        indemnity: fd.get("indemnity") === "on",
      });
      if (!res.ok) {
        errEl.innerHTML = `<div class="form-error">An application already exists for that email — try signing in instead.</div>`;
        return;
      }
      toast("Application submitted — a leader will review it");
      location.hash = "#/account";
      render();
      break;
    }

    case "form-reserve": {
      e.preventDefault();
      const user = store.currentUser();
      if (!form.dataset.session || !user || user.status !== "approved") return;
      try {
        const booking = store.reserveSession(user.id, form.dataset.session);
        toast("Spot reserved — pay before the deadline");
        location.hash = `#/pay/${booking.id}`;
      } catch (err) {
        toast(err.message || "Unable to reserve this spot", true);
      }
      break;
    }

    case "form-mark-paid": {
      e.preventDefault();
      const booking = store.getBooking(form.dataset.booking);
      const user = store.currentUser();
      if (!booking || !user || booking.userId !== user.id) return;
      const fd = new FormData(form);
      try {
        store.markBookingPaid(booking.id, fd.get("method"), fd.get("ref"));
        toast("Payment marked — awaiting collector confirmation");
        location.hash = `#/booking/${booking.id}`;
      } catch (err) {
        toast(err.message || "Unable to mark payment", true);
      }
      break;
    }

    case "form-giving": {
      e.preventDefault();
      const fd = new FormData(form);
      const amount = Math.round(Number(fd.get("amount")));
      const name = String(fd.get("name") || "").trim();
      const errEl = form.querySelector("#giving-error");
      if (!amount || amount < 1) { errEl.innerHTML = `<div class="form-error">Enter an amount of at least HK$1.</div>`; return; }
      if (!name) { errEl.innerHTML = `<div class="form-error">Add your name so a leader can match your transfer.</div>`; return; }
      Object.assign(views.givingState, {
        step: 2, amount, name, note: String(fd.get("note") || "").trim(),
        ref: `GIVE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      });
      await renderWithFeedback();
      break;
    }

    case "form-donor-id": {
      e.preventDefault();
      const user = store.currentUser();
      if (!user) return;
      const errEl = form.querySelector("#donor-error");
      const raw = String(new FormData(form).get("donorId") || "").trim();
      if (donorIdProblem(raw)) {
        errEl.innerHTML =
          `<div class="form-error">That Donor ID doesn’t look right — it needs a hyphen between your last name and the 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). Please enter it again.</div>`;
        return;
      }
      if (!raw) {
        errEl.innerHTML = `<div class="form-error">Enter your Donor ID to save it.</div>`;
        return;
      }
      try {
        await store.updateMyDonorId(raw);
        toast("Donor ID saved");
        await renderWithFeedback();
      } catch (err) { toast(err.message || "Unable to save Donor ID", true); }
      break;
    }

    case "form-indemnity": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const user = store.currentUser();
      if (!user) return;
      store.acceptIndemnity(user.id);
      toast("Indemnity accepted & confirmed");
      render();
      break;
    }

    case "form-prayer": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const request = String(fd.get("request") || "").trim();
      if (!request) {
        form.querySelector("#prayer-error").innerHTML =
          `<div class="form-error">Write your prayer request first.</div>`;
        return;
      }
      const user = store.currentUser();
      store.recordPrayer({ userId: user ? user.id : null, name: fd.get("name"), request });
      toast("Prayer request sent — leaders will pray with you");
      location.hash = "#/community";
      render();
      break;
    }

    case "form-cancel-week": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const reason = String(new FormData(form).get("reason") || "").trim();
      if (!confirm("Cancel this session? Paid bookings auto-defer; waitlists dissolve.")) return;
      store.cancelSessionWeek(form.dataset.session, reason);
      toast("Session cancelled — members notified");
      render();
      break;
    }

    case "form-session-time": {
      e.preventDefault();
      store.setSessionTime(form.dataset.session, new FormData(form).get("time"));
      toast("Session time updated");
      render();
      break;
    }

    case "form-session-notice": {
      e.preventDefault();
      store.setSessionNotice(form.dataset.session, new FormData(form).get("notice"));
      toast("Session note posted");
      render();
      break;
    }

    case "form-payouts": {
      e.preventDefault();
      const fd = new FormData(form);
      store.updateCollectorPayouts(store.currentUser().id, {
        paymeLink: fd.get("paymeLink"),
        fpsPhone: fd.get("fpsPhone"),
      });
      toast("Payout details saved");
      render();
      break;
    }

    case "form-gym-note": {
      e.preventDefault();
      try {
        await store.confirmGymBooking(form.dataset.session, new FormData(form).get("note"));
        toast("Marked confirmed with the gym");
        render();
      } catch (err) {
        toast(err.message || "Unable to record gym confirmation", true);
      }
      break;
    }

    case "form-week-venue": {
      e.preventDefault();
      const control = form.querySelector('[type="submit"]');
      const controls = [...form.querySelectorAll("input, button")];
      const fd = new FormData(form);
      const location = String(fd.get("location") || "").trim();
      const enteredMapsQuery = String(fd.get("mapsQuery") || "").trim();
      const mapsQuery = enteredMapsQuery || location;
      await withBusyControl(control, "Saving\u2026", async () => {
        try {
          await store.setWeekVenue(form.dataset.session, {
            location,
            mapsQuery,
          });
          toast("Venue saved for this week");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to save venue", true);
        }
      }, { busyKey: form, controls });
      break;
    }

    case "form-campaign": {
      e.preventDefault();
      if (controlBusy.has(form) || !form.reportValidity()) return;
      const control = form.querySelector('[type="submit"]');
      clearCampaignError(form);
      await withCampaignMutationControl(form, control, "Saving…", async () => {
        try {
          const campaign = await store.saveGivingCampaign(campaignFormPayload(form));
          toast(form.dataset.campaign ? "Campaign saved." : "Campaign draft created.");
          location.hash = `#/admin/campaign/${campaign.id}`;
          await renderWithFeedback();
        } catch (err) { showCampaignError(control, err.message); toast(err.message || "Unable to save campaign", true); }
      });
      break;
    }

    case "form-activity": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const res = store.saveActivity({
        id: form.dataset.activity || "",
        name: String(fd.get("name") || "").trim(),
        kind: fd.get("kind"),
        category: fd.get("category"),
        weekday: fd.get("weekday"),
        time: fd.get("time") || "19:00",
        durationMin: fd.get("durationMin"),
        location: String(fd.get("location") || "").trim(),
        mapsQuery: String(fd.get("location") || "").trim(),
        blurb: String(fd.get("blurb") || "").trim(),
        memberNote: String(fd.get("memberNote") || "").trim(),
        photo: "../assets/itc/main.webp",
        price: fd.get("price"),
        capacity: fd.get("capacity"),
        published: fd.get("published") === "on",
      });
      toast(res.created ? "Activity created" : "Activity saved");
      location.hash = "#/admin/activities";
      render();
      break;
    }
  }
});

// --- Change delegation (selects) ------------------------------------------------------------

document.addEventListener("change", async (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;

  switch (el.dataset.change) {
    case "set-role": {
      const viewer = store.currentUser();
      if (!viewer || !["superadmin", "super_admin"].includes(viewer.role) || viewer.id === el.dataset.user) break;
      const labels = { member: "Member", admin: "Admin", superadmin: "Super Admin" };
      const name = el.dataset.memberName || "this member";
      const targetLabel = labels[el.value];
      if (!window.confirm(`Change ${name}’s role to ${targetLabel}?`)) {
        el.value = el.dataset.currentRole;
        break;
      }
      let refreshResult = null;
      try {
        await withBusyControl(el, "Updating…", async () => {
          if (isLive()) {
            const liveRole = el.value === "superadmin" ? "super_admin" : el.value;
            await store.updateProfileRole(el.dataset.user, liveRole);
          } else if (!store.setRole(el.dataset.user, el.value)) {
            throw new Error("Unable to confirm the role change.");
          }
          refreshResult = await refreshAfterAdminMutation(`${name} is now ${targetLabel}.`);
        });
        if (refreshResult && !refreshResult.refreshed) lockAdminMutationControls(el);
      } catch (err) {
        el.value = el.dataset.currentRole;
        toast(err.message || "Unable to change role", true);
      }
      break;
    }

    case "duty-set":
      if (el.value) {
        store.setDuty(el.value, el.dataset.week);
        toast("Duty handed over");
        render();
      }
      break;

    case "kind-toggle":
      form_kind_toggle(el);
      break;
  }
});

function form_kind_toggle(select) {
  const form = select.closest("form");
  if (!form) return;
  const isPaid = select.value === "paid";
  form.querySelectorAll(".paid-only").forEach((block) => block.classList.toggle("hidden", !isPaid));
}

// --- Boot ---------------------------------------------------------------------------------------

async function boot() {
  store.load();
  // Live mode: hydrate the synchronous view model before the first render
  // so Home renders with the correct signed-in state. The callback lock
  // is held by Supabase's own handler, so getCurrentUser() must not run
  // while it is held.
  if (isLive()) {
    let bootError = null;
    try {
      await store.getCurrentUser();
      await store.fetchApplicationForUser(store.currentUser());
      await store.hydrateLiveOperations({ ensureWindow: true });
    } catch (err) {
      bootError = err;
    }
    if (bootError) {
      toast(bootError.message || "Application read failed", true);
    }
  }
  if (!location.hash) location.hash = "#/home";
  window.addEventListener("hashchange", async () => {
    const generation = ++renderGeneration;
    // The Payment/Auth baseline hydrates identity before rendering. Commit
    // Notifications chrome synchronously so direct inbox navigation still
    // exposes its active state while that hydration is in flight.
    if (parseHash()[0] === "notifications") {
      const user = store.currentUser();
      pendingNotificationRouteRequest = user
        ? store.listMyNotifications()
        : Promise.resolve([]);
      renderNotificationChrome(user, true, generation, pendingNotificationRouteRequest);
    } else {
      pendingNotificationRouteRequest = null;
    }
    viewEl.setAttribute("aria-busy", "true");
    const routeLoader = document.getElementById("route-loader");
    const loaderTimer = setTimeout(() => {
      if (generation === renderGeneration && routeLoader) routeLoader.hidden = false;
    }, 300);
    let navError = null;
    if (isLive()) {
      try {
        await store.getCurrentUser();
        await store.fetchApplicationForUser(store.currentUser());
      } catch (err) {
        navError = err;
      }
    }
    if (navError) {
      toast(navError.message || "Application read failed", true);
    }
    // Do not commit if a newer navigation arrived while we were waiting.
    if (generation !== renderGeneration) {
      // Older listener: let the latest nav own the busy state and the DOM.
      return;
    }
    clearTimeout(loaderTimer);
    try {
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to load your account", true);
    }
  });

  // Live-mode auth listener: when Supabase completes sign-in, route the
  // pending user to /apply (if they have not yet submitted an application).
  if (isLive() && supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      setTimeout(async () => {
        try {
          await store.getCurrentUser();
          location.hash = "#/home";
          await renderWithFeedback();
          await maybeRedirectToApply();
        } catch (err) {
          toast(err.message || "Sign-in failed", true);
        }
      }, 0);
    });
  }

  await renderWithFeedback();
  if (isLive()) await maybeRedirectToApply();
}

export const bootPromise = boot().catch((err) => {
  console.error("Boot failed", err);
  const message = err?.message || String(err) || "Startup failed";
  toast(message, true);
  throw err;
});
