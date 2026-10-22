// src/lib/formato.js
import { totalesSap } from "../api/entities";

export const num = (n) => Number(n ?? 0).toLocaleString("es-MX");

export const hora = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

export const fecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "";

export const ETAPAS = {
  VIRGEN: { nombre: "Virgen", color: "bg-pink-500/15 text-pink-200 border border-pink-400/40" },
  RECUBIERTA: { nombre: "Recubierta", color: "bg-orange-500/15 text-orange-200 border border-orange-400/40" },
  IMPRESA: { nombre: "Impresa", color: "bg-violet-500/15 text-violet-200 border border-violet-400/40" },
  OTRO: { nombre: "Otro", color: "bg-slate-800 text-slate-400" },
};

export const limpiarCodigo = (texto) =>
  String(texto ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

export const claveUbicacion = (zona, carril, posicion) => `${zona}|${carril}|${posicion}`;

// Lotes por posición del croquis (ordenados de abajo hacia arriba)
export const mapaPosiciones = (registros) => {
  const m = new Map();
  for (const r of registros) {
    if (!r.zona || !r.carril || !r.posicion) continue;
    const k = claveUbicacion(r.zona, r.carril, r.posicion);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  for (const lista of m.values()) lista.sort((a, b) => a.orden - b.orden);
  return m;
};

export const calcularResumen = (sap, registros, conteo) => {
  const totales = conteo?.estado === "CERRADO" && conteo.totales_sap ? conteo.totales_sap : totalesSap(sap);
  const base = () => ({ verificados: 0, piezas: 0, observaciones: 0, diferencias: 0 });
  const por = { VIRGEN: base(), RECUBIERTA: base(), IMPRESA: base(), OTRO: base() };
  let sobrantes = 0;
  let enSeguimiento = 0;
  for (const r of registros) {
    if (r.estado === "SOBRANTE") sobrantes++;
    if (r.motivo && !r.posicion) enSeguimiento++;
    if (r.estado === "SOBRANTE") continue;
    const e = por[r.etapa] ?? por.OTRO;
    e.verificados++;
    e.piezas += Number(r.cantidad_fisica ?? 0);
    if (r.motivo) e.observaciones++;
    if (r.estado === "DIFERENCIA") e.diferencias++;
  }
  const pct = (a, b) => {
    if (!b) return 0;
    const p = (a / b) * 100;
    return p > 0 && p < 10 ? Math.round(p * 10) / 10 : Math.min(100, Math.round(p));
  };
  const zonas = {};
  for (const z of ["VIRGEN", "RECUBIERTA", "IMPRESA"]) {
    zonas[z] = { ...por[z], total: totales[z] ?? 0, avance: pct(por[z].verificados, totales[z] ?? 0) };
  }
  const verificados = ["VIRGEN", "RECUBIERTA", "IMPRESA", "OTRO"].reduce((a, z) => a + por[z].verificados, 0);
  return {
    zonas,
    general: {
      verificados,
      total: totales.total ?? 0,
      avance: pct(verificados, totales.total ?? 0),
      piezas: Object.values(por).reduce((a, e) => a + e.piezas, 0),
      observaciones: Object.values(por).reduce((a, e) => a + e.observaciones, 0),
      diferencias: Object.values(por).reduce((a, e) => a + e.diferencias, 0),
    },
    sobrantes,
    enSeguimiento,
    fueraDeSap: sap.filter((s) => !s.en_sap).length,
  };
};
