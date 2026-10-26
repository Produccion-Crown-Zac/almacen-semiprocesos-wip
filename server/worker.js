// server/worker.js
// Punto de entrada del Cloudflare Worker: /api/* lo atiende la API; todo lo demás es la página (carpeta dist).
import { onRequest } from "./api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const ruta = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
      return onRequest({ request, env, params: { ruta }, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  },
};
