# T3 Capture

[![CI](https://github.com/jsred/t3-capture/actions/workflows/ci.yml/badge.svg)](https://github.com/jsred/t3-capture/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

> Proyecto comunitario, no oficial. No está afiliado a T3 Code.

Extensión para **Zen y Firefox** (142 o posterior) y **Chrome** (120 o posterior, también Brave, Arc, Edge y otros basados en Chromium): seleccionás un elemento, un área o la parte visible de una página, le agregás contexto escrito y se crea un hilo en **T3 Code** con:

- **Capturas de pantalla:** el elemento recortado, más la página con el elemento marcado.
- **Contexto del DOM:** selector único, XPath, rol y nombre accesible, HTML, estilos computados, ancestros, estado del campo y componentes **React/Vue** con el archivo fuente cuando la app corre en modo dev.
- **Eventos recientes:** clicks, inputs, teclas, scroll, navegación SPA, consola (logs, warnings, errores no capturados) y requests fetch/XHR con estado y duración.

Antes de crear el hilo elegís el **dispositivo** (la máquina con T3), el **proyecto** (o Scratch), si va en la carpeta del proyecto o en un **worktree** nuevo, el **modelo** con su **reasoning effort** (y otras opciones como fast mode o service tier), los **permisos** y si arranca en **modo plan**. Recuerda tus últimas elecciones. También podés sumar **instrucciones del sistema** default o por proyecto.

## Cómo habla con T3

T3 Code expone un servidor MCP estándar en `http://<host>:3773/mcp` con OAuth (PKCE y registro dinámico de clientes). La extensión usa las mismas herramientas que los agentes de T3:

| Para qué | Herramienta MCP |
|---|---|
| Nombre de la máquina | `t3_environment_read` |
| Otras máquinas vinculadas (si “Linked environments” está activo en T3) | `t3_environment_links` |
| Proyectos | `t3_project_list` |
| Proveedores, modelos y opciones (effort…) | `orchestrator_capabilities` |
| Subir capturas | `t3_attachment_prepare_upload` y un POST a `/api/attachments/upload/…` |
| Crear el hilo | `t3_thread_launch` |

Cada token dura 30 días. Las sesiones aparecen en T3 → Settings → Connections, y desde ahí se pueden revocar.

## Instalar

Requisito: tener [T3 Code](https://t3.codes) instalado y abierto en la máquina donde van a correr los hilos.

### Zen / Firefox

1. Descargá `t3-capture-firefox-<versión>.xpi` de la [última release](https://github.com/jsred/t3-capture/releases/latest).
2. Zen no exige firma de extensiones: en `about:config`, poné `xpinstall.signatures.required` en `false`.
3. En `about:addons` → ⚙︎ → *Instalar complemento desde archivo…*, elegí el `.xpi`.
4. Si en `about:addons` → T3 Capture → Permisos aparece desactivado *Acceder a tus datos de todos los sitios web*, activalo. La página de ajustes de la extensión también lo avisa.

En Firefox común (no Zen) los `.xpi` sin firmar no se instalan de forma permanente. Usá la carga temporal de la sección *Desarrollo*.

### Chrome, Brave, Arc, Edge…

1. Descargá `t3-capture-chrome-<versión>.zip` de la [última release](https://github.com/jsred/t3-capture/releases/latest) y descomprimilo en una carpeta que no vayas a borrar.
2. Abrí `chrome://extensions` (en Brave `brave://extensions`, en Edge `edge://extensions`) y activá el **Modo de desarrollador**.
3. Apretá **Cargar descomprimida** y elegí la carpeta.

Chrome muestra un aviso sobre extensiones en modo desarrollador al iniciar. Si movés o borrás la carpeta, la extensión deja de funcionar y hay que volver a emparejar T3. Para actualizar, reemplazá el contenido de la carpeta y apretá ↻ en la tarjeta de la extensión.

### Desarrollo

```sh
git clone https://github.com/jsred/t3-capture.git
cd t3-capture
npm install
npm run build        # dist/t3-capture-firefox-<versión>.xpi, dist/chrome/ y dist/t3-capture-chrome-<versión>.zip
```

`extension/` es la fuente común y su `manifest.json` es el de Firefox. `npm run build:chrome` genera el manifest de Chrome en `dist/chrome/`: service worker en lugar de página de eventos, `contextMenus`, `declarativeNetRequest` y PNG en vez de SVG.

- **Zen/Firefox, carga temporal:** `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal…* → `extension/manifest.json`. Se descarga al cerrar el navegador.
- **Zen/Firefox, recarga automática:** `npm run run:zen` abre Zen con un perfil temporal y recarga la extensión al guardar cambios. Ajustá la ruta del script si Zen no está en `/Applications`.
- **Chrome:** `npm run build:chrome`, después *Cargar descomprimida* → `dist/chrome`. Tras cada cambio, volvé a correr el build y apretá ↻ en `chrome://extensions`.

## Conectar T3

1. En la máquina con T3, corré `t3 pair`.
2. En los ajustes de la extensión, pegá el link (`http://…/pair#token=…`) o solo el código y apretá **Conectar con código**.

También podés usar **Aprobar en T3 (ventana)**: abre la pantalla de aprobación OAuth del propio T3.

Para otras máquinas (un VPS por Tailscale, otra Mac), emparejá cada una por separado. Si tenés activados los entornos vinculados en T3, esas máquinas también aparecen como dispositivos a través de la principal.

## Instrucciones del sistema

Podés definir instrucciones que se agregan a cada hilo nuevo, por ejemplo “Respondé en español” o “Usá pnpm y corré los tests antes de terminar”:

- **Default:** se usa en Scratch y en los proyectos sin instrucción propia.
- **Por proyecto:** reemplaza a la default en ese proyecto.

Se configuran en los ajustes de la extensión, o desde el compositor (*Destino → Instrucciones del sistema*) con *Guardar para «proyecto»* o *Guardar como default*. Si las editás en el compositor sin guardar, el cambio vale solo para ese hilo.

`t3_thread_launch` no tiene un campo de system prompt. Por eso van al principio del primer mensaje, dentro de `<instrucciones_del_sistema>…</instrucciones_del_sistema>`, y se ven en *Ver el mensaje que se va a enviar*.

## Uso

| Acción | Cómo |
|---|---|
| Seleccionar un elemento | Popup, <kbd>Alt+Shift+E</kbd>, o click derecho → *Crear hilo de T3 con este elemento* |
| Seleccionar un área | Popup, <kbd>Alt+Shift+A</kbd> o menú contextual |
| Captura visible | Popup, <kbd>Alt+Shift+S</kbd> o menú contextual |
| En el selector | <kbd>↑</kbd> padre · <kbd>↓</kbd> hijo · <kbd>Enter</kbd> confirmar · <kbd>Esc</kbd> cancelar |
| Crear el hilo | <kbd>⌘ Enter</kbd> en el compositor |

Los atajos se cambian desde *Cambiar atajos* en los ajustes de la extensión (en Zen/Firefox abre `about:addons`; en Chrome, `chrome://extensions/shortcuts`).

## Privacidad

- Todo queda entre el navegador y tu T3; no hay servicios externos.
- Los campos de contraseña, tarjeta, tokens y similares siempre se registran como `[oculto]`. Podés desactivar el registro de valores de inputs en los ajustes.
- Los eventos viven solo en la memoria de cada pestaña (máximo 200 interacciones, 150 líneas de consola y 150 requests) y se pierden al recargar. Las capturas se guardan en IndexedDB hasta crear el hilo (o 24 horas como máximo).
- Antes de enviar podés ver el mensaje exacto (*Ver el mensaje que se va a enviar*) y apagar cada sección.

## Limitaciones

- Solo el frame principal: no se pueden elegir elementos dentro de iframes.
- La captura cubre lo visible del viewport, no la página entera.
- Para registrar consola y red, la extensión envuelve `console.*`, `fetch` y `XMLHttpRequest`. En DevTools, los `console.log` van a aparecer originados en `recorder-main.js`.
- En pestañas abiertas antes de instalar la extensión, los eventos se registran desde la primera captura.
- El MCP de T3 rechaza requests con un header `Origin` ajeno. Por eso la extensión lo quita solo en sus propios requests a `/mcp`: en Firefox con `webRequest` y en Chrome con una regla de `declarativeNetRequest`.
- En Chrome, el menú contextual *Crear hilo de T3 con este elemento* usa el último elemento sobre el que hiciste click derecho. Firefox lo resuelve con `menus.getTargetElement`.

## Estructura

```
extension/                 fuente común (manifest de Firefox)
  manifest.json
  background.js            menús, atajos, captura de pantalla y recorte, filtro del Origin
  content/recorder-main.js mundo de la página: consola, errores, fetch/XHR, pushState, componentes React/Vue
  content/content.js       eventos de interacción, selector de elemento/área, contexto del DOM
  composer/                ventana para escribir el contexto y elegir destino y modelo
  options/                 emparejar dispositivos y ajustes
  popup/                   botones de captura
  lib/browser-shim.js      alias browser → chrome
  lib/t3client.js          OAuth + cliente MCP de T3
  lib/format.js            armado del mensaje
scripts/
  build-chrome.mjs         genera dist/chrome y su manifest
  render-icons.mjs         PNG de los íconos a partir del SVG
test/
  format.test.js           npm test
  content-dom.mjs          npm run test:dom      (Chromium headless)
  chrome-e2e.mjs           npm run test:chrome   (extensión cargada en Chromium, T3 simulado)
  firefox-e2e.mjs          npm run test:firefox  (.xpi en Zen/Firefox headless, T3 simulado)
  live-t3.mjs              npm run test:live -- <código de t3 pair>
  composer-ui.mjs          compositor real contra T3, con el launch interceptado
```

## Contribuir

Issues y PRs bienvenidos.

- `npm run lint` valida la extensión con `web-ext`.
- `npm test` corre los tests unitarios del armado del mensaje.
- `npm run test:dom` ejercita los content scripts en Chromium headless (`npx playwright install chromium` la primera vez).
- `npm run test:chrome` carga `dist/chrome` en Chromium y recorre el flujo entero contra un T3 simulado: selector, capturas, compositor y creación del hilo. Con `-- --live <código de t3 pair>` también empareja con tu T3 real (no crea hilos).
- `npm run test:firefox` hace lo mismo con el `.xpi` en Zen o Firefox headless, con un perfil temporal. Necesita [geckodriver](https://github.com/mozilla/geckodriver/releases) (`GECKODRIVER`) y el navegador (`FIREFOX_BIN`, por defecto Zen en `/Applications`).
- `npm run test:live -- <código de t3 pair>` prueba el cliente contra un T3 real. Crea una sesión en T3 que después podés revocar en Settings → Connections.

Para publicar una versión: subí `version` en `extension/manifest.json` y en `package.json`, y creá el tag `vX.Y.Z`. El workflow *Release* adjunta el `.xpi` y el `.zip` de Chrome a la release.

## Licencia

[MIT](LICENSE)
