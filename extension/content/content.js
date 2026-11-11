// Content script aislado: guarda los eventos recientes de la página, dibuja
// el selector de elementos / área y arma el contexto del DOM.
(() => {
  if (window.__t3CaptureContent) return;
  window.__t3CaptureContent = true;

  const MAX_INTERACTIONS = 200;
  const MAX_CONSOLE = 150;
  const MAX_NETWORK = 150;
  const HOST_TAG = "t3-capture-overlay";

  const buffers = { interaction: [], console: [], network: [] };
  const limits = { interaction: MAX_INTERACTIONS, console: MAX_CONSOLE, network: MAX_NETWORK };
  const pageLoadedAt = Date.now();
  let captureInputValues = true;
  let picking = false;
  let overlay = null;

  browser.storage.local.get("settings").then(({ settings }) => {
    if (settings && typeof settings.captureInputValues === "boolean") captureInputValues = settings.captureInputValues;
  });
  browser.storage.onChanged.addListener((changes) => {
    const next = changes.settings?.newValue;
    if (next && typeof next.captureInputValues === "boolean") captureInputValues = next.captureInputValues;
  });

  const push = (kind, entry) => {
    const list = buffers[kind];
    list.push(entry);
    if (list.length > limits[kind]) list.splice(0, list.length - limits[kind]);
  };

  const clip = (s, n) => {
    s = String(s ?? "");
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };

  // ---------- entradas del mundo de la página ----------
  document.addEventListener("t3capture:main-entry", (event) => {
    try {
      const entry = JSON.parse(event.detail);
      const kind = entry.kind;
      delete entry.kind;
      if (kind in buffers) push(kind, entry);
    } catch {
      /* ignorar */
    }
  });

  // ---------- selectores ----------
  const cssEscape = (v) => (window.CSS?.escape ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));

  const isUnique = (selector, root = document) => {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa", "aria-label", "name", "role"];
  const looksGenerated = (v) => /\d{3,}|[a-f0-9]{8,}|^(css|sc|jsx|svelte|emotion)-|__/i.test(v);

  function segmentFor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !looksGenerated(el.id)) {
      const sel = `#${cssEscape(el.id)}`;
      if (isUnique(sel)) return { sel, unique: true };
    }
    for (const attr of STABLE_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && value.length < 80) {
        const sel = `${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel)) return { sel, unique: true };
      }
    }
    let sel = tag;
    const classes = [...el.classList].filter((c) => !looksGenerated(c)).slice(0, 2);
    if (classes.length) sel += classes.map((c) => `.${cssEscape(c)}`).join("");
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { sel, unique: false };
  }

  function uniqueSelector(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const { sel, unique } = segmentFor(node);
      parts.unshift(sel);
      const candidate = parts.join(" > ");
      if (unique || isUnique(candidate)) return candidate;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function xpathFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let index = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) index++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      node = node.parentElement;
    }
    return `/${parts.join("/")}`;
  }

  function shortDescriptor(el) {
    if (!(el instanceof Element)) return String(el?.nodeName ?? "?");
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 3);
    if (cls.length) s += `.${cls.join(".")}`;
    const testid = el.getAttribute("data-testid");
    if (testid) s += `[data-testid="${testid}"]`;
    return s;
  }

  // ---------- accesibilidad ----------
  const IMPLICIT_ROLES = {
    a: (el) => (el.hasAttribute("href") ? "link" : null),
    button: () => "button",
    select: () => "combobox",
    textarea: () => "textbox",
    img: () => "img",
    nav: () => "navigation",
    main: () => "main",
    header: () => "banner",
    footer: () => "contentinfo",
    form: () => "form",
    table: () => "table",
    ul: () => "list",
    ol: () => "list",
    li: () => "listitem",
    dialog: () => "dialog",
    h1: () => "heading",
    h2: () => "heading",
    h3: () => "heading",
    h4: () => "heading",
    h5: () => "heading",
    h6: () => "heading",
    input: (el) =>
      ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", range: "slider", search: "searchbox" })[
        el.type
      ] || "textbox",
  };

  function accessibleRole(el) {
    return el.getAttribute("role") || IMPLICIT_ROLES[el.tagName.toLowerCase()]?.(el) || null;
  }

  function accessibleName(el) {
    const label = el.getAttribute("aria-label");
    if (label) return clip(label, 200);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (text) return clip(text, 200);
    }
    if (el.labels?.length) return clip([...el.labels].map((l) => l.textContent.trim()).join(" "), 200);
    const alt = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder");
    if (alt) return clip(alt, 200);
    const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return text ? clip(text, 200) : null;
  }

  // ---------- frameworks ----------
  // Los fibers de React y las instancias de Vue viven en el mundo de la
  // página, que este script aislado no ve. Se los pedimos a recorder-main.js
  // con un evento síncrono (ver "componentes React/Vue" allá).
  let probeResult;
  document.addEventListener("t3capture:probe-result", (event) => {
    probeResult = event.detail;
  });

  function frameworkInfo(el) {
    probeResult = undefined;
    try {
      el.dispatchEvent(new CustomEvent("t3capture:probe"));
      return typeof probeResult === "string" ? JSON.parse(probeResult) : null;
    } catch {
      return null;
    }
  }

  // ---------- campos sensibles ----------
  function isSensitiveField(el) {
    if (!(el instanceof Element)) return false;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    const name = `${el.getAttribute("name") || ""} ${el.id || ""}`.toLowerCase();
    return (
      type === "password" ||
      type === "hidden" ||
      /cc-|card|password|one-time-code|new-password|current-password/.test(auto) ||
      /pass(word)?|secret|token|cvv|cvc|ssn|card.?number/.test(name)
    );
  }

  function fieldValue(el) {
    if (!("value" in el)) return undefined;
    if (isSensitiveField(el)) return "[oculto]";
    if (!captureInputValues) return `[${String(el.value ?? "").length} caracteres]`;
    return clip(el.value, 120);
  }

  // ---------- click derecho ----------
  // Firefox resuelve el elemento del menú contextual con
  // menus.getTargetElement(). En Chrome no existe: guardamos el último.
  let lastContextTarget = null;
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (!isOwnNode(e.target)) lastContextTarget = e.target instanceof Element ? e.target : e.target?.parentElement || null;
    },
    true,
  );

  // ---------- grabación de interacciones ----------
  const isOwnNode = (node) => node instanceof Element && (node.tagName?.toLowerCase() === HOST_TAG || node.closest?.(HOST_TAG));

  const targetInfo = (el) => {
    if (!(el instanceof Element)) return { target: String(el?.nodeName ?? "") };
    const text = (el.innerText || el.value || el.getAttribute?.("aria-label") || "").trim().replace(/\s+/g, " ");
    return { target: uniqueSelector(el), text: text ? clip(text, 60) : undefined };
  };

  let lastInput = null;
  const record = (type, data) => push("interaction", { t: Date.now(), type, ...data });

  for (const type of ["click", "dblclick", "contextmenu"]) {
    window.addEventListener(
      type,
      (e) => {
        if (picking || isOwnNode(e.target)) return;
        const el = e.target instanceof Element ? e.target.closest("a,button,[role=button],input,select,textarea,label,summary") || e.target : e.target;
        record(type, { ...targetInfo(el), x: Math.round(e.clientX), y: Math.round(e.clientY) });
      },
      true,
    );
  }

  window.addEventListener(
    "input",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || isOwnNode(el)) return;
      const value = fieldValue(el);
      const selector = uniqueSelector(el);
      // Agrupamos el tipeo continuo en un solo evento por campo.
      const last = buffers.interaction[buffers.interaction.length - 1];
      if (lastInput && last === lastInput && lastInput.target === selector && Date.now() - lastInput.t < 4000) {
        lastInput.value = value;
        lastInput.t = Date.now();
        return;
      }
      lastInput = { t: Date.now(), type: "input", target: selector, value };
      push("interaction", lastInput);
    },
    true,
  );

  window.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || isOwnNode(el)) return;
      const data = { target: uniqueSelector(el) };
      if (el.type === "checkbox" || el.type === "radio") data.value = el.checked ? "checked" : "unchecked";
      else if (el.tagName === "SELECT") data.value = clip(el.selectedOptions?.[0]?.textContent?.trim() ?? el.value, 80);
      else if (el.type === "file") data.value = `${el.files?.length ?? 0} archivo(s)`;
      else {
        data.value = fieldValue(el);
        // Tras tipear, el change repite lo que ya registró el input.
        if (lastInput && lastInput.target === data.target && lastInput.value === data.value) return;
      }
      record("change", data);
    },
    true,
  );

  window.addEventListener("submit", (e) => record("submit", { target: uniqueSelector(e.target) }), true);

  window.addEventListener(
    "keydown",
    (e) => {
      if (picking) return;
      const editable = e.target instanceof Element && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      const special = /^(Enter|Escape|Tab|Backspace|Delete|Arrow\w+|F\d+|PageUp|PageDown|Home|End)$/.test(e.key);
      const combo = e.metaKey || e.ctrlKey || e.altKey;
      if (!combo && !special) return;
      if (editable && !combo && !/^(Enter|Escape|Tab)$/.test(e.key)) return;
      const keys = [e.metaKey && "Meta", e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.key].filter(Boolean);
      record("key", { key: keys.join("+"), target: e.target instanceof Element ? uniqueSelector(e.target) : undefined });
    },
    true,
  );

  let scrollTimer = null;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        record("scroll", { y: Math.round(scrollY), x: Math.round(scrollX) });
      }, 800);
    },
    { capture: true, passive: true },
  );

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => record("resize", { detail: `${innerWidth}x${innerHeight}` }), 500);
  });
  window.addEventListener("hashchange", () => record("hashchange", { detail: location.href }));
  window.addEventListener("popstate", () => record("popstate", { detail: location.href }));
  document.addEventListener("visibilitychange", () => record("visibility", { detail: document.visibilityState }));
  for (const type of ["copy", "paste", "cut"]) {
    window.addEventListener(type, (e) => record(type, { target: e.target instanceof Element ? uniqueSelector(e.target) : undefined }), true);
  }

  // ---------- contexto ----------
  const STYLE_PROPS = [
    "display", "position", "top", "left", "right", "bottom", "width", "height", "margin", "padding",
    "box-sizing", "flex-direction", "justify-content", "align-items", "gap", "grid-template-columns",
    "color", "background-color", "background-image", "border", "border-radius", "box-shadow",
    "font-family", "font-size", "font-weight", "line-height", "text-align", "white-space",
    "overflow", "z-index", "opacity", "visibility", "pointer-events", "cursor", "transform", "transition",
  ];

  const PROP_DEFAULTS = {
    opacity: /^1$/,
    cursor: /^(auto|default)$/,
    transition: /^(all|all 0s ease 0s|none 0s ease 0s)$/,
    "box-sizing": /^content-box$/,
    "font-weight": /^400$/,
  };
  const FLEX_PROPS = new Set(["flex-direction", "justify-content", "align-items", "gap"]);

  function computedStyleSubset(el) {
    const cs = getComputedStyle(el);
    const isFlexOrGrid = /flex|grid/.test(cs.display);
    const out = { display: cs.display };
    for (const prop of STYLE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (!v || /^(none|normal|auto|0px|static|visible|rgba\(0, 0, 0, 0\)|start)$/.test(v)) continue;
      if (PROP_DEFAULTS[prop]?.test(v)) continue;
      if ((FLEX_PROPS.has(prop) || prop === "grid-template-columns") && !isFlexOrGrid) continue;
      out[prop] = clip(v, 160);
    }
    return out;
  }

  function truncatedOuterHTML(el, max = 8000) {
    const clone = el.cloneNode(true);
    // Eliminamos ruido que no aporta y puede ser enorme.
    clone.querySelectorAll?.("script,style,noscript,template").forEach((n) => n.remove());
    clone.querySelectorAll?.("svg").forEach((svg) => {
      svg.innerHTML = "<!-- svg -->";
    });
    clone.querySelectorAll?.("input").forEach((input) => {
      if (isSensitiveField(input)) input.setAttribute("value", "[oculto]");
    });
    let html = clone.outerHTML || "";
    html = html.replace(/(src|href)="data:[^"]{120,}"/g, '$1="data:…"');
    return html.length > max ? `${html.slice(0, max)}\n<!-- … truncado (${html.length} caracteres) -->` : html;
  }

  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    const attributes = {};
    for (const attr of [...el.attributes].slice(0, 40)) attributes[attr.name] = clip(attr.value, 200);
    const ancestors = [];
    let node = el.parentElement;
    while (node && ancestors.length < 12) {
      ancestors.push(shortDescriptor(node));
      node = node.parentElement;
    }
    const state = {};
    if ("value" in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) state.value = fieldValue(el);
    if ("checked" in el && el.tagName === "INPUT") state.checked = el.checked;
    if ("disabled" in el) state.disabled = el.disabled;
    if (document.activeElement === el) state.focused = true;
    return {
      tag: el.tagName.toLowerCase(),
      selector: uniqueSelector(el),
      xpath: xpathFor(el),
      descriptor: shortDescriptor(el),
      role: accessibleRole(el),
      accessibleName: accessibleName(el),
      text: clip((el.innerText || el.textContent || "").trim().replace(/\n{3,}/g, "\n\n"), 1500),
      attributes,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        pageX: Math.round(rect.x + scrollX),
        pageY: Math.round(rect.y + scrollY),
      },
      styles: computedStyleSubset(el),
      state,
      ancestors,
      childCount: el.children.length,
      framework: frameworkInfo(el),
      outerHTML: truncatedOuterHTML(el),
    };
  }

  function pageContext() {
    const selection = String(window.getSelection?.() ?? "").trim();
    return {
      url: location.href,
      title: document.title,
      referrer: document.referrer || null,
      lang: document.documentElement.lang || null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY), height: document.documentElement.scrollHeight },
      userAgent: navigator.userAgent,
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      readyState: document.readyState,
      selectedText: selection ? clip(selection, 2000) : null,
      pageLoadedAt,
    };
  }

  function snapshot() {
    return {
      page: pageContext(),
      interactions: buffers.interaction.slice(),
      console: buffers.console.slice(),
      network: buffers.network.slice(),
      capturedAt: Date.now(),
    };
  }

  // ---------- overlay ----------

  function createOverlay() {
    const host = document.createElement(HOST_TAG);
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box { position: fixed; pointer-events: none; border: 2px solid #7c7cff; background: rgba(124,124,255,.14);
               border-radius: 3px; box-shadow: 0 0 0 1px rgba(0,0,0,.25); transition: all 60ms ease-out; display: none; }
        .tag { position: fixed; pointer-events: none; background: #18181b; color: #fafafa; font: 600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
               padding: 3px 7px; border-radius: 5px; max-width: 60vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
               box-shadow: 0 4px 14px rgba(0,0,0,.3); display: none; }
        .tag b { color: #a5a5ff; font-weight: 600; }
        .hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: none;
                background: #18181b; color: #e4e4e7; font: 500 12px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;
                padding: 8px 14px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.35); white-space: nowrap; }
        .hint kbd { font: inherit; background: #3f3f46; border-radius: 4px; padding: 0 5px; margin: 0 2px; }
        .shield { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; display: none; }
        .area { position: fixed; border: 2px dashed #7c7cff; background: rgba(124,124,255,.12); display: none; pointer-events: none; }
      </style>
      <div class="shield"></div>
      <div class="box"></div>
      <div class="area"></div>
      <div class="tag"></div>
      <div class="hint"></div>`;
    document.documentElement.appendChild(host);
    return {
      host,
      box: root.querySelector(".box"),
      tag: root.querySelector(".tag"),
      hint: root.querySelector(".hint"),
      shield: root.querySelector(".shield"),
      area: root.querySelector(".area"),
    };
  }

  function removeOverlay() {
    overlay?.host.remove();
    overlay = null;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));

  function placeBox(el) {
    const r = el.getBoundingClientRect();
    Object.assign(overlay.box.style, {
      display: "block",
      left: `${r.left - 2}px`,
      top: `${r.top - 2}px`,
      width: `${r.width + 4}px`,
      height: `${r.height + 4}px`,
    });
    const fw = frameworkInfo(el);
    const comp = fw?.react?.components?.[0] || fw?.vue?.components?.[0];
    overlay.tag.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = shortDescriptor(el);
    overlay.tag.append(b, ` ${Math.round(r.width)}×${Math.round(r.height)}${comp ? ` · <${comp}>` : ""}`);
    overlay.tag.style.display = "block";
    const tagTop = r.top > 28 ? r.top - 26 : r.bottom + 6;
    overlay.tag.style.top = `${Math.min(tagTop, innerHeight - 24)}px`;
    overlay.tag.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 300))}px`;
  }

  function pickElement() {
    return new Promise((resolve) => {
      if (picking) return resolve(null);
      picking = true;
      overlay = createOverlay();
      overlay.hint.innerHTML =
        "Click para seleccionar · <kbd>↑</kbd> padre · <kbd>↓</kbd> hijo · <kbd>Enter</kbd> confirmar · <kbd>Esc</kbd> cancelar";
      let current = null;
      const trail = [];
      let pointer = { x: -1, y: -1 };
      let keyboardAnchor = null; // tras ↑/↓, ignorar micro-movimientos del mouse

      const setCurrent = (el) => {
        if (!el || el === document.documentElement || isOwnNode(el)) return;
        current = el;
        placeBox(el);
      };

      const onMove = (e) => {
        pointer = { x: e.clientX, y: e.clientY };
        if (keyboardAnchor) {
          if (Math.hypot(e.clientX - keyboardAnchor.x, e.clientY - keyboardAnchor.y) < 8) return;
          keyboardAnchor = null;
        }
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== current && !isOwnNode(el)) {
          trail.length = 0;
          setCurrent(el);
        }
      };
      const block = (e) => {
        if (isOwnNode(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      const finish = (result) => {
        picking = false;
        window.removeEventListener("mousemove", onMove, true);
        for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"]) window.removeEventListener(t, block, true);
        window.removeEventListener("click", onClick, true);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScroll, true);
        removeOverlay();
        resolve(result);
      };
      const onClick = (e) => {
        block(e);
        const el = current || document.elementFromPoint(e.clientX, e.clientY);
        finish(el && !isOwnNode(el) ? el : null);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          block(e);
          finish(null);
        } else if (e.key === "Enter" && current) {
          block(e);
          finish(current);
        } else if (e.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.documentElement) {
          block(e);
          keyboardAnchor = { ...pointer };
          trail.push(current);
          setCurrent(current.parentElement);
        } else if (e.key === "ArrowDown" && current) {
          block(e);
          keyboardAnchor = { ...pointer };
          setCurrent(trail.pop() || current.firstElementChild || current);
        }
      };
      const onScroll = () => current && placeBox(current);

      window.addEventListener("mousemove", onMove, true);
      for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick"]) window.addEventListener(t, block, true);
      window.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScroll, true);
    });
  }

  function pickArea() {
    return new Promise((resolve) => {
      if (picking) return resolve(null);
      picking = true;
      overlay = createOverlay();
      overlay.hint.innerHTML = "Arrastrá para seleccionar un área · <kbd>Esc</kbd> cancelar";
      overlay.shield.style.display = "block";
      let start = null;
      let rect = null;

      const finish = (result) => {
        picking = false;
        window.removeEventListener("keydown", onKey, true);
        removeOverlay();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      };
      overlay.shield.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        overlay.shield.setPointerCapture(e.pointerId);
      });
      overlay.shield.addEventListener("pointermove", (e) => {
        if (!start) return;
        rect = {
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY),
          width: Math.abs(e.clientX - start.x),
          height: Math.abs(e.clientY - start.y),
        };
        Object.assign(overlay.area.style, {
          display: "block",
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      });
      overlay.shield.addEventListener("pointerup", () => {
        if (!rect || rect.width < 6 || rect.height < 6) {
          start = null;
          rect = null;
          overlay.area.style.display = "none";
          return;
        }
        finish(rect);
      });
      window.addEventListener("keydown", onKey, true);
    });
  }

  function elementsInRect(rect) {
    // Elemento más chico que contiene el centro del área: suele ser lo que se quiere señalar.
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let el = document.elementFromPoint(cx, cy);
    while (el && el.parentElement && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.left <= rect.x + 2 && r.top <= rect.y + 2 && r.right >= rect.x + rect.width - 2 && r.bottom >= rect.y + rect.height - 2) break;
      el = el.parentElement;
    }
    return el;
  }

  // ---------- flujo de captura ----------
  function contextMenuTarget(targetElementId) {
    let el = null;
    if (targetElementId != null) {
      try {
        el = browser.menus?.getTargetElement?.(targetElementId) || null;
      } catch {
        el = null;
      }
    }
    el ||= lastContextTarget;
    return el?.isConnected ? el : null;
  }

  async function runCapture({ mode, targetElementId, fromContextMenu }) {
    let element = null;
    let rect = null;

    if (mode === "element") {
      const direct = fromContextMenu ? contextMenuTarget(targetElementId) : null;
      element = direct || (await pickElement());
      if (!element) return { cancelled: true };
      if (direct) element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      await nextFrame();
      const r = element.getBoundingClientRect();
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    } else if (mode === "area") {
      rect = await pickArea();
      if (!rect) return { cancelled: true };
      element = elementsInRect(rect);
    }
    await nextFrame(); // que el overlay ya no aparezca en la captura

    const data = snapshot();
    data.mode = mode;
    data.rect = rect;
    if (element) data.element = describeElement(element);
    if (mode === "area" && data.element) data.element.note = "Elemento más chico que contiene el área seleccionada";
    return data;
  }

  // sendResponse + `return true`: funciona igual en Firefox y en Chrome
  // (Chrome no acepta que el listener devuelva una promesa).
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "t3capture:ping") {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "t3capture:run") {
      runCapture(message)
        .catch((error) => ({ error: String(error?.message || error) }))
        .then(sendResponse);
      return true;
    }
    return false;
  });
})();
