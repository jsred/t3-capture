// Corre en el mundo de la página (world: MAIN) desde document_start.
// Registra consola, errores, red y navegación SPA, y se los pasa al content
// script aislado con un CustomEvent (detail como string JSON, que cruza bien
// la frontera de Xray en Firefox).
(() => {
  if (window.__t3CaptureRecorder) return;
  Object.defineProperty(window, "__t3CaptureRecorder", { value: true });

  const EVENT_NAME = "t3capture:main-entry";
  const MAX_ARG = 400;
  const MAX_URL = 400;

  const emit = (entry) => {
    try {
      document.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: JSON.stringify({ t: Date.now(), ...entry }) }),
      );
    } catch {
      /* nunca romper la página */
    }
  };

  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

  const serialize = (value) => {
    try {
      if (value instanceof Error) {
        const stack = (value.stack || "").split("\n").slice(0, 6).join("\n");
        return clip(`${value.name}: ${value.message}${stack ? `\n${stack}` : ""}`, 1200);
      }
      if (typeof value === "string") return clip(value, MAX_ARG);
      if (value === undefined) return "undefined";
      if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
      if (value instanceof Element) {
        const id = value.id ? `#${value.id}` : "";
        const cls = value.classList?.length ? `.${[...value.classList].slice(0, 3).join(".")}` : "";
        return `<${value.tagName.toLowerCase()}${id}${cls}>`;
      }
      const seen = new WeakSet();
      return clip(
        JSON.stringify(value, (_k, v) => {
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[circular]";
            seen.add(v);
          }
          if (typeof v === "bigint") return `${v}n`;
          return v;
        }) ?? String(value),
        MAX_ARG,
      );
    } catch {
      try {
        return clip(String(value), MAX_ARG);
      } catch {
        return "[unserializable]";
      }
    }
  };

  // ---- consola ----
  for (const level of ["error", "warn", "info", "log", "debug"]) {
    const original = console[level];
    if (typeof original !== "function") continue;
    console[level] = function (...args) {
      emit({ kind: "console", level, message: args.map(serialize).join(" ") });
      return original.apply(this, args);
    };
  }

  // ---- errores no capturados ----
  window.addEventListener(
    "error",
    (event) => {
      if (event.target && event.target !== window && event.target.tagName) {
        // Error cargando un recurso (<img>, <script>, <link>…)
        const el = event.target;
        emit({
          kind: "console",
          level: "error",
          message: `Error cargando recurso <${el.tagName.toLowerCase()}> ${clip(el.src || el.href || "", MAX_URL)}`,
        });
        return;
      }
      emit({
        kind: "console",
        level: "error",
        uncaught: true,
        message: event.error ? serialize(event.error) : clip(String(event.message), MAX_ARG),
        source: event.filename ? `${clip(event.filename, MAX_URL)}:${event.lineno}:${event.colno}` : undefined,
      });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    emit({ kind: "console", level: "error", uncaught: true, message: `Unhandled rejection: ${serialize(event.reason)}` });
  });

  // ---- red ----
  const absolute = (url) => {
    try {
      return clip(new URL(url, location.href).href, MAX_URL);
    } catch {
      return clip(String(url), MAX_URL);
    }
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      const started = performance.now();
      let method = "GET";
      let url = "";
      try {
        method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        url = absolute(input instanceof Request ? input.url : String(input));
      } catch {
        /* ignorar */
      }
      return originalFetch.apply(this, arguments).then(
        (response) => {
          emit({
            kind: "network",
            api: "fetch",
            method,
            url,
            status: response.status,
            ok: response.ok,
            ms: Math.round(performance.now() - started),
          });
          return response;
        },
        (error) => {
          emit({
            kind: "network",
            api: "fetch",
            method,
            url,
            status: 0,
            ok: false,
            error: serialize(error),
            ms: Math.round(performance.now() - started),
          });
          throw error;
        },
      );
    };
  }

  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  XHR.open = function (method, url) {
    try {
      this.__t3cap = { method: String(method).toUpperCase(), url: absolute(url) };
    } catch {
      /* ignorar */
    }
    return originalOpen.apply(this, arguments);
  };
  XHR.send = function () {
    const info = this.__t3cap;
    if (info) {
      const started = performance.now();
      this.addEventListener("loadend", () => {
        emit({
          kind: "network",
          api: "xhr",
          method: info.method,
          url: info.url,
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          ms: Math.round(performance.now() - started),
        });
      });
    }
    return originalSend.apply(this, arguments);
  };

  // ---- navegación SPA ----
  for (const fn of ["pushState", "replaceState"]) {
    const original = history[fn];
    history[fn] = function (_state, _title, url) {
      const result = original.apply(this, arguments);
      emit({ kind: "interaction", type: fn === "pushState" ? "navigate" : "replace-url", detail: absolute(url ?? location.href) });
      return result;
    };
  }
})();
