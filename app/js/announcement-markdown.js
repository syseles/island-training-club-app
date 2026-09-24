function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInline(escapedLine) {
  return escapedLine
    .replace(/__([^_]+)__/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function assertSafeAnnouncementMarkdown(src) {
  const text = String(src || "");
  if (/<\s*[a-zA-Z/!]/.test(text)) {
    throw new Error("unsafe announcement markdown");
  }
}

export function renderAnnouncementMarkdown(src) {
  const text = String(src || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const parts = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${applyInline(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, "")))}</li>`);
        i += 1;
      }
      parts.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${applyInline(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, "")))}</li>`);
        i += 1;
      }
      parts.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const block = [];
    while (i < lines.length && lines[i].trim()
      && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      block.push(applyInline(escapeHtml(lines[i])));
      i += 1;
    }
    parts.push(`<p>${block.join("<br>")}</p>`);
  }
  return `<div class="announcement-body">${parts.join("")}</div>`;
}

export function announcementPlainText(src) {
  return String(src || "")
    .replace(/\r\n/g, "\n")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}
