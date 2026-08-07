// ==========================================================================
// ITC prototype — router, event delegation, boot.
// ==========================================================================

import * as store from "./store.js";
import { buildICS, findSession, todayLocal, mondayOf, addDays, isoDate, donorIdProblem } from "./data.js";
import * as views from "./views.js";

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
  shop: "shop",
  account: "account",
  apply: "account",
  checkout: "account",
  booking: "account",
  receipt: "account",
  admin: "admin",
};

let prevPage = null;

function render() {
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
    case "shop":
      out = views.viewShop();
      break;
    case "account":
      out = views.viewAccount(arg);
      break;
    case "apply": {
      const u = store.currentUser();
      out = u && u.status === "approved" ? { redirect: "#/account" } : views.viewApply();
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
      out = arg === "activity" ? views.viewAdminActivity(arg2) : views.viewAdmin(arg || "approvals");
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
  window.scrollTo({ top: 0 });
  prevPage = page;
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

document.addEventListener("click", (e) => {
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

    case "demo-signin":
      // No longer supported: the local prototype starts empty and uses
      // email sign-in only. Visitors who have not yet applied are
      // directed to the application form from the Account page.
      break;

    case "signout":
      store.signOut();
      toast("Signed out");
      location.hash = "#/home";
      render();
      break;

    case "reset-demo":
      // Reset action removed: a local install starts empty and never
      // accumulates demo data. Admin resets are handled via the Supabase
      // operational tools.
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

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  // Shop order forms repeat per product card, so they key off data-form
  // instead of a (necessarily unique) id.
  const key = form.id || form.dataset.form || "";

  switch (key) {
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

    case "form-shop-order": {
      e.preventDefault();
      const user = store.currentUser();
      if (!user) {
        toast("Sign in to place an order", true);
        return;
      }
      const fd = new FormData(form);
      const order = store.placeOrder(user.id, form.dataset.product, fd.get("size"), fd.get("qty"));
      toast(`Order placed — ${order.name} (${order.size})`);
      render();
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

store.load();
if (!location.hash) location.hash = "#/home";
window.addEventListener("hashchange", render);
render();
