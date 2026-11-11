// Firefox expone `browser.*` con promesas. Chrome (MV3) expone `chrome.*`,
// que también devuelve promesas cuando no se pasa callback: con un alias
// alcanza para que el mismo código corra en los dos.
if (typeof globalThis.browser === "undefined" && typeof globalThis.chrome !== "undefined") {
  globalThis.browser = globalThis.chrome;
}
