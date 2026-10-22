// src/api/entities.js
// Capa de datos de la app. Toda la app habla SOLO con este archivo, así que
// para pasar a Cloudflare D1 basta con reescribir este archivo con la misma interfaz.
//
// MODO ACTUAL: demo local (localStorage). Los datos viven solo en este navegador.
//
// Entidades:
//   Sap        → último reporte de SAP (un renglón por material|lote)
//   Conteo     → cada inventario físico (uno "EN_CURSO" a la vez; los anteriores quedan "CERRADO")
//   Registro   → cada bulto contado en un conteo, con su ubicación (zona, carril, posición)
//   Movimiento → bitácora

export const MODO_DATOS = "LOCAL";

const K = {
  sap: "wip3_sap",
  conteos: "wip3_conteos",
  registros: "wip3_registros",
  movimientos: "wip3_movimientos",
};

const ahora = () => new Date().toISOString();
const nuevoId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const oyentes = new Set();
const avisar = () => oyentes.forEach((cb) => cb());

const leer = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "[]");
  } catch {
    return [];
  }
};
const escribir = (k, datos, { silencioso = false } = {}) => {
  try {
    localStorage.setItem(k, JSON.stringify(datos));
  } catch (e) {
    throw new Error(
      "No hay espacio en el almacenamiento del navegador. Borra conteos antiguos o usa la versión con base de datos. (" + e.message + ")",
      { cause: e }
    );
  }
  if (!silencioso) avisar();
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (Object.values(K).includes(e.key)) avisar();
  });
}

// Migración: la versión anterior guardaba el reporte en "wip_bultos_v2"
(() => {
  try {
    if (localStorage.getItem(K.sap)) return;
    const viejo = JSON.parse(localStorage.getItem("wip_bultos_v2") || "[]");
    const sap = viejo
      .filter((b) => b.estado !== "SOBRANTE" && b.en_sap)
      .map((b) => ({
        clave: b.clave,
        lote: b.lote,
        material: b.material,
        texto_breve: b.texto_breve,
        centro: b.centro,
        almacen: b.almacen,
        unidad: b.unidad,
        cantidad_sap: b.cantidad_sap,
        en_calidad: b.en_calidad,
        etapa: b.etapa,
        calibre: b.calibre,
        en_sap: true,
        actualizado_en: b.actualizado_en,
      }));
    if (sap.length) localStorage.setItem(K.sap, JSON.stringify(sap));
  } catch {
    /* sin datos previos */
  }
})();

const CAMPOS_SAP = ["clave", "lote", "material", "texto_breve", "centro", "almacen", "unidad", "cantidad_sap", "en_calidad", "etapa", "calibre"];
const soloSap = (f) => Object.fromEntries(CAMPOS_SAP.map((c) => [c, f[c] ?? null]));

export const totalesSap = (sap) => {
  const t = { VIRGEN: 0, RECUBIERTA: 0, IMPRESA: 0, OTRO: 0, total: 0 };
  for (const s of sap) {
    if (!s.en_sap) continue;
    t[s.etapa in t ? s.etapa : "OTRO"]++;
    t.total++;
  }
  return t;
};

// ======================================================================
export const Sap = {
  list: async () => leer(K.sap),

  sincronizar: async (filas, { marcarFaltantes = true } = {}) => {
    const porClave = new Map(leer(K.sap).map((s) => [s.clave, s]));
    const nuevas = new Set(filas.map((f) => f.clave));
    let creados = 0;
    let cambiosCantidad = 0;
    for (const f of filas) {
      const e = porClave.get(f.clave);
      if (e) {
        if (Number(e.cantidad_sap) !== Number(f.cantidad_sap)) cambiosCantidad++;
        Object.assign(e, soloSap(f), { en_sap: true, actualizado_en: ahora() });
      } else {
        porClave.set(f.clave, { ...soloSap(f), en_sap: true, actualizado_en: ahora() });
        creados++;
      }
    }
    let yaNoEnSap = 0;
    if (marcarFaltantes) {
      for (const s of porClave.values()) {
        if (s.en_sap && !nuevas.has(s.clave)) {
          s.en_sap = false;
          yaNoEnSap++;
        }
      }
    }
    escribir(K.sap, [...porClave.values()]);
    return { creados, actualizados: filas.length - creados, cambiosCantidad, yaNoEnSap, total: filas.length };
  },

  quitarFueraDeSap: async () => escribir(K.sap, leer(K.sap).filter((s) => s.en_sap)),
};

// ======================================================================
export const Conteo = {
  list: async () => leer(K.conteos).sort((a, b) => b.creado_en.localeCompare(a.creado_en)),

  // Devuelve el conteo en curso; si no hay, lo crea
  actual: async () => {
    const conteos = leer(K.conteos);
    let c = conteos.find((x) => x.estado === "EN_CURSO");
    if (!c) {
      c = { id: nuevoId(), estado: "EN_CURSO", creado_en: ahora(), cerrado_en: null, creado_por: null, totales_sap: null };
      escribir(K.conteos, [c, ...conteos], { silencioso: true });
    }
    return c;
  },

  // Cierra el conteo en curso (guardando cómo estaba SAP) y abre uno nuevo vacío
  nuevo: async (usuario) => {
    const sap = leer(K.sap);
    const conteos = leer(K.conteos).map((c) =>
      c.estado === "EN_CURSO" ? { ...c, estado: "CERRADO", cerrado_en: ahora(), totales_sap: totalesSap(sap) } : c
    );
    const c = { id: nuevoId(), estado: "EN_CURSO", creado_en: ahora(), cerrado_en: null, creado_por: usuario || null, totales_sap: null };
    escribir(K.conteos, [c, ...conteos]);
    return c;
  },

  eliminar: async (id) => {
    escribir(K.registros, leer(K.registros).filter((r) => r.conteo_id !== id), { silencioso: true });
    escribir(K.movimientos, leer(K.movimientos).filter((m) => m.conteo_id !== id), { silencioso: true });
    escribir(K.conteos, leer(K.conteos).filter((c) => c.id !== id));
  },
};

// ======================================================================
export const Registro = {
  list: async (conteoId) => leer(K.registros).filter((r) => r.conteo_id === conteoId),

  // Un bulto (clave) solo puede estar una vez por conteo: si ya existe se actualiza (y se mueve)
  guardar: async (datos) => {
    const todos = leer(K.registros);
    const i = todos.findIndex((r) => r.conteo_id === datos.conteo_id && r.clave === datos.clave);
    const anterior = i === -1 ? null : { ...todos[i] };
    const registro = {
      ...(anterior ?? { id: nuevoId(), creado_en: ahora() }),
      ...datos,
      orden: Date.now(),
      actualizado_en: ahora(),
    };
    if (i === -1) todos.push(registro);
    else todos[i] = registro;
    escribir(K.registros, todos);
    return { registro, anterior };
  },

  actualizar: async (id, cambios) => {
    const todos = leer(K.registros);
    const r = todos.find((x) => x.id === id);
    if (!r) throw new Error("Registro no encontrado");
    Object.assign(r, cambios, { actualizado_en: ahora() });
    if ("posicion" in cambios) r.orden = Date.now();
    escribir(K.registros, todos);
    return r;
  },

  eliminar: async (id) => escribir(K.registros, leer(K.registros).filter((r) => r.id !== id)),
};

// ======================================================================
export const Movimiento = {
  list: async (conteoId) =>
    leer(K.movimientos)
      .filter((m) => !conteoId || m.conteo_id === conteoId)
      .slice(0, 300),
  create: async (m) => {
    const mov = { id: nuevoId(), creado_en: ahora(), ...m };
    escribir(K.movimientos, [mov, ...leer(K.movimientos)].slice(0, 3000));
    return mov;
  },
};

export const suscribir = (cb) => {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
};
