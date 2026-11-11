# Política de privacidad de T3 Capture

_Última actualización: 11 de noviembre de 2026_

T3 Capture es una extensión de código abierto (MIT) para Zen, Firefox y Chrome
que crea hilos de [T3 Code](https://t3.codes) con contexto de la página que
estás viendo. Esta política describe qué datos usa y adónde van.

## Resumen

- La extensión **no tiene servidores propios** y el autor **no recibe ningún
  dato**. No hay analíticas, telemetría ni publicidad.
- Los datos de una captura solo salen del navegador cuando vos tocás **Crear
  hilo**, y van únicamente al servidor de T3 Code que emparejaste (tu
  computadora u otro dispositivo tuyo).

## Qué datos se usan

Mientras navegás, la extensión guarda en memoria, dentro de cada pestaña, un
registro de lo que pasa en la página. Ese registro no se envía a ningún lado:

- mensajes y errores de la consola;
- URL, método, código de estado y duración de los requests de red (no los
  cuerpos ni los headers);
- interacciones recientes: clicks, teclas especiales, navegación y valores de
  campos de texto. Las contraseñas y los números de tarjeta siempre se
  reemplazan por `[oculto]`. Podés desactivar el registro de valores en los
  ajustes.

Cuando iniciás una captura (botón, atajo o menú contextual), la extensión
además toma:

- una captura de pantalla de la parte visible de la pestaña;
- el elemento o el área que elegiste: selector, HTML, estilos, texto,
  componentes de React o Vue;
- la URL y el título de la página.

Todo eso se muestra en el compositor antes de enviar. Ahí podés editar el
mensaje, desmarcar capturas y quitar secciones (DOM, interacciones, consola,
red).

## Adónde van los datos

Al tocar **Crear hilo**, el mensaje y las capturas se envían al servidor de
T3 Code que elegiste, con el token que obtuviste al emparejar la extensión.
T3 Code crea el hilo y se lo pasa al agente y modelo que elegiste (por
ejemplo Claude o Codex). A partir de ahí rigen las políticas de T3 Code y del
proveedor del modelo.

## Qué se guarda en el navegador

En el almacenamiento local de la extensión (`storage.local` e IndexedDB):

- los dispositivos emparejados y sus tokens de acceso;
- tus preferencias (último proyecto, modelo y opciones);
- las instrucciones del sistema default y por proyecto;
- las capturas pendientes. Se borran al crear el hilo, y las que quedan sin
  usar se borran al iniciar el navegador si tienen más de 24 horas.

Esos datos no se sincronizan ni se comparten. Se borran al desinstalar la
extensión. Podés quitar un dispositivo (y su token) desde los ajustes.

## Permisos

- **Acceso a todos los sitios** y **scripts de contenido**: para registrar
  consola, red e interacciones desde que carga la página y para poder
  seleccionar elementos en cualquier sitio.
- **Pestañas** y **captura de la pestaña activa**: para la captura de
  pantalla y la URL y el título de la página.
- **Menús contextuales**: para el click derecho «Crear hilo de T3…».
- **Almacenamiento**: para lo descrito en la sección anterior.
- **Notificaciones**: para avisar si una captura falla.
- **Identidad**: para el flujo de aprobación de T3 (OAuth) al emparejar.
- **webRequest** (Firefox) y **declarativeNetRequest** (Chrome): para quitar
  el header `Origin` de los requests de la extensión a `/mcp` en tu servidor
  de T3, que si no los rechaza. No lee ni modifica ningún otro request.

## Contacto

Preguntas o reportes: <https://github.com/jsred/t3-capture/issues>.
