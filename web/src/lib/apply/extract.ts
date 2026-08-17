import type { Page, Frame } from "playwright-core";

export type ApplyField = {
  id: string; // our stable handle, also set as data-co-field on the live element
  type: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "checkbox" | "radio" | "file";
  label: string;
  required: boolean;
  options?: string[];
  maxLength?: number;
  value?: string;
  combobox?: boolean; // react-select-style widget → fill via click+type+Enter, not selectOption
  nativeId?: string; // the live element's id/name — used to match ATS API schemas (Greenhouse)
  nativeName?: string;
  placeholder?: string;
  nearbyText?: string;
  ariaLabel?: string;
  autocomplete?: string;
  visible?: boolean;
  enabled?: boolean;
  section?: string;
};

export type ExtractedForm = { title: string; url: string; fields: ApplyField[] };

// Extract the application form's STRUCTURE (not pixels) and TAG each control with
// a stable `data-co-field` id on the LIVE page (which the session keeps open), so
// the later fill phase can locate each field deterministically. Generic DOM/a11y
// introspection — clean ATS (Ashby/Lever/Greenhouse) work well; Workday best-effort.
export async function extractForm(ctx: Page | Frame): Promise<ExtractedForm> {
  const data = await ctx.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
    // generic placeholders that masquerade as labels (Ashby/react-select)
    const isGenericPh = (s: string) => /^(start typing|select\b|choose|search\b|type\b|--|please select|e\.?g\.?)/i.test(s.trim());
    // a usable label: not empty, not a UUID, not a generic placeholder
    const ok = (s: string | null | undefined) => {
      const t = (s || "").trim();
      return t && !isUuid(t) && !isGenericPh(t) ? t : "";
    };
    // Pure label text: a wrapping <label>Gender<select>…</select></label> would
    // otherwise swallow all option text (Lever). Strip controls/options first.
    const pure = (node: Element | null): string => {
      if (!node) return "";
      const c = node.cloneNode(true) as Element;
      c.querySelectorAll?.("input, select, textarea, option, button, [role=option], [class*='menu' i]").forEach((n) => n.remove());
      return clean(c.textContent);
    };

    // The field WRAPPER (Ashby `ashby-application-form-field-entry`, Greenhouse
    // `select__container`/`field`, generic `form-group`/`fieldset`) — deliberately
    // NOT a bare `div` (that matches the immediate parent and misses the real label
    // which lives one wrapper up).
    function fieldGroup(el: Element): Element | null {
      return el.closest(
        '[class*="field-entry" i], [class*="fieldEntry" i], [class*="form-group" i], [class*="question" i], [class*="field__" i], [class*="__field" i], fieldset, [class*="field" i]',
      );
    }

    function labelFor(el: Element): string {
      const aria = el.getAttribute("aria-label");
      if (ok(aria)) return aria!;
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        if (ok(t)) return t;
      }
      const id = (el as HTMLElement).id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l && ok(pure(l))) return pure(l);
      }
      const parentLabel = el.closest("label");
      if (parentLabel && ok(pure(parentLabel))) return pure(parentLabel);
      // the question title inside the field wrapper (handles Ashby's
      // `ashby-application-form-question-title`, Greenhouse `select__label`, etc.)
      const grp = fieldGroup(el);
      if (grp) {
        const lab = grp.querySelector(
          'label, legend, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i]',
        );
        if (lab && ok(pure(lab))) return pure(lab);
      }
      // walk up a few ancestors for a nearby label/heading
      let c: Element | null = el.parentElement;
      for (let i = 0; i < 4 && c; i++, c = c.parentElement) {
        const lab = c.querySelector('label, legend, [class*="label" i], [class*="title" i], h3, h4, h5');
        if (lab && ok(pure(lab))) return pure(lab);
      }
      const prev = el.previousElementSibling;
      if (prev && ok(pure(prev))) return pure(prev);
      const ph = (el as HTMLInputElement).placeholder;
      if (ok(ph)) return ph;
      const name = (el as HTMLInputElement).name;
      return ok(name); // never a UUID/placeholder; "" → caller shows "Untitled"
    }

    // Visible option text for a radio — never the question title from the field wrapper.
    function optionText(radio: Element): string {
      const id = (radio as HTMLElement).id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const t = l ? pure(l) : "";
        if (t && t.length <= 80) return t;
      }
      const wrap = radio.closest("label");
      if (wrap) {
        const t = pure(wrap);
        if (t && t.length <= 80) return t;
      }
      const aria = radio.getAttribute("aria-label");
      if (ok(aria) && String(aria).length <= 80) return String(aria);
      let sib = radio.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
        const t = pure(sib) || clean(sib.textContent);
        if (t && t.length <= 80 && !isUuid(t)) return t;
      }
      const val = (radio as HTMLInputElement).value || "";
      if (val === "1" || /^true$/i.test(val)) return "Yes";
      if (val === "0" || val === "2" || /^false$/i.test(val)) return "No";
      if (val && !/^[0-9]+$/.test(val) && val.length <= 80) return val;
      return "";
    }

    // The QUESTION of a radio group — NOT the first option's label. Look for a
    // radiogroup/fieldset aria-label/legend, else the first label/heading in the
    // group's container that isn't one of the options.
    function groupLabel(firstRadio: Element, options: string[]): string {
      const rg = firstRadio.closest("[role=radiogroup], fieldset");
      if (rg) {
        const al = rg.getAttribute("aria-label");
        if (al) return al;
        const lb = rg.getAttribute("aria-labelledby");
        if (lb) {
          const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
          if (t.trim()) return t;
        }
        const legend = rg.querySelector("legend");
        if (legend?.textContent?.trim()) return legend.textContent;
      }
      const optSet = new Set(options.map((o) => o.toLowerCase()));
      const container = fieldGroup(firstRadio) || firstRadio.parentElement?.parentElement || firstRadio.parentElement;
      if (container) {
        const cands = container.querySelectorAll(
          'label, legend, h1, h2, h3, h4, h5, h6, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i], [class*="question" i]',
        );
        for (const c of Array.from(cands)) {
          const t = pure(c);
          if (t && t.length > 2 && t.length < 160 && !optSet.has(t.toLowerCase()) && !isUuid(t) && !isGenericPh(t)) return t;
        }
      }
      return "";
    }

    const fields: Array<Record<string, unknown>> = [];
    const seenRadio = new Set<string>();
    const groupIds = new WeakMap<Element, string>();
    let groupSeq = 0;
    const els = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable='true']"));
    let n = 0;

    function allocFid(el: Element): string {
      const existing = el.getAttribute("data-co-field");
      if (existing) return existing;
      while (document.querySelector(`[data-co-field="co${n}"]`)) n++;
      return `co${n++}`;
    }

    function nearbyText(el: Element): string {
      const grp = fieldGroup(el) || el.parentElement;
      return clean((grp as HTMLElement | null)?.innerText).slice(0, 220);
    }

    function sectionFor(el: Element): string {
      const fs = el.closest("fieldset");
      const legend = fs?.querySelector("legend");
      if (legend && ok(pure(legend))) return pure(legend);
      const section = el.closest("section, [class*='section' i], [class*='step' i]");
      const heading = section?.querySelector("h1, h2, h3, legend, [class*='heading' i]");
      return heading && ok(pure(heading)) ? pure(heading) : "";
    }

    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const itype = ((el as HTMLInputElement).type || "").toLowerCase();
      if (tag === "input" && ["hidden", "submit", "button", "image", "reset", "password"].includes(itype)) continue;
      // Hidden native <select> still backs Lever "Select..." widgets.
      if (
        (el as HTMLElement).offsetParent === null &&
        itype !== "radio" &&
        itype !== "checkbox" &&
        itype !== "file" &&
        tag !== "select" &&
        !(el as HTMLElement).isContentEditable
      ) {
        continue;
      }
      // skip ATS "autofill from resume / parse my CV" helper widgets (Ashby) — these
      // are convenience uploaders, not real application fields.
      if ((el as Element).closest('[class*="autofill" i]')) continue;

      // react-select widgets render an extra internal/autosize <input> next to the
      // real role=combobox input. Keep ONLY the combobox; drop the dummy (it's the
      // "Untitled field" noise). The combobox carries the question's aria label.
      const inReactSelect = (el as Element).closest('[class*="select__"], .select-shell');
      const isCombobox = el.getAttribute("role") === "combobox";
      if (inReactSelect && tag === "input" && !isCombobox) continue;

      const required = (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true";
      const nativeId = (el as HTMLElement).id || undefined;
      const nativeName = (el as HTMLInputElement).name || undefined;
      const fid = allocFid(el);
      const ariaLabel = el.getAttribute("aria-label") || undefined;
      const autocomplete = (el as HTMLInputElement).autocomplete || undefined;
      const enabled = !(el as HTMLInputElement).disabled;
      const visible = (el as HTMLElement).offsetParent !== null || itype === "radio" || itype === "checkbox" || tag === "select";
      const meta = { nearbyText: nearbyText(el), ariaLabel, autocomplete, enabled, visible, section: sectionFor(el) || undefined };

      const contenteditable = (el as HTMLElement).isContentEditable && tag !== "input" && tag !== "textarea" && tag !== "select";
      if (contenteditable) {
        el.setAttribute("data-co-field", fid);
        const ml = Number((el as HTMLElement).getAttribute("maxlength") || (el as HTMLElement).getAttribute("data-maxlength") || 0);
        fields.push({
          id: fid,
          type: "textarea",
          label: clean(labelFor(el)),
          required,
          nativeId,
          nativeName,
          maxLength: ml > 0 ? ml : undefined,
          ...meta,
        });
        continue;
      }

      if (isCombobox) {
        el.setAttribute("data-co-field", fid);
        fields.push({ id: fid, type: "select", combobox: true, label: clean(labelFor(el)), required, options: [], nativeId, nativeName, ...meta });
        continue;
      }

      if (itype === "radio") {
        const name = (el as HTMLInputElement).name;
        const grp = fieldGroup(el);
        if (grp && !groupIds.has(grp)) groupIds.set(grp, `g${++groupSeq}`);
        const key = name || (grp ? groupIds.get(grp)! : "");
        if (key && seenRadio.has(key)) {
          continue;
        }
        if (key) seenRadio.add(key);
        const group = name
          ? Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`))
          : grp
            ? Array.from(grp.querySelectorAll('input[type=radio]'))
            : [el];
        const options = group.map((r) => optionText(r) || (r as HTMLInputElement).value).filter(Boolean);
        group.forEach((r, i) => {
          r.setAttribute("data-co-field", fid);
          r.setAttribute("data-co-option", options[i] ?? String(i));
        });
        fields.push({ id: fid, type: "radio", label: clean(groupLabel(el, options)) || name, required, options, ...meta });
        continue;
      }

      el.setAttribute("data-co-field", fid);

      if (tag === "select") {
        const options = Array.from((el as HTMLSelectElement).options).map((o) => clean(o.textContent)).filter((o) => o && !/^(select|choose|--)/i.test(o));
        fields.push({ id: fid, type: "select", label: clean(labelFor(el)), required, options, nativeId, nativeName, ...meta });
        continue;
      }
      const type = tag === "textarea" ? "textarea" : ["email", "tel", "url", "number", "date", "checkbox", "file"].includes(itype) ? itype : "text";
      const ml = (el as HTMLInputElement).maxLength;
      const placeholder = clean((el as HTMLInputElement).placeholder);
      let label = clean(labelFor(el));
      if (type === "file" && (!label || /^untitled$/i.test(label))) {
        const around = clean((el.parentElement?.innerText || "").slice(0, 160));
        if (/resume|cv|curriculum/i.test(around)) label = "Resume";
        else if (/cover/i.test(around)) label = "Cover letter";
      }
      fields.push({
        id: fid,
        type,
        label,
        required,
        maxLength: ml && ml > 0 ? ml : undefined,
        value: (el as HTMLInputElement).value || undefined,
        nativeId,
        nativeName,
        placeholder: placeholder || undefined,
        ...meta,
      });
    }

    const seenRoleGroup = new WeakSet<Element>();
    for (const el of Array.from(document.querySelectorAll('[role="radio"]'))) {
      if (el.getAttribute("data-co-field")) continue;
      const groupEl = (el.closest("[role=radiogroup], fieldset") || el.parentElement) as Element | null;
      if (groupEl && seenRoleGroup.has(groupEl)) continue;
      if (groupEl) seenRoleGroup.add(groupEl);
      const group = groupEl ? Array.from(groupEl.querySelectorAll('[role="radio"]')) : [el];
      const options = group.map((r) => clean(r.getAttribute("aria-label") || optionText(r) || r.textContent || "")).filter(Boolean);
      const fid = allocFid(el);
      group.forEach((r, i) => {
        r.setAttribute("data-co-field", fid);
        r.setAttribute("data-co-option", options[i] ?? String(i));
      });
      fields.push({
        id: fid,
        type: "radio",
        label: clean(groupLabel(group[0], options)) || options[0] || "Choice",
        required: groupEl?.getAttribute("aria-required") === "true" || false,
        options,
        nearbyText: nearbyText(group[0] || el),
        section: sectionFor(group[0] || el) || undefined,
      });
    }

    for (const el of Array.from(document.querySelectorAll('[role="combobox"]'))) {
      if (el.getAttribute("data-co-field")) continue;
      if (el.querySelector("[data-co-field]") || el.closest("[data-co-field]")) continue;
      if ((el as HTMLElement).offsetParent === null) continue;
      const fid = allocFid(el);
      el.setAttribute("data-co-field", fid);
      fields.push({
        id: fid,
        type: "select",
        combobox: true,
        label: clean(labelFor(el)),
        required: el.getAttribute("aria-required") === "true",
        options: [],
        nativeId: (el as HTMLElement).id || undefined,
        nativeName: (el as HTMLInputElement).name || undefined,
        nearbyText: nearbyText(el),
        ariaLabel: el.getAttribute("aria-label") || undefined,
      });
    }

    for (const el of Array.from(document.querySelectorAll('[aria-haspopup="listbox"], [aria-haspopup="true"][role="button"]'))) {
      if (el.getAttribute("data-co-field")) continue;
      if (el.querySelector("[data-co-field]") || el.closest("[data-co-field]")) continue;
      if ((el as HTMLElement).offsetParent === null) continue;
      const fid = allocFid(el);
      el.setAttribute("data-co-field", fid);
      fields.push({
        id: fid,
        type: "select",
        combobox: true,
        label: clean(labelFor(el)),
        required: el.getAttribute("aria-required") === "true",
        options: [],
        nearbyText: nearbyText(el),
        ariaLabel: el.getAttribute("aria-label") || undefined,
      });
    }

    return { title: document.title, fields };
  });

  return { title: data.title, url: ctx.url(), fields: data.fields as ApplyField[] };
}
