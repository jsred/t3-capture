# Cambios

## [0.3.0] - 2026-11-25

### Agregado

- Creá una tarjeta en una lista de Trello o una página en una base de datos de Notion desde el compositor. Podés incluir la descripción, las imágenes y el contexto que elijas.
- Conectá cada servicio desde Ajustes y abrí el ticket desde el compositor después de crearlo.
- Retomá los adjuntos pendientes de Trello sobre la misma tarjeta al reabrir el compositor. Si la descripción supera el límite de Trello, el texto completo va en un adjunto.
- Recuperá el enlace de una página que Notion guardó aun cuando el servidor devolvió un error al responder.

### Corregido

- Un límite de captura en cero omite la sección correspondiente de interacciones, consola o red.

En Firefox, la actualización declara el uso de credenciales para conectar los servicios.

## [0.2.2] - 2026-11-16

### Agregado

- Enviá capturas y contexto de la página a un hilo existente desde el compositor.
- Buscá hilos por título y proyecto, cargá más resultados o incluí todos los proyectos y Scratch.
- Conservá el modelo, los permisos y el workspace del hilo elegido. Este envío requiere conexión directa a su dispositivo.

### Corregido

- Un error al guardar preferencias después de un envío exitoso ya no permite reenviar la misma captura por accidente.
- Cambiar entre hilo nuevo y existente conserva los errores de conexión y mantiene deshabilitados los destinos sin cargar.

[0.3.0]: https://github.com/jsred/t3-capture/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/jsred/t3-capture/compare/v0.2.1...v0.2.2
