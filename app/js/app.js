// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import * as views from "./views.js";
import { supabase, isLive } from "./config.js";

const viewEl = document.getElementById("view");
const navEl = document.getElementById("bottom-nav");
const avatarEl = document.getElementById("top-avatar");
const toastStack = document.getElementById("toast-stack");

// --- Toasts --------------------------------------------------------------------

export function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = `toast${isErr ? " err" : ""}`;
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
  notifications: "notifications",
};

let prevPage = null;

// Live-mode auth listener: when Supabase completes sign-in, route the
// pending user to /apply (if they have not yet submitted an application).
if (isLive() && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") {
      // Hydrate the synchronous view model before rendering Home. Without
      // this handoff, OAuth succeeds but Home still renders as a visitor.
      store.getCurrentUser().then(() => {
        location.hash = "#/home";
        render();
        maybeRedirectToApply();
      }).catch((err) => toast(err.message || "Sign-in failed", true));
    }
  });
}

export async function maybeRedirectToApply() {
  if (!isLive()) return;
  const cu = await store.getCurrentUser();
  // Every role applies — including the bootstrap super admin. No
  // application on file → the form is the first stop after sign-in.
  if (!cu) return;
  const app = await store.getMyApplication();
  if (!app && window.location.hash !== "#/apply") {
    window.location.hash = "#/apply";
  }
}

async function render() {
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
      // Awaited: the live Membership Details view is async; sync views
      // resolve through await unchanged.
      out = await views.viewAccount(arg);
      break;
    case "apply": {
      const u = store.currentUser();
      // The approved-redirect is local-mode only; in live mode
      // viewApplyLive decides (any role may still need to apply).
      out = !isLive() && u && u.status === "approved" ? { redirect: "#/account" } : await views.viewApply();
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
      // The tabbed admin page (approvals / activities / members) is the
      // canonical admin surface — Admin Tools and the Admin tab both land
      // here. #/admin/users stays as the role-audit subpage.
      out =
        arg === "activity"
          ? views.viewAdminActivity(arg2)
          : arg === "users"
            ? await views.viewAdminUsers()
            : await views.viewAdmin(arg || "approvals");
      break;
    case "notifications":
      out = await views.viewNotifications();
      break;
    default:
      out = views.viewNotFound();
  }

  if (out && typeof out === "object" && out.redirect) {
    location.hash = out.redirect;
    return;
  }

  viewEl.innerHTML = out;
  const user = store.currentUser();
  navEl.innerHTML = views.navHTML(NAV_FOR[page] ?? "home", user);
  avatarEl.classList.toggle("is-empty", !user);
  avatarEl.innerHTML = views.avatarHTML(user);
  // Best-effort: append unread-count badge to the Notifications nav item.
  if (isLive() && user) {
    views.unreadBadge().then((badge) => {
      const notifLink = navEl.querySelector('a[href="#/notifications"]');
      if (notifLink && badge) notifLink.insertAdjacentHTML("afterbegin", badge);
    }).catch(() => {});
  }
  window.scrollTo({ top: 0 });
  prevPage = page;
}

// --- Live apply form: toggle minor-only fields when DOB changes ---------

document.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== "date_of_birth") return;
  const form = t.closest('form[data-form="apply"]');
  if (!form) return;
  const block = form.querySelector("[data-minor-only]");
  if (!block) return;
  const age = computeAge(t.value);
  const isMinor = age < 18 && age >= 0;
  block.hidden = !isMinor;
  block.querySelectorAll("input").forEach((el) => { el.required = isMinor; });
});

function computeAge(dob) {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

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

    case "demo-signin": {
      const res = store.demoSignIn(el.dataset.role);
      if (res.ok) {
        toast(`Signed in as ${res.user.preferredName || res.user.fullName} (demo)`);
        location.hash = "#/home";
        render();
      }
      break;
    }

    case "signout": {
      // signOutLive clears the Supabase session in live mode and falls back
      // to local signOut otherwise — without it the live session survives.
      await store.signOutLive();
      toast("Signed out");
      // Back to the sign-in page — the account page IS the visitor front door.
      location.hash = "#/account";
      render();
      break;
    }

    case "sign-in-google":
      store.signInWithGoogle().catch((err) => toast(err.message || "Sign-in failed"));
      break;

    case "approve":
    case "promote":
    case "demote": {
      const roleMap = { approve: "member", promote: "admin", demote: "member" };
      const msgMap  = { approve: "Approved.", promote: "Promoted to admin.", demote: "Demoted to member." };
      const id = el.dataset.id;
      try {
        await store.updateProfileRole(id, roleMap[action]);
        toast(msgMap[action]);
        render();
      } catch (err) {
        toast(err.message || "Action failed");
      }
      break;
    }

    case "revoke": {
      const id = el.dataset.id;
      const profile = await store.listProfiles().then((all) => all.find((p) => p.id === id));
      const typed = window.prompt(`Type the user's email to confirm revocation: ${profile?.email || ""}`);
      if (typed !== profile?.email) break;
      try {
        await store.updateProfileRole(id, "pending");
        toast("Revoked.");
        render();
      } catch (err) {
        toast(err.message || "Revoke failed");
      }
      break;
    }

    case "notification-open": {
      const id = el.closest("[data-notification-id]").dataset.notificationId;
      try {
        await store.markNotificationRead(id);
        render();
      } catch (err) {
        toast(err.message || "Failed to mark read");
      }
      break;
    }

    case "reset-demo":
      if (confirm("Reset all demo data? Bookings, applications and edits will be cleared.")) {
        store.resetDemo();
        toast("Demo data reset");
        location.hash = "#/home";
        render();
      }
      break;

    case "approve": {
      store.approveApplicant(el.dataset.user);
      toast("Applicant approved — they now have member access");
      render();
      break;
    }

    case "decline":
      store.declineApplicant(el.dataset.user);
      toast("Applicant declined");
      render();
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
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.photo_consent = !!fd.get("photo_consent");
    try {
      await store.saveMyApplication(payload);
      toast(form.dataset.toast || "Application submitted.");
      location.hash = "#/home";
      await render();
    } catch (err) {
      toast(err.message || "Submit failed");
    }
    return;
  }

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
      render();
      break;
    }
  }
});

// --- Change delegation (selects) ------------------------------------------------------------

document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;

  switch (el.dataset.change) {
    case "set-role":
      store.setRole(el.dataset.user, el.value);
      toast(`Role updated to ${el.value}`);
      render();
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
  if (isLive()) await store.getCurrentUser();
  if (!location.hash) location.hash = "#/home";
  window.addEventListener("hashchange", render);
  render();
  maybeRedirectToApply();
}

boot().catch((err) => toast(err.message || "Unable to load your account", true));
