# Ficha de la Chrome Web Store

Textos para pegar en el panel de desarrollador
(<https://chrome.google.com/webstore/devconsole>). Las imágenes están en
`store/images/` y se regeneran con `npm run store:assets`.

## Paquete

`dist/t3-capture-chrome-<versión>.zip` (`npm run build:chrome`).

## Ficha de Play Store → Detalles del producto

**Idioma:** español (Latinoamérica)

**Título:** T3 Capture (sale del manifest)

**Resumen** (sale del manifest, máx. 132 caracteres):

> Enviá capturas y contexto del navegador a T3 Code, o creá tickets en Trello y Notion.

**Descripción:**

```
T3 Capture te permite reportar un bug del navegador en un hilo de T3 Code, una tarjeta de Trello o una base de datos de Notion.

• Elegí un elemento (click derecho, atajo o botón de la barra), seleccioná un área o capturá la parte visible de la página.
• El hilo recibe las capturas, el selector, el HTML, los componentes de React o Vue con su archivo, y los últimos errores de consola, requests, navegación e interacciones. Las contraseñas y tarjetas siempre se ocultan.
• Antes de crear el hilo elegís dispositivo, proyecto, workspace, modelo, reasoning effort y permisos.
• Continuá un hilo existente: elegí dispositivo y proyecto, buscá por título y enviá la captura con su contexto. Conserva el modelo, los permisos y el workspace del hilo. Requiere conexión directa a su dispositivo.
• Instrucciones del sistema opcionales, una default y una por proyecto, que van al principio de cada hilo nuevo.
• Creá un ticket en una lista de Trello o una base de datos de Notion con las imágenes y el contexto que elijas. Conectá el servicio desde Ajustes.

Para enviar a un hilo, mantené abierto T3 Code en tu computadora u otro dispositivo tuyo y emparejalo desde Ajustes con `t3 pair`.

La extensión no tiene servidores propios y no le manda nada al autor. Las capturas se envían directamente al destino elegido cuando confirmás el envío.

Código abierto (MIT): https://github.com/jsred/t3-capture
```

**Categoría:** Herramientas para desarrolladores

**Recursos gráficos:**

- Ícono de la tienda 128×128: `extension/icons/icon-128.png`
- Capturas 1280×800: `store/images/1-seleccionar.jpg` … `4-instrucciones.jpg`
- Mosaico promocional pequeño 440×280: `store/images/promo-440x280.jpg`

**URL del sitio:** https://github.com/jsred/t3-capture
**URL de asistencia:** https://github.com/jsred/t3-capture/issues

## Prácticas de privacidad

**Propósito único:**

```
Enviar capturas y contexto técnico de la página que el usuario está viendo (DOM, consola, red e interacciones) al destino que elija para reportar un problema o solicitar un cambio. El destino puede ser un hilo de T3 Code, una tarjeta en una lista de Trello o una página en una base de datos de Notion.
```

**Justificación de permisos:**

| Permiso | Justificación |
| --- | --- |
| `activeTab` | Capturar la pestaña activa cuando el usuario inicia una captura desde el botón, un atajo o el menú contextual. |
| `scripting` | Inyectar el selector de elementos en pestañas que ya estaban abiertas antes de instalar la extensión. |
| `storage` | Guardar las conexiones de T3, Trello y Notion, las preferencias y las instrucciones del sistema. |
| `tabs` | Leer la URL y el título de la pestaña capturada y usar `captureVisibleTab` para la captura de pantalla. |
| `contextMenus` | Iniciar una captura de elemento, área o página visible con el click derecho. |
| `identity` | Flujo de aprobación OAuth de T3 Code al emparejar la extensión (`launchWebAuthFlow`). |
| `notifications` | Avisar al usuario si una captura falla. |
| `declarativeNetRequestWithHostAccess` | Una sola regla, limitada a requests iniciados por la propia extensión hacia `/mcp` del servidor de T3 del usuario, que quita el header `Origin`. T3 rechaza con 403 los requests con un Origin de extensión. No lee ni modifica otros requests. |
| Permiso de host `<all_urls>` | Los scripts de contenido registran consola, errores, red e interacciones desde que carga cada página. También permite conectarse al servidor de T3 del usuario y a las APIs de Trello y Notion. |
| Código remoto | No. Todo el código está en el paquete. |

**Uso de datos** (marcar):

- [x] Contenido del sitio web (capturas, HTML, texto de la página)
- [x] Actividad web (interacciones, requests de red, navegación)
- [x] Información de autenticación (credenciales de conexión para el servicio que el usuario elige)
- [x] Información de identificación personal: solo si el usuario escribe datos
  personales en un campo y está activado el registro de valores (se puede
  desactivar en los ajustes). Las contraseñas y tarjetas siempre se ocultan.

Certificaciones (marcar las tres):

- No vendo ni transfiero datos de usuarios a terceros, fuera de los casos de uso aprobados.
- No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único.
- No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni para préstamos.

**Política de privacidad:** https://github.com/jsred/t3-capture/blob/main/PRIVACY.md
