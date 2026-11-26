# Política de privacidad de T3 Capture

_Última actualización: 25 de noviembre de 2026_

T3 Capture es una extensión de código abierto (MIT) para Zen, Firefox y Chrome
que envía capturas y contexto de la página a hilos de T3 Code o a tickets de Trello y Notion. Esta política describe qué datos usa y adónde van.

## Resumen

- La extensión **no tiene servidores propios** y el autor **no recibe ningún
  dato**. No hay analíticas, telemetría ni publicidad.
- Los datos de una captura solo salen del navegador cuando tocás **Crear hilo**, **Enviar al hilo**, **Crear ticket** o reintentás un adjunto. Se envían al servicio que elegiste.

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

Al tocar **Crear hilo** o **Enviar al hilo**, el mensaje y las capturas se envían al servidor de
T3 Code que elegiste, con el token que obtuviste al emparejar la extensión.
T3 Code crea el hilo o agrega el mensaje al hilo existente que elegiste y
se lo pasa a su agente y modelo (por ejemplo Claude o Codex). La lista de
hilos se consulta únicamente al elegir un hilo existente y se muestra en
el compositor; no se guarda en el almacenamiento local. A partir de ahí rigen las políticas de T3 Code y del
proveedor del modelo.

Al tocar **Crear ticket**, el título, la descripción, el contexto y las imágenes seleccionadas se envían directamente a la API de Trello o Notion. Trello guarda una tarjeta en la lista que elegiste. Notion guarda una página en la base de datos que elegiste. Al configurar las integraciones y elegir el destino, la extensión usa tus credenciales para comprobar la conexión y consultar tableros, listas o bases de datos. Los tickets quedan sujetos a los permisos del destino que elegiste y a las políticas de cada servicio. [Privacidad de Atlassian](https://www.atlassian.com/legal/privacy-policy) · [Privacidad de Notion](https://www.notion.com/privacy)

## Qué se guarda en el navegador

En el almacenamiento local de la extensión (`storage.local` e IndexedDB):

- los dispositivos emparejados y sus tokens de acceso;
- la clave de API y el token de Trello y el token de Notion, si conectaste esos servicios;
- tus preferencias (último proyecto, modelo y opciones);
- las instrucciones del sistema default y por proyecto;
- las capturas pendientes. Se borran al confirmar el envío. Si una tarjeta de Trello tiene adjuntos pendientes, se guardan la captura y la referencia a la tarjeta para poder reintentar. Al iniciar el navegador, se borran las capturas pendientes de más de 24 horas.

Esos datos no se sincronizan ni se comparten. Se borran al desinstalar la
extensión. Podés quitar un dispositivo o desconectar Trello o Notion desde los ajustes para borrar sus credenciales locales. Podés revocar los tokens desde el servicio que los emitió.

## Permisos

- **Acceso a todos los sitios** y **scripts de contenido**: para registrar
  consola, red e interacciones desde que carga la página y para poder
  seleccionar elementos en cualquier sitio.
- **Pestañas** y **captura de la pestaña activa**: para la captura de
  pantalla y la URL y el título de la página.
- **Menús contextuales**: para iniciar capturas con el click derecho.
- **Almacenamiento**: para lo descrito en la sección anterior.
- **Notificaciones**: para avisar si una captura falla.
- **Identidad**: para el flujo de aprobación de T3 (OAuth) al emparejar.
- **webRequest** (Firefox) y **declarativeNetRequest** (Chrome): para quitar
  el header `Origin` de los requests de la extensión a `/mcp` en tu servidor
  de T3, que si no los rechaza. No lee ni modifica ningún otro request.

## Contacto

Preguntas o reportes: <https://github.com/jsred/t3-capture/issues>.
