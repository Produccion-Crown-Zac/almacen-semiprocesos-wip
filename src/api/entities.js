// src/api/entities.js
// Capa de datos de la app. Toda la app habla SOLO con este archivo.
// Los datos viven en Cloudflare D1 y se leen/escriben por la API /api (functions/api).
//
// Entidades:
//   Auth       → inicio de sesión, sesión actual, cambio de contraseña
//   Usuarios   → alta y edición de usuarios (solo administrador)
//   Ajustes    → meta de exactitud
//   Sap        → último reporte de SAP (un renglón por material|lote)
//   Conteo     → cada inventario físico (uno "EN_CURSO" a la vez; los anteriores "CERRADO")
//   Registro   → cada bulto contado en un conteo, con su ubicación
//   Movimiento → bitácora

export class ErrorSesion extends Error {}

const oyentesSesion = new Set();
export const alPerderSesion = (cb) => {
  oyentesSesion.add(cb);
  return () => oyentesSesion.delete(cb);
};

async function api(ruta, { metodo = "GET", datos } = {}) {
  let resp;
  try {
    resp = await fetch(`/api/${ruta}`, {
      method: metodo,
      credentials: "same-origin",
      headers: datos === undefined ? {} : { "content-type": "application/json" },
      body: datos === undefined ? undefined : JSON.stringify(datos),
    });
  } catch {
    throw new Error("Sin conexión con el servidor. Revisa la señal e intenta de nuevo.");
  }
  let cuerpo = null;
  try {
    cuerpo = await resp.json();
  } catch {
    /* respuesta vacía */
  }
  if (resp.status === 401 && !["login", "setup", "estado"].includes(ruta)) {
    oyentesSesion.forEach((cb) => cb());
    throw new ErrorSesion(cuerpo?.error ?? "Tu sesión terminó.");
  }
  if (!resp.ok) throw new Error(cuerpo?.error ?? `Error ${resp.status}`);
  return cuerpo;
}

// ---------------------------------------------------------------- sesión
export const Auth = {
  estado: () => api("estado"),
  setup: (datos) => api("setup", { metodo: "POST", datos }).then((r) => r.usuario),
  login: (usuario, password) => api("login", { metodo: "POST", datos: { usuario, password } }).then((r) => r.usuario),
  logout: () => api("logout", { metodo: "POST", datos: {} }),
  yo: async () => {
    try {
      return (await api("yo")).usuario;
    } catch (e) {
      if (e instanceof ErrorSesion) return null;
      throw e;
    }
  },
  cambiarPassword: (actual, nueva) => api("yo/password", { metodo: "POST", datos: { actual, nueva } }),
};

export const Usuarios = {
  list: () => api("usuarios"),
  crear: (datos) => api("usuarios", { metodo: "POST", datos }),
  actualizar: (id, cambios) => api(`usuarios/${encodeURIComponent(id)}`, { metodo: "PATCH", datos: cambios }),
};

export const Ajustes = {
  leer: () => api("ajustes"),
  guardar: (cambios) => api("ajustes", { metodo: "PUT", datos: cambios }),
};

// ---------------------------------------------------------------- inventario
// Lotes y piezas de SAP por proceso (se usa para el conteo en curso)
export const totalesSap = (sap) => {
  const vacio = () => ({ lotes: 0, piezas: 0 });
  const t = { VIRGEN: vacio(), RECUBIERTA: vacio(), IMPRESA: vacio(), OTRO: vacio(), total: vacio() };
  for (const s of sap) {
    if (!s.en_sap) continue;
    const e = t[s.etapa in t ? s.etapa : "OTRO"];
    e.lotes++;
    e.piezas += Number(s.cantidad_sap ?? 0);
    t.total.lotes++;
    t.total.piezas += Number(s.cantidad_sap ?? 0);
  }
  return t;
};

const CAMPOS_SAP = ["clave", "lote", "material", "texto_breve", "centro", "almacen", "unidad", "cantidad_sap", "en_calidad", "etapa", "calibre"];

export const Sap = {
  list: () => api("sap"),
  sincronizar: (filas, { marcarFaltantes = true } = {}) =>
    api("sap/sincronizar", {
      metodo: "POST",
      datos: { filas: filas.map((f) => Object.fromEntries(CAMPOS_SAP.map((c) => [c, f[c] ?? null]))), marcarFaltantes },
    }),
  quitarFueraDeSap: () => api("sap/quitar-fuera", { metodo: "POST", datos: {} }),
};

export const Conteo = {
  list: () => api("conteos"),
  actual: () => api("conteos/actual", { metodo: "POST", datos: {} }),
  nuevo: () => api("conteos/nuevo", { metodo: "POST", datos: {} }),
};

export const Registro = {
  list: (conteoId) => api(`registros?conteo=${encodeURIComponent(conteoId)}`),
  todos: () => api("registros"),
  cerrados: () => api("registros?cerrados=1"),
  guardar: (datos) => api("registros", { metodo: "POST", datos }),
  actualizar: (id, cambios) => api(`registros/${encodeURIComponent(id)}`, { metodo: "PATCH", datos: cambios }),
  eliminar: (id) => api(`registros/${encodeURIComponent(id)}`, { metodo: "DELETE" }),
};

export const Movimiento = {
  list: (conteoId) => api(conteoId ? `movimientos?conteo=${encodeURIComponent(conteoId)}` : "movimientos"),
  create: (m) => api("movimientos", { metodo: "POST", datos: m }),
};

// ---------------------------------------------------------------- cambios de otros dispositivos
// Pregunta cada pocos segundos si la versión de los datos cambió (1 lectura muy ligera).
// cb recibe { sap: true } cuando además cambió el reporte de SAP o los ajustes.
export const suscribir = (cb, { cadaMs = 5000 } = {}) => {
  let ultima = null;
  let ultimaSap = null;
  let activo = true;
  const revisar = async () => {
    if (!activo || document.visibilityState === "hidden") return;
    try {
      const { version, version_sap } = await api("version");
      if (ultima !== null && version !== ultima) cb({ sap: version_sap !== ultimaSap });
      ultima = version;
      ultimaSap = version_sap;
    } catch {
      /* sin conexión o sin sesión: se reintenta en el siguiente ciclo */
    }
  };
  revisar();
  const t = setInterval(revisar, cadaMs);
  const alVolver = () => document.visibilityState === "visible" && revisar();
  document.addEventListener("visibilitychange", alVolver);
  return () => {
    activo = false;
    clearInterval(t);
    document.removeEventListener("visibilitychange", alVolver);
  };
};
