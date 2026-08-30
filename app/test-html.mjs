const decodeHtml = (value) => String(value).replace(
  /&(amp|lt|gt|quot|#39);/g,
  (entity, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name] ?? entity
);

const attributeValue = (attributes, name) => {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
};

export function assertFpsCopyBindings(html, expectedBindings, context) {
  const displayedValues = new Map(
    [...html.matchAll(/<div class="line(?: total)?"><span>([^<]*)<\/span><strong(?: class="[^"]*")?>([\s\S]*?)<\/strong><\/div>/g)]
      .map((match) => [decodeHtml(match[1]), match[2]])
  );
  const controls = [...html.matchAll(/<button\b([^>]*data-action="copy-(?:fps|reference)"[^>]*)>/g)]
    .map((match) => ({
      action: attributeValue(match[1], "data-action"),
      kind: attributeValue(match[1], "data-copy-kind"),
      rawValue: attributeValue(match[1], "data-copy-value"),
    }));

  if (controls.length !== expectedBindings.length) {
    throw new Error(`${context} rendered ${controls.length} FPS copy actions; expected ${expectedBindings.length}`);
  }

  const unmatched = [...controls];
  for (const expected of expectedBindings) {
    const controlIndex = unmatched.findIndex(
      (control) => control.action === expected.action && control.kind === expected.kind
    );
    if (controlIndex < 0) {
      throw new Error(`${context} missing ${expected.action}/${expected.kind} copy action`);
    }
    const [control] = unmatched.splice(controlIndex, 1);
    const rawDisplayedValue = displayedValues.get(expected.label);
    if (rawDisplayedValue === undefined) {
      throw new Error(`${context} missing displayed ${expected.label}`);
    }
    if (rawDisplayedValue !== expected.escaped || control.rawValue !== expected.escaped) {
      throw new Error(`${context} must HTML-escape displayed and copied ${expected.label} identically`);
    }
    if (decodeHtml(rawDisplayedValue) !== expected.value || decodeHtml(control.rawValue) !== expected.value) {
      throw new Error(`${context} copied ${expected.label} must decode to the exact displayed value`);
    }
  }
}
