/**
 * semantic-extract.mjs — Inspect an application form without hardcoded ATS selectors.
 * Uses labels, accessible names, surrounding text, and DOM structure.
 */

/**
 * Runs inside the page. Must stay self-contained (no imports).
 */
export function semanticExtractorInBrowser() {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const ok = (s) => {
    const t = clean(s);
    return t && !/^[0-9a-f-]{36}$/i.test(t) ? t : "";
  };
  const pure = (node) => {
    if (!node) return "";
    const c = node.cloneNode(true);
    c.querySelectorAll?.("input, select, textarea, option, button").forEach((n) => n.remove());
    return clean(c.textContent);
  };
  const group = (el) =>
    el.closest("fieldset") ||
    el.closest(
      '[class*="field-entry" i], [class*="form-group" i], [class*="question" i], [class*="field" i]'
    ) ||
    el.closest("label") ||
    el.closest("div");

  function accessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (ok(aria)) return aria;
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      if (ok(t)) return t;
    }
    return "";
  }

  function labelFor(el) {
    const acc = accessibleName(el);
    if (acc) return acc;
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l && ok(pure(l))) return pure(l);
    }
    const parentLabel = el.closest("label");
    if (parentLabel && ok(pure(parentLabel))) return pure(parentLabel);
    const grp = group(el);
    if (grp) {
      const lab = grp.querySelector("label, legend, [class*='question-title' i], [class*='label' i]");
      if (lab && ok(pure(lab))) return pure(lab);
    }
    const ph = el.placeholder;
    if (ok(ph)) return ph;
    return ok(el.name);
  }

  const fields = [];
  const seenRadio = new Set();
  const els = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox']"));
  let n = 0;

  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const itype = (el.type || "").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(itype)) continue;
    // File inputs are often visually hidden by ATS widgets; still extract them.
    if (el.offsetParent === null && itype !== "radio" && itype !== "checkbox" && itype !== "file") continue;
    if (el.closest('[class*="autofill" i]')) continue;

    const nativeId = el.id || undefined;
    const nativeName = el.name || undefined;
    const fid = nativeId || `field_${n++}`;
    const acc = accessibleName(el);
    const label = labelFor(el);
    const surrounding = clean(group(el)?.innerText).slice(0, 280);
    const required = !!(el.required || el.getAttribute("aria-required") === "true");
    el.setAttribute("data-co-field", fid);

    if (itype === "radio") {
      const rname = el.name || fid;
      if (seenRadio.has(rname)) continue;
      seenRadio.add(rname);
      const fs = el.closest("fieldset");
      const legend = fs ? pure(fs.querySelector("legend")) : "";
      const groupEls = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(rname)}"]`));
      const options = groupEls.map((r) => clean(labelFor(r) || r.value)).filter(Boolean);
      fields.push({
        id: fid,
        name: nativeName || rname,
        label: legend || label,
        accessibleName: acc || legend || label,
        ariaLabel: el.getAttribute("aria-label") || "",
        placeholder: el.placeholder || "",
        surroundingText: clean((fs || group(el))?.innerText).slice(0, 280),
        type: "radio",
        required,
        options,
        nativeId,
        nativeName,
      });
      continue;
    }

    let type = tag === "textarea" ? "textarea" : itype || tag;
    if (el.getAttribute("role") === "combobox") type = "select";
    let options = [];
    if (tag === "select") {
      options = Array.from(el.options)
        .map((o) => clean(o.textContent))
        .filter((o) => o && !/^(select|choose|--)/i.test(o));
    }

    fields.push({
      id: fid,
      name: nativeName || fid,
      label: label || `Field ${n}`,
      accessibleName: acc || label,
      ariaLabel: el.getAttribute("aria-label") || "",
      placeholder: el.placeholder || "",
      surroundingText: surrounding,
      type,
      required,
      options,
      nativeId,
      nativeName,
      value: el.value || "",
    });
  }
  return fields;
}

export async function inspectApplicationForm(page) {
  if (!page || typeof page.evaluate !== "function") return [];
  const frames = typeof page.frames === "function" ? page.frames() : [page];
  let best = [];
  for (const fr of frames) {
    try {
      const fields = await fr.evaluate(semanticExtractorInBrowser);
      if (Array.isArray(fields) && fields.length > best.length) best = fields;
    } catch {
      /* detached or cross-origin frame */
    }
  }
  return best;
}

export function detectPlatformFromPage(url = "", html = "") {
  const text = `${url} ${html}`.toLowerCase();
  if (/greenhouse/.test(text)) return "greenhouse";
  if (/\blever\.co\b|\blever-jobs\b/.test(text)) return "lever";
  if (/ashbyhq|ashby-/.test(text)) return "ashby";
  if (/workday|myworkdayjobs/.test(text)) return "workday";
  if (/smartrecruiters/.test(text)) return "smartrecruiters";
  if (/bamboohr/.test(text)) return "bamboohr";
  return "generic";
}
