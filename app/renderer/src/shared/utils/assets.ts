/**
 * Ruta del logo. Se calcula contra la página actual (document.baseURI) y no como "/isotipo.png":
 * en la app instalada la interfaz se abre como archivo local (file://) y una ruta que empieza con
 * "/" apunta a la raíz del disco, así que la imagen salía rota. En desarrollo (http://localhost) funciona igual.
 */
export const LOGO_URL = new URL('isotipo.png', document.baseURI).href;
