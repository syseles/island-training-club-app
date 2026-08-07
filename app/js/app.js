// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import * as views from "./views.js";
import { isLive, supabase } from "./config.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("bottom-nav");
const avatarEl = document.getElementById("top-avatar");
const toastStack = document.getElementById("toast-stack");

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
const controlBusy = new WeakSet();

// --- Async render + busy + feedback helpers (canonical Auth baseline) ---

async function withBusyControl(control, busyLabel, work) {
  if (!control || controlBusy.has(control)) return;
  controlBusy.add(control);
  const label = control.textContent;
  const canReplaceLabel = control.tagName !== "SELECT";
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  if (canReplaceLabel) control.textContent = busyLabel;
  try {
    return await work();
  } finally {
    controlBusy.delete(control);
    control.disabled = false;
    control.removeAttribute("aria-busy");
    if (canReplaceLabel) control.textContent = label;
  }
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

  // Entering the Schedule tab fresh (bottom nav, Home, Profile…) resets it
  // to this week + today — a week offset left over from earlier browsing
  // must not hide today's sessions. Back links from activity/checkout keep
  // the week and day you were looking at.
  if (page === "schedule" && !["schedule", "activity", "checkout"].includes(prevPage)) {
    views.resetScheduleState();
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
    case "account":
      out = await views.viewAccount(arg, arg2);
      break;
    case "apply": {
      const u = store.currentUser();
      out = u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();
      break;
    }
    case "notifications":
      out = await views.viewNotifications();
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
        : arg === "users"
          ? { redirect: "#/admin/members" }
          : await views.viewAdmin(arg || "approvals");
      break;
    default:
      out = views.viewNotFound();
  }

  if (out && typeof out === "object" && out.redirect) {
    if (generation === renderGeneration) location.hash = out.redirect;
    return;
  }

  // Only the latest navigation writes to the DOM. Older renders stay on disk
  // but never replace committed view content.
  if (generation !== renderGeneration) return;
  viewEl.innerHTML = out;
  const user = store.currentUser();
  navEl.innerHTML = views.navHTML(NAV_FOR[page] ?? "home", user);
  avatarEl.classList.toggle("is-empty", !user);
  avatarEl.innerHTML = views.avatarHTML(user);
  if (isLive() && user) {
    views.unreadBadge().then((badge) => {
      if (generation !== renderGeneration) return;
      const notificationLink = navEl.querySelector?.('a[href="#/notifications"]');
      if (notificationLink && badge) notificationLink.insertAdjacentHTML("afterbegin", badge);
    }).catch(() => {});
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
  if (!el) return;
  const { action } = el.dataset;
  e.preventDefault?.();

  switch (action) {
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
    case "sign-in-google":
      try {
        await withBusyControl(el, "Connecting…", () => store.signInWithGoogle());
      } catch (err) {
        toast(err.message || "Sign-in failed", true);
      }
      break;
    case "notification-open": {
      const id = el.dataset.notification;
      const user = store.currentUser();
      // Stale event suppression: when the row is already read we skip the
      // network round-trip entirely so the navigation feels instant.
      if (user && isLive()) {
        try {
          const cu = await store.getCurrentUser();
          const list = await store.listMyNotifications();
          const target = list.find((n) => n.id === id);
          if (!target || target.read_at) {
            if (target && target.link) location.hash = target.link;
            return;
          }
          await store.markNotificationRead(id);
          if (target.link) location.hash = target.link;
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Could not open notification", true);
        }
        return;
      }
      const link = el.dataset.link || "#/home";
      location.hash = link;
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

    case "demo-signin":
      // Retired; preserved as a no-op for legacy deployments.
      break;

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

    case "reset-demo":
      // Retired; local install starts empty.
      break;

    case "cancel-booking":
      if (confirm("Cancel this booking? A full refund will be issued (prototype rule).")) {
        store.cancelBooking(el.dataset.booking);
        toast("Booking cancelled — refund issued");
        render();
      }
      break;

    case "connect-interest":
      // Stub for fellowship/meal sign-ups — the real flow will notify leaders.
      toast(`Noted — a leader will reach out about ${el.dataset.topic}`);
      break;

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
      const res = store.confirmBookingPayment(el.dataset.booking, store.currentUser().id);
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

    case "copy-gym":
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(el.dataset.msg);
        toast("Gym message copied");
      } else {
        toast("Copy unsupported on this device");
      }
      break;
  }
});

// --- Form delegation ---------------------------------------------------------------------

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  switch (form.id) {
    case "form-signin": {
      e.preventDefault();
      const email = new FormData(form).get("email");
      const res = store.signIn(email);
      const errEl = form.querySelector("#signin-error");
      if (!res.ok) {
        errEl.innerHTML = `<div class="form-error">No account found for that email — apply for membership below, or use a demo profile.</div>`;
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
      const session = findSession(store.activities(), form.dataset.session);
      const user = store.currentUser();
      if (!session || !user || user.status !== "approved") return;
      try {
        const booking = store.reserveSession(user.id, session);
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

    case "form-checkout": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const sessionId = form.dataset.session;
      const session = findSession(store.activities(), sessionId);
      const user = store.currentUser();
      if (!session || !user) return;
      const btn = form.querySelector("#pay-btn");
      btn.disabled = true;
      btn.textContent = "Processing payment…";
      const last4 = String(new FormData(form).get("cardNumber") || "").replace(/\D/g, "").slice(-4);
      setTimeout(() => {
        try {
          const { booking } = store.payForSession(user.id, session, last4);
          toast("Payment confirmed — you’re booked");
          location.hash = `#/booking/${booking.id}`;
        } catch (err) {
          toast(err.message || "Payment failed", true);
          btn.disabled = false;
          btn.textContent = "Pay";
        }
      }, 900);
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
      const saved = store.updateDonorId(user.id, raw);
      if (!saved) {
        errEl.innerHTML = `<div class="form-error">Enter your Donor ID to save it.</div>`;
        return;
      }
      toast("Donor ID saved");
      render();
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
      store.confirmGymBooking(form.dataset.session, new FormData(form).get("note"));
      toast("Marked confirmed with the gym");
      render();
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
