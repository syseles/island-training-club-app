// Reusable read-and-accept modal component.
// Owns: backdrop, focus trap, ESC-to-close, scroll-end detection,
// sticky acknowledgement button, and the acknowledgement callback.
//
// Public API:
//   SCROLL_END_THRESHOLD_PX                — constant exported for testing
//   isAtScrollEnd(top,h,scroll)            — pure scroll-end math
//   applyIndemnityAcceptance(t)            — DOM-mutation helper for the ack callback
//   openIndemnityModal({onAccept, trigger})— the modal itself
//
// The modal currently renders only the indemnity document, but is designed
// so any future document body can be swapped in by changing the body source.

import * as indemnityDoc from "./documents.js";

export const SCROLL_END_THRESHOLD_PX = 4;

export function isAtScrollEnd(scrollTop, clientHeight, scrollHeight) {
  return scrollTop + clientHeight >= scrollHeight - SCROLL_END_THRESHOLD_PX;
}

export function applyIndemnityAcceptance(trigger) {
  const form = trigger && trigger.closest ? trigger.closest("form") : null;
  const checkbox = form && form.querySelector
    ? form.querySelector("[data-indemnity-checkbox]")
    : null;
  if (!checkbox) return false;
  checkbox.disabled = false;
  checkbox.checked = true;
  const hint = form.querySelector("[data-indemnity-hint]");
  if (hint) hint.hidden = true;
  return true;
}

export function openIndemnityModal({ onAccept, trigger } = {}) {
  const previouslyFocused = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "indemnity-modal-title");

  dialog.innerHTML = `
    <header class="modal-header">
      <h2 id="indemnity-modal-title" class="display sm">Health &amp; Liability Indemnity</h2>
      <button type="button" class="modal-close" aria-label="Close document">×</button>
    </header>
    <div class="modal-doc">
      <div class="modal-doc-body" tabindex="0">
        ${indemnityDoc.renderIndemnityDocument()}
      </div>
      <footer class="modal-doc-ack">
        <p class="muted small" data-modal-hint>Scroll to the end of the document to continue.</p>
        <button type="button" class="btn" disabled data-modal-ack>I have read this document</button>
      </footer>
    </div>`;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const body = dialog.querySelector(".modal-doc-body");
  const ackButton = dialog.querySelector("[data-modal-ack]");

  function updateAckState() {
    ackButton.disabled = !isAtScrollEnd(body.scrollTop, body.clientHeight, body.scrollHeight);
  }
  body.addEventListener("scroll", updateAckState, { passive: true });
  requestAnimationFrame(updateAckState);

  // --- focus trap ---
  function getFocusables() {
    return [...dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);
  }
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  dialog.addEventListener("keydown", trapFocus);
  (getFocusables()[0] || dialog).focus();

  // --- close paths ---
  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  dialog.querySelector(".modal-close").addEventListener("click", close);

  // --- acknowledgement ---
  ackButton.addEventListener("click", () => {
    if (typeof onAccept === "function") onAccept(trigger || null);
    close();
  });
}
