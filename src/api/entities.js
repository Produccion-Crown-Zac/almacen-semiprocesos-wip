// src/api/entities.js
// Capa de datos de la app. Toda la app habla SOLO con este archivo.
//
//  - Si existen VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY → usa Supabase
//    (datos compartidos entre PC de Citrix y celulares, en tiempo real).
//  - Si no existen → usa localStorage (modo demo, solo en este navegador).
//
// Interfaz (igual en ambos modos):
//   Bulto.list()                         → todos los bultos
//   Bulto.sincronizarSap(filas, {marcarFaltantes}) → upsert del reporte SAP; marca los que ya no vienen
//   Bulto.registrarConteo(id, cambios)   → guarda el check físico
//   Bulto.registrarSobrante(datos)       → bulto escaneado que no está en SAP
//   Bulto.reiniciarConteo()              → todo vuelve a PENDIENTE
//   Bulto.suscribir(cb)                  → avisa cuando otro dispositivo cambia algo
//   Movimiento.list() / Movimiento.create(datos)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const MODO_DATOS = SUPABASE_URL && SUPABASE_KEY ? "SUPABASE" : "LOCAL";

const ahora = () => new Date().toISOString();

const CAMPOS_SAP = [
  "clave",
  "lote",
  "material",
  "texto_breve",
  "centro",
  "almacen",
  "unidad",
  "cantidad_sap",
  "en_calidad",
  "etapa",
  "calibre",
];

const soloCamposSap = (f) =>
  Object.fromEntries(CAMPOS_SAP.map((c) => [c, f[c] ?? null]));

const AUDITORIA_VACIA = {
  estado: "PENDIENTE", // PENDIENTE | OK | DIFERENCIA | SOBRANTE
  cantidad_fisica: null,
  verificado_por: null,
  verificado_en: null,
};

// ======================================================================
//  MODO LOCAL (localStorage)
// ======================================================================
const crearLocal = () => {
  const K_BULTOS = "wip_bultos_v2";
  const K_MOV = "wip_movimientos_v2";
  const oyentes = new Set();

  const leer = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || "[]");
    } catch {
      return [];
    }
  };
  const escribir = (k, datos) => {
    localStorage.setItem(k, JSON.stringify(datos));
    oyentes.forEach((cb) => cb());
  };

  // Otra pestaña del mismo navegador cambió los datos
  window.addEventListener("storage", (e) => {
    if (e.key === K_BULTOS || e.key === K_MOV) oyentes.forEach((cb) => cb());
  });

  const Bulto = {
    list: async () => leer(K_BULTOS),

    sincronizarSap: async (filas, { marcarFaltantes = true } = {}) => {
      const actuales = leer(K_BULTOS);
      const porClave = new Map(actuales.map((b) => [b.clave, b]));
      const clavesNuevas = new Set(filas.map((f) => f.clave));
      let creados = 0;
      let actualizados = 0;
      let cambiosCantidad = 0;

      for (const f of filas) {
        const existente = porClave.get(f.clave);
        if (existente) {
          if (Number(existente.cantidad_sap) !== Number(f.cantidad_sap)) cambiosCantidad++;
          Object.assign(existente, soloCamposSap(f), { en_sap: true, actualizado_en: ahora() });
          actualizados++;
        } else {
          porClave.set(f.clave, {
            id: crypto.randomUUID(),
            ...soloCamposSap(f),
            ...AUDITORIA_VACIA,
            en_sap: true,
            creado_en: ahora(),
            actualizado_en: ahora(),
          });
          creados++;
        }
      }
      let yaNoEnSap = 0;
      for (const b of porClave.values()) {
        if (marcarFaltantes && !clavesNuevas.has(b.clave) && b.en_sap) {
          b.en_sap = false;
          yaNoEnSap++;
        }
      }
      escribir(K_BULTOS, [...porClave.values()]);
      return { creados, actualizados, cambiosCantidad, yaNoEnSap, total: filas.length };
    },

    registrarConteo: async (id, cambios) => {
      const datos = leer(K_BULTOS);
      const b = datos.find((x) => x.id === id);
      if (!b) throw new Error("Bulto no encontrado");
      Object.assign(b, cambios, { actualizado_en: ahora() });
      escribir(K_BULTOS, datos);
      return b;
    },

    registrarSobrante: async ({ lote, cantidad_fisica, verificado_por }) => {
      const datos = leer(K_BULTOS);
      const nuevo = {
        id: crypto.randomUUID(),
        clave: `SOBRANTE|${lote}`,
        lote,
        material: "",
        texto_breve: "Escaneado en piso — no está en el reporte SAP",
        centro: "",
        almacen: "",
        unidad: "",
        cantidad_sap: 0,
        en_calidad: 0,
        etapa: "OTRO",
        calibre: "",
        estado: "SOBRANTE",
        cantidad_fisica,
        verificado_por,
        verificado_en: ahora(),
        en_sap: false,
        creado_en: ahora(),
        actualizado_en: ahora(),
      };
      const sinDuplicar = datos.filter((x) => x.clave !== nuevo.clave);
      escribir(K_BULTOS, [nuevo, ...sinDuplicar]);
      return nuevo;
    },

    reiniciarConteo: async () => {
      const datos = leer(K_BULTOS)
        .filter((b) => b.estado !== "SOBRANTE")
        .map((b) => ({ ...b, ...AUDITORIA_VACIA }));
      escribir(K_BULTOS, datos);
    },

    eliminarFueraDeSap: async () => {
      escribir(K_BULTOS, leer(K_BULTOS).filter((b) => b.en_sap || b.estado === "SOBRANTE"));
    },

    suscribir: (cb) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },
  };

  const Movimiento = {
    list: async () => leer(K_MOV).slice(0, 200),
    create: async (m) => {
      const mov = { id: crypto.randomUUID(), creado_en: ahora(), ...m };
      escribir(K_MOV, [mov, ...leer(K_MOV)].slice(0, 1000));
      return mov;
    },
  };

  return { Bulto, Movimiento };
};

// ======================================================================
//  MODO SUPABASE
// ======================================================================
const crearSupabase = () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const T_BULTOS = "bultos";
  const T_MOV = "movimientos";

  const verificar = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  // PostgREST devuelve máximo 1000 filas por consulta: paginar
  const traerTodo = async (tabla, columnas = "*") => {
    const pagina = 1000;
    let desde = 0;
    let todo = [];
    for (;;) {
      const datos = verificar(
        await sb.from(tabla).select(columnas).order("lote").range(desde, desde + pagina - 1)
      );
      todo = todo.concat(datos);
      if (datos.length < pagina) break;
      desde += pagina;
    }
    return todo;
  };

  const enBloques = async (arreglo, tam, fn) => {
    for (let i = 0; i < arreglo.length; i += tam) await fn(arreglo.slice(i, i + tam));
  };

  const Bulto = {
    list: () => traerTodo(T_BULTOS),

    sincronizarSap: async (filas, { marcarFaltantes = true } = {}) => {
      const actuales = await traerTodo(T_BULTOS, "id,clave,cantidad_sap,en_sap");
      const porClave = new Map(actuales.map((b) => [b.clave, b]));
      const clavesNuevas = new Set(filas.map((f) => f.clave));
      let creados = 0;
      let cambiosCantidad = 0;
      for (const f of filas) {
        const e = porClave.get(f.clave);
        if (!e) creados++;
        else if (Number(e.cantidad_sap) !== Number(f.cantidad_sap)) cambiosCantidad++;
      }

      // El upsert solo toca columnas de SAP: el estado del conteo se conserva
      const payload = filas.map((f) => ({ ...soloCamposSap(f), en_sap: true, actualizado_en: ahora() }));
      await enBloques(payload, 500, async (bloque) =>
        verificar(await sb.from(T_BULTOS).upsert(bloque, { onConflict: "clave" }))
      );

      const idsFuera = actuales
        .filter((b) => marcarFaltantes && b.en_sap && !clavesNuevas.has(b.clave))
        .map((b) => b.id);
      await enBloques(idsFuera, 200, async (bloque) =>
        verificar(await sb.from(T_BULTOS).update({ en_sap: false }).in("id", bloque))
      );

      return {
        creados,
        actualizados: filas.length - creados,
        cambiosCantidad,
        yaNoEnSap: idsFuera.length,
        total: filas.length,
      };
    },

    registrarConteo: async (id, cambios) =>
      verificar(
        await sb
          .from(T_BULTOS)
          .update({ ...cambios, actualizado_en: ahora() })
          .eq("id", id)
          .select()
          .single()
      ),

    registrarSobrante: async ({ lote, cantidad_fisica, verificado_por }) =>
      verificar(
        await sb
          .from(T_BULTOS)
          .upsert(
            {
              clave: `SOBRANTE|${lote}`,
              lote,
              material: "",
              texto_breve: "Escaneado en piso — no está en el reporte SAP",
              cantidad_sap: 0,
              etapa: "OTRO",
              calibre: "",
              estado: "SOBRANTE",
              cantidad_fisica,
              verificado_por,
              verificado_en: ahora(),
              en_sap: false,
            },
            { onConflict: "clave" }
          )
          .select()
          .single()
      ),

    reiniciarConteo: async () => {
      verificar(await sb.from(T_BULTOS).delete().eq("estado", "SOBRANTE"));
      verificar(
        await sb.from(T_BULTOS).update(AUDITORIA_VACIA).neq("estado", "PENDIENTE")
      );
    },

    eliminarFueraDeSap: async () => {
      verificar(
        await sb.from(T_BULTOS).delete().eq("en_sap", false).neq("estado", "SOBRANTE")
      );
    },

    suscribir: (cb) => {
      let temporizador = null;
      const avisar = () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(cb, 400); // agrupa ráfagas (ej. una sincronización)
      };
      const canal = sb
        .channel("cambios-inventario")
        .on("postgres_changes", { event: "*", schema: "public", table: T_BULTOS }, avisar)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: T_MOV }, avisar)
        .subscribe();
      return () => sb.removeChannel(canal);
    },
  };

  const Movimiento = {
    list: async () =>
      verificar(
        await sb.from(T_MOV).select("*").order("creado_en", { ascending: false }).limit(200)
      ),
    create: async (m) => verificar(await sb.from(T_MOV).insert(m).select().single()),
  };

  return { Bulto, Movimiento };
};

const api = MODO_DATOS === "SUPABASE" ? crearSupabase() : crearLocal();

export const Bulto = api.Bulto;
export const Movimiento = api.Movimiento;
