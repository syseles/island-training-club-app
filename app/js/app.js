// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import * as views from "./views.js";
import { supabase, isLive } from "./config.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("bottom-nav");
const notificationEl = document.getElementById("top-notifications");
const avatarEl = document.getElementById("top-avatar");
const toastStack = document.getElementById("toast-stack");
const routeLoader = document.getElementById("route-loader");

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
  const raw = location.hash;
  // Supabase OAuth redirects land on /app/#access_token=… — auth params,
  // not a route. supabase-js strips the hash via history.replaceState,
  // which never fires hashchange, so guard here as well as on SIGNED_IN.
  if (raw.startsWith("#access_token")) return [];
  return raw
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
}

const NAV_FOR = {
  home: "home",
  schedule: "schedule",
  activity: "schedule",
  community: "community",
  account: "account",
  apply: "account",
  checkout: "account",
  booking: "account",
  receipt: "account",
  admin: "admin",
  notifications: "",
};

let prevPage = null;
const controlBusy = new WeakSet();

async function withBusyControl(control, busyLabel, work, options = {}) {
  if (!control || controlBusy.has(control)) return;
  controlBusy.add(control);
  const label = control.textContent;
  const canReplaceLabel = options.replaceLabel ?? control.tagName !== "SELECT";
  const announceWithoutReplacing = options.announceWithoutReplacing === true;
  const hadAriaLabel = control.hasAttribute("aria-label");
  const ariaLabel = control.getAttribute("aria-label");
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  if (canReplaceLabel) control.textContent = busyLabel;
  if (announceWithoutReplacing) {
    control.setAttribute("aria-label", busyLabel);
    control.classList.toggle("is-busy", true);
  }
  try {
    return await work();
  } finally {
    controlBusy.delete(control);
    control.disabled = false;
    control.removeAttribute("aria-busy");
    if (canReplaceLabel) control.textContent = label;
    if (announceWithoutReplacing) {
      if (hadAriaLabel) control.setAttribute("aria-label", ariaLabel);
      else control.removeAttribute("aria-label");
      control.classList.toggle("is-busy", false);
    }
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

// Live-mode auth listener: when Supabase completes sign-in, route the
// pending user to /apply (if they have not yet submitted an application).
if (isLive() && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_IN") return;
    setTimeout(async () => {
      try {
        // Hydrate the synchronous view model before rendering Home. Without
        // this handoff, OAuth succeeds but Home still renders as a visitor.
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

export async function maybeRedirectToApply() {
  if (!isLive()) return;
  const cu = await store.getCurrentUser();
  if (!cu || cu.role !== "pending") return;
  const app = await store.getMyApplication();
  if (!app && window.location.hash !== "#/apply") {
    window.location.hash = "#/apply";
  }
}

let renderGeneration = 0;
let notificationRouteRows = null;

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
  viewEl.setAttribute("aria-busy", "true");
  const timer = setTimeout(() => {
    if (generation === renderGeneration) routeLoader.hidden = false;
  }, 300);
  try {
    await render(generation);
  } catch (err) {
    if (generation === renderGeneration) throw err;
  } finally {
    clearTimeout(timer);
    if (generation === renderGeneration) {
      routeLoader.hidden = true;
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

  const notificationsActive = page === "notifications";
  const routeUser = store.currentUser();
  let notificationRowsPromise = null;

  // Commit the bell and its active state before the Notifications request can
  // delay route content. This same promise is also consumed by the page.
  if (notificationsActive) {
    notificationRowsPromise = routeUser ? store.listMyNotifications() : Promise.resolve([]);
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
    case "account":
      // Awaited: account sections can fetch live application data and use
      // an optional edit-mode segment such as #/account/details/edit.
      out = await views.viewAccount(arg, arg2);
      break;
    case "apply": {
      const u = store.currentUser();
      out = u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();
      break;
    }
    case "checkout":
      out = views.viewCheckout(arg);
      break;
    case "booking":
      out = views.viewBooking(arg);
      break;
    case "receipt":
      out = views.viewReceipt(arg);
      break;
    case "admin":
      // The tabbed admin page is canonical. Keep old bookmarks working by
      // redirecting the removed users subpage to its Members replacement.
      out =
        arg === "activity"
          ? views.viewAdminActivity(arg2)
          : arg === "users"
            ? { redirect: "#/admin/members" }
            : await views.viewAdmin(arg || "approvals");
      break;
    case "notifications":
      notificationRouteRows = await notificationRowsPromise;
      out = await views.viewNotifications(new Date(), notificationRouteRows);
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

  viewEl.innerHTML = out;
  const user = store.currentUser();
  navEl.innerHTML = views.navHTML(NAV_FOR[page] ?? "home", user);
  avatarEl.classList.toggle("is-empty", !user);
  avatarEl.innerHTML = views.avatarHTML(user);

  if (!notificationsActive) renderNotificationChrome(user, false, generation);
  window.scrollTo({ top: 0 });
  viewEl.focus({ preventScroll: true });
  prevPage = page;
}

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

// Custom errors become stale as soon as the member edits that field.
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

    case "sched-day":
      views.scheduleState.selected = el.dataset.date;
      await renderWithFeedback();
      break;

    case "sched-week": {
      const st = views.scheduleState;
      st.weekOffset += Number(el.dataset.dir);
      st.selected =
        st.weekOffset === 0
          ? isoDate(todayLocal())
          : isoDate(addDays(mondayOf(todayLocal()), st.weekOffset * 7));
      await renderWithFeedback();
      break;
    }

    case "sched-filter":
      views.scheduleState.filter = el.dataset.filter;
      await renderWithFeedback();
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

    case "demo-signin": {
      const res = store.demoSignIn(el.dataset.role);
      if (res.ok) {
        toast(`Signed in as ${res.user.preferredName || res.user.fullName} (demo)`);
        location.hash = "#/home";
        await renderWithFeedback();
      }
      break;
    }

    case "signout": {
      // signOutLive clears the Supabase session in live mode and falls back
      // to local signOut otherwise — without it the live session survives.
      try {
        await withBusyControl(el, "Signing out…", async () => {
          await store.signOutLive();
          toast("Signed out");
          // Back to the sign-in page — the account page IS the visitor front door.
          location.hash = "#/account";
          await renderWithFeedback();
        });
      } catch (err) {
        toast(err.message || "Sign-out failed", true);
      }
      break;
    }

    case "sign-in-google":
      try {
        await withBusyControl(el, "Connecting…", () => store.signInWithGoogle());
      } catch (err) {
        toast(err.message || "Sign-in failed", true);
      }
      break;

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

    case "reset-demo":
      if (confirm("Reset all demo data? Bookings, applications and edits will be cleared.")) {
        store.resetDemo();
        toast("Demo data reset");
        location.hash = "#/home";
        await renderWithFeedback();
      }
      break;

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

    case "cancel-booking":
      if (confirm("Cancel this booking? A full refund will be issued (prototype rule).")) {
        store.cancelBooking(el.dataset.booking);
        toast("Booking cancelled — refund issued");
        await renderWithFeedback();
      }
      break;

    case "connect-interest":
      // Stub for fellowship/meal sign-ups — the real flow will notify leaders.
      toast(`Noted — a leader will reach out about ${el.dataset.topic}`);
      break;
  }
});

// --- Form delegation ---------------------------------------------------------------------

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  // Live-mode application form (data-form="apply"). The local-mode form
  // is handled below by id "form-apply".
  if (form.dataset.form === "apply") {
    e.preventDefault();
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

  if (form.dataset.form === "membership-details") {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Saving…", async () => {
      const fd = new FormData(form);
      try {
        await store.updateMyMembershipDetails(Object.fromEntries(fd.entries()));
        toast("Membership details saved");
        location.hash = "#/account/details";
      } catch (err) {
        toast(err.message || "Unable to save membership details", true);
      }
    });
    return;
  }

  if (form.dataset.form === "privacy-preferences") {
    e.preventDefault();
    const control = form.querySelector('[type="submit"]');
    await withBusyControl(control, "Saving…", async () => {
      const fd = new FormData(form);
      try {
        await store.updateMyPrivacyPreferences({
          photo_consent: fd.has("photo_consent"),
          whatsapp_reminders: fd.has("whatsapp_reminders"),
          email_receipts: fd.has("email_receipts"),
          community_news: fd.has("community_news"),
        });
        toast("Privacy preferences saved");
        location.hash = "#/account/privacy";
      } catch (err) {
        console.error(err);
        toast("Unable to save privacy preferences", true);
      }
    });
    return;
  }

  switch (form.id) {
    case "form-signin": {
      e.preventDefault();
      const email = new FormData(form).get("email");
      const res = store.signIn(email);
      const errEl = form.querySelector("#signin-error");
      if (!res.ok) {
        showFieldError(
          form,
          form.querySelector("#signin-email"),
          errEl,
          "No account found for that email — apply for membership below, or use a demo profile."
        );
        return;
      }
      toast(`Welcome back, ${res.user.preferredName || res.user.fullName}`);
      location.hash = "#/home";
      await renderWithFeedback();
      break;
    }

    case "form-apply": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const errEl = form.querySelector("#apply-error");
      if (donorIdProblem(fd.get("donorId"))) {
        showFieldError(
          form,
          form.querySelector("#ap-donor"),
          errEl,
          "That Donor ID doesn’t look right — it needs a hyphen between your last name and the 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). Please enter it again, or leave it blank if you don’t have one."
        );
        return;
      }
      try {
        const res = store.applyForMembership({
          fullName: fd.get("fullName") || "",
          preferredName: fd.get("preferredName") || "",
          email: fd.get("email") || "",
          phone: fd.get("phone") || "",
          emergencyName: fd.get("emergencyName") || "",
          emergencyPhone: fd.get("emergencyPhone") || "",
          heard: fd.get("heard") || "",
          ageOver18: fd.get("age_over_18"),
          guardianName: fd.get("guardianName") || "",
          guardianPhone: fd.get("guardianPhone") || "",
          mediaConsent: fd.get("mediaConsent") === "on",
          donorId: fd.get("donorId") || "",
          indemnity: fd.get("indemnity") === "on",
        });
        if (!res.ok) {
          showFieldError(form, form.querySelector("#ap-email"), errEl, "An application already exists for that email — try signing in instead.");
          return;
        }
      } catch (err) {
        showFieldError(form, form.querySelector("#ap-email"), errEl, err.message || "Application failed.");
        return;
      }
      toast("Application submitted — a leader will review it");
      location.hash = "#/account";
      await renderWithFeedback();
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
      const last4 = String(new FormData(form).get("cardNumber") || "").replace(/\D/g, "").slice(-4);
      await withBusyControl(btn, "Processing…", () => new Promise((resolve) => {
        setTimeout(() => {
          try {
            const { booking } = store.payForSession(user.id, session, last4);
            toast("Payment confirmed — you’re booked");
            location.hash = `#/booking/${booking.id}`;
          } catch (err) {
            toast(err.message || "Payment failed", true);
          } finally {
            resolve();
          }
        }, 900);
      }));
      break;
    }

    case "form-donor-id": {
      e.preventDefault();
      const user = store.currentUser();
      if (!user) return;
      const errEl = form.querySelector("#donor-error");
      const raw = String(new FormData(form).get("donorId") || "").trim();
      const donorField = form.querySelector("#donor-id");
      if (donorIdProblem(raw)) {
        showFieldError(
          form,
          donorField,
          errEl,
          "That Donor ID doesn’t look right — it needs a hyphen between your last name and the 4- or 5-digit number (e.g. CHUI-08879 or CHUI-8879). Please enter it again."
        );
        return;
      }
      const saved = store.updateDonorId(user.id, raw);
      if (!saved) {
        showFieldError(form, donorField, errEl, "Enter your Donor ID to save it.");
        return;
      }
      toast("Donor ID saved");
      await renderWithFeedback();
      break;
    }

    case "form-indemnity": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const user = store.currentUser();
      if (!user) return;
      const control = form.querySelector('[type="submit"]');
      await withBusyControl(control, "Confirming…", async () => {
        try {
          await store.acceptMyIndemnity();
          toast("Indemnity accepted and confirmed");
          await renderWithFeedback();
        } catch (err) {
          toast(err.message || "Unable to confirm indemnity", true);
        }
      });
      break;
    }

    case "form-prayer": {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const request = String(fd.get("request") || "").trim();
      if (!request) {
        showFieldError(
          form,
          form.querySelector("#pr-text"),
          form.querySelector("#prayer-error"),
          "Write your prayer request first."
        );
        return;
      }
      const user = store.currentUser();
      store.recordPrayer({ userId: user ? user.id : null, name: fd.get("name"), request });
      toast("Prayer request sent — leaders will pray with you");
      location.hash = "#/community";
      await renderWithFeedback();
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
        baseBooked: fd.get("baseBooked"),
        published: fd.get("published") === "on",
      });
      toast(res.created ? "Activity created" : "Activity saved");
      location.hash = "#/admin/activities";
      await renderWithFeedback();
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
  if (isLive()) await store.getCurrentUser();
  if (!location.hash) location.hash = "#/home";
  window.addEventListener("hashchange", async () => {
    try {
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to load your account", true);
    }
  });
  await renderWithFeedback();
  await maybeRedirectToApply();
}

export const bootPromise = boot().catch((err) => {
  toast(err.message || "Unable to load your account", true);
});
