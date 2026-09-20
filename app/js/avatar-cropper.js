import {
  avatarInitials,
  clampCrop,
  cropSourceRect,
  fitCrop,
  normalizeAvatarPresentation,
} from "./avatar.js";

export const AVATAR_FILE_ACCEPT = "image/jpeg,image/png,image/webp";
const ACCEPTED_TYPES = new Set(AVATAR_FILE_ACCEPT.split(","));
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const PREVIEW_SIZE = 280;

const makeElement = (documentRef, tagName, { className = "", text = "", attrs = {} } = {}) => {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
};

const imageDimensions = (image) => ({
  width: Number(image?.naturalWidth || image?.width),
  height: Number(image?.naturalHeight || image?.height),
});

async function decodeSelectedImage(file, { documentRef, createImageBitmapRef, urlRef }) {
  if (typeof createImageBitmapRef === "function") {
    const image = await createImageBitmapRef(file);
    return { image, release: () => image.close?.() };
  }

  if (!urlRef?.createObjectURL || !urlRef?.revokeObjectURL) {
    throw new Error("This browser cannot open the selected photo.");
  }
  const objectURL = urlRef.createObjectURL(file);
  const image = documentRef.createElement("img");
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The selected photo could not be decoded."));
      image.src = objectURL;
    });
  } finally {
    urlRef.revokeObjectURL(objectURL);
  }
  return { image, release: () => { image.src = ""; } };
}

export function moveCropByKey(crop, { key, shiftKey = false } = {}) {
  const direction = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[key];
  if (!direction) return crop;
  const step = shiftKey ? 32 : 8;
  return clampCrop({
    ...crop,
    offsetX: crop.offsetX + direction[0] * step,
    offsetY: crop.offsetY + direction[1] * step,
  });
}

export function renderCropToJpeg({
  image,
  crop,
  edge = 512,
  quality = 0.9,
  documentRef = globalThis.document,
}) {
  if (!documentRef?.createElement) return Promise.reject(new Error("Canvas is unavailable."));
  const outputEdge = Number(edge);
  if (!Number.isInteger(outputEdge) || outputEdge <= 0) {
    return Promise.reject(new TypeError("Output edge must be a positive integer."));
  }
  const canvas = documentRef.createElement("canvas");
  canvas.width = outputEdge;
  canvas.height = outputEdge;
  const context = canvas.getContext?.("2d", { alpha: false });
  if (!context || typeof canvas.toBlob !== "function") {
    return Promise.reject(new Error("Canvas is unavailable."));
  }
  const { sx, sy, sw, sh } = cropSourceRect(crop);
  context.drawImage(image, sx, sy, sw, sh, 0, 0, outputEdge, outputEdge);
  return new Promise((resolve, reject) => {
    canvas.toBlob?.((blob) => {
      if (!blob) return reject(new Error("The cropped photo could not be created."));
      if (blob.type !== "image/jpeg") return reject(new Error("The cropped photo is not a JPEG."));
      if (blob.size > MAX_UPLOAD_BYTES) return reject(new Error("The cropped photo is larger than 2 MB."));
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

export function openAvatarManager({
  memberName,
  presentation,
  moderated = false,
  onUpload,
  onRemove,
}, environment = {}) {
  const documentRef = environment.documentRef ?? globalThis.document;
  if (!documentRef?.body) throw new Error("Avatar manager requires a document.");
  if (typeof onUpload !== "function" || typeof onRemove !== "function") {
    throw new TypeError("Avatar manager actions are required.");
  }

  const decodeImage = environment.decodeImage ?? ((file) => decodeSelectedImage(file, {
    documentRef,
    createImageBitmapRef: environment.createImageBitmapRef ?? globalThis.createImageBitmap,
    urlRef: environment.urlRef ?? globalThis.URL,
  }));
  const renderCrop = environment.renderCrop ?? renderCropToJpeg;
  const trigger = documentRef.activeElement;
  const previousOverflow = documentRef.body.style.overflow ?? "";
  let selected = null;
  let crop = null;
  let busy = false;
  let closed = false;
  let drag = null;
  const currentPresentation = normalizeAvatarPresentation(presentation);

  const overlay = makeElement(documentRef, "div", { className: "avatar-manager-backdrop" });
  const dialog = makeElement(documentRef, "section", {
    className: "avatar-manager-dialog",
    attrs: {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "avatar-manager-title",
      "aria-describedby": "avatar-manager-help avatar-manager-status",
    },
  });
  const header = makeElement(documentRef, "header", { className: "avatar-manager-header" });
  const heading = makeElement(documentRef, "h2", {
    className: "display",
    text: "Manage Profile Photo",
    attrs: { id: "avatar-manager-title", "data-avatar-title": "manager" },
  });
  const closeButton = makeElement(documentRef, "button", {
    className: "avatar-manager-close",
    text: "Close",
    attrs: { type: "button", "data-avatar-action": "close" },
  });
  header.append(heading, closeButton);

  const body = makeElement(documentRef, "div", { className: "avatar-manager-body" });
  const member = makeElement(documentRef, "p", {
    className: "avatar-manager-member",
    text: String(memberName ?? "Member"),
  });
  const help = makeElement(documentRef, "p", {
    className: "muted",
    text: "Choose a photo, then drag and zoom to frame a square crop.",
    attrs: { id: "avatar-manager-help" },
  });
  const moderationState = presentation?.state;
  const fallbackCopy = moderationState === "hidden"
    ? "Your initials are shown while your photo is hidden."
    : moderationState === "pending_review"
    ? "Other members see your initials until this replacement is approved."
    : presentation?.source === "google"
    ? "Using your Google account photo. Choose a custom photo to replace it."
    : presentation?.source === "custom"
    ? "Using your custom photo. Removing it restores your Google photo when available, otherwise your initials."
    : "Your initials are shown until you add a photo.";
  const fallback = makeElement(documentRef, "p", {
    className: "avatar-manager-note",
    text: fallbackCopy,
    attrs: { "data-avatar-fallback": "copy" },
  });
  const moderationCopy = moderationState === "hidden"
    ? "A replacement will be sent to Admin for approval."
    : moderationState === "pending_review"
    ? "Your replacement is awaiting Admin approval."
    : moderated
    ? "Future replacements will appear after Admin approval."
    : "Your saved photo appears only on your profile and member-only attendee lists.";
  const moderation = makeElement(documentRef, "p", {
    className: moderationState === "hidden" || moderationState === "pending_review" || moderated
      ? "avatar-manager-note is-moderated"
      : "avatar-manager-note",
    text: moderationCopy,
  });

  const preview = makeElement(documentRef, "div", {
    className: "avatar-crop-stage",
    attrs: {
      tabindex: "0",
      role: "img",
      "aria-label": currentPresentation.url
        ? "Current profile photo. Choose a new photo to crop a replacement."
        : "Current profile photo uses initials. Choose a photo to add one.",
      "data-avatar-action": "crop",
      "data-cropping": "false",
    },
  });
  const currentInitials = makeElement(documentRef, "span", {
    className: "avatar-crop-current-initials",
    text: avatarInitials(memberName),
    attrs: { "aria-hidden": "true" },
  });
  currentInitials.hidden = Boolean(currentPresentation.url);
  let currentImage = null;
  if (currentPresentation.url) {
    currentImage = makeElement(documentRef, "img", {
      className: "avatar-crop-current-image",
      attrs: {
        src: currentPresentation.url,
        alt: "",
        "aria-hidden": "true",
      },
    });
    currentImage.addEventListener("error", () => {
      currentImage.hidden = true;
      if (!selected) currentInitials.hidden = false;
    });
  }
  const canvas = makeElement(documentRef, "canvas", { className: "avatar-crop-canvas" });
  canvas.width = 512;
  canvas.height = 512;
  canvas.hidden = true;
  preview.append(currentInitials);
  if (currentImage) preview.append(currentImage);
  preview.append(canvas);

  const zoomLabel = makeElement(documentRef, "label", { className: "avatar-zoom-label" });
  const zoomText = makeElement(documentRef, "span", { text: "Zoom" });
  const zoom = makeElement(documentRef, "input", {
    attrs: {
      type: "range",
      min: "1",
      max: "4",
      step: "0.01",
      value: "1",
      "data-avatar-action": "zoom",
    },
  });
  zoom.value = "1";
  zoomLabel.append(zoomText, zoom);

  const picker = makeElement(documentRef, "input", {
    className: "avatar-file-input",
    attrs: {
      type: "file",
      accept: AVATAR_FILE_ACCEPT,
      "data-avatar-action": "picker",
      "aria-label": "Choose a profile photo",
      tabindex: "-1",
    },
  });
  const actions = makeElement(documentRef, "div", { className: "avatar-manager-actions" });
  const chooseButton = makeElement(documentRef, "button", {
    className: "btn ghost",
    text: "Choose Photo",
    attrs: { type: "button", "data-avatar-action": "choose" },
  });
  const saveButton = makeElement(documentRef, "button", {
    className: "btn",
    text: "Save Photo",
    attrs: { type: "button", "data-avatar-action": "save" },
  });
  const removeButton = makeElement(documentRef, "button", {
    className: "btn danger",
    text: "Remove Photo",
    attrs: { type: "button", "data-avatar-action": "remove" },
  });
  saveButton.disabled = true;
  const canRemoveCustom = currentPresentation.source === "custom";
  removeButton.disabled = !canRemoveCustom;
  actions.append(chooseButton, saveButton, removeButton);

  const status = makeElement(documentRef, "p", {
    className: "avatar-manager-status muted",
    text: "",
    attrs: { id: "avatar-manager-status", "aria-live": "polite" },
  });
  body.append(member, help, fallback, moderation, preview, zoomLabel, picker, actions, status);
  dialog.append(header, body);
  overlay.append(dialog);

  const controls = [closeButton, preview, zoom, chooseButton, saveButton, removeButton];
  const setBusy = (value, message = "") => {
    busy = value;
    closeButton.disabled = value;
    chooseButton.disabled = value;
    picker.disabled = value;
    zoom.disabled = value || !selected;
    saveButton.disabled = value || !selected;
    removeButton.disabled = value || !canRemoveCustom;
    dialog.setAttribute("aria-busy", value ? "true" : "false");
    if (message) status.textContent = message;
  };
  zoom.disabled = true;

  const releaseSelected = () => {
    if (!selected) return;
    selected.release?.();
    selected = null;
  };

  const drawPreview = () => {
    if (!selected || !crop) return;
    const context = canvas.getContext?.("2d", { alpha: false });
    if (!context) return;
    const { sx, sy, sw, sh } = cropSourceRect(crop);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(selected.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    releaseSelected();
    overlay.remove();
    documentRef.body.style.overflow = previousOverflow;
    trigger?.focus?.();
  };

  closeButton.addEventListener("click", () => { if (!busy) close(); });
  chooseButton.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      status.textContent = "Choose a JPEG, PNG, or WebP photo.";
      return;
    }
    status.textContent = "Opening photo…";
    chooseButton.disabled = true;
    try {
      const decoded = await decodeImage(file);
      const { width, height } = imageDimensions(decoded.image);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        decoded.release?.();
        throw new Error("The selected photo has invalid dimensions.");
      }
      releaseSelected();
      selected = decoded;
      crop = fitCrop({ imageWidth: width, imageHeight: height, viewportSize: PREVIEW_SIZE });
      zoom.value = "1";
      zoom.disabled = false;
      saveButton.disabled = false;
      if (currentImage) currentImage.hidden = true;
      currentInitials.hidden = true;
      canvas.hidden = false;
      preview.setAttribute("role", "application");
      preview.setAttribute("data-cropping", "true");
      preview.setAttribute("aria-label", "Photo crop. Drag the image or use arrow keys to reposition it.");
      status.textContent = "Photo ready. Adjust the crop, then save.";
      drawPreview();
      preview.focus();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The selected photo could not be opened.";
    } finally {
      chooseButton.disabled = busy;
      picker.value = "";
    }
  });

  zoom.addEventListener("input", () => {
    if (!crop) return;
    crop = clampCrop({ ...crop, zoom: Number(zoom.value) });
    zoom.value = String(crop.zoom);
    drawPreview();
  });

  preview.addEventListener("keydown", (event) => {
    if (!crop) return;
    const next = moveCropByKey(crop, event);
    if (next === crop) return;
    event.preventDefault();
    crop = next;
    drawPreview();
  });
  preview.addEventListener("pointerdown", (event) => {
    if (!crop || busy) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    preview.setPointerCapture?.(event.pointerId);
  });
  preview.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id || !crop) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = { id: drag.id, x: event.clientX, y: event.clientY };
    crop = clampCrop({ ...crop, offsetX: crop.offsetX + dx, offsetY: crop.offsetY + dy });
    drawPreview();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    preview.releasePointerCapture?.(drag.id);
    drag = null;
  };
  preview.addEventListener("pointerup", endDrag);
  preview.addEventListener("pointercancel", endDrag);

  saveButton.addEventListener("click", async () => {
    if (busy || !selected || !crop) return;
    setBusy(true, "Saving photo…");
    try {
      const blob = await renderCrop({ image: selected.image, crop, documentRef });
      if (!blob || blob.type !== "image/jpeg" || blob.size > MAX_UPLOAD_BYTES) {
        throw new Error("The cropped photo could not be prepared safely.");
      }
      await onUpload(blob);
      status.textContent = moderated || moderationState === "hidden"
        ? "Photo sent for Admin approval."
        : "Photo saved.";
      close();
    } catch (error) {
      setBusy(false, error instanceof Error ? error.message : "Photo upload failed. Please try again.");
    }
  });

  removeButton.addEventListener("click", async () => {
    if (busy || !canRemoveCustom) return;
    setBusy(true, "Removing photo…");
    try {
      await onRemove();
      status.textContent = "Photo removed.";
      close();
    } catch (error) {
      setBusy(false, error instanceof Error ? error.message : "Photo removal failed. Please try again.");
    }
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const available = controls.filter((control) => !control.disabled && !control.hidden);
    if (!available.length) return;
    const current = available.indexOf(documentRef.activeElement);
    const next = event.shiftKey
      ? available[(current <= 0 ? available.length : current) - 1]
      : available[(current + 1) % available.length];
    if (current === -1 || (event.shiftKey && current === 0) || (!event.shiftKey && current === available.length - 1)) {
      event.preventDefault();
      next.focus();
    }
  });

  documentRef.body.style.overflow = "hidden";
  documentRef.body.append(overlay);
  closeButton.focus();
  return { close };
}
