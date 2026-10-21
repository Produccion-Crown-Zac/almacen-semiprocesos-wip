// src/lib/formato.js
import { LOTE_ESTANDAR } from "./sapParser";

export const num = (n) => Number(n ?? 0).toLocaleString("es-MX");

export const hora = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export const esPico = (b) => Number(b.cantidad_sap) > 0 && Number(b.cantidad_sap) < LOTE_ESTANDAR;

export const ETAPAS = {
  VIRGEN: { nombre: "Virgen", color: "bg-slate-700 text-slate-100" },
  RECUBIERTA: { nombre: "Recubierta", color: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
  IMPRESA: { nombre: "Impresa", color: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
  OTRO: { nombre: "Otro", color: "bg-slate-800 text-slate-400" },
};

export const ESTADOS = {
  PENDIENTE: { nombre: "Pendiente", color: "bg-slate-800 text-slate-400" },
  OK: { nombre: "✓ Verificado", color: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
  DIFERENCIA: { nombre: "⚠ Diferencia", color: "bg-amber-500/20 text-amber-300 border border-amber-500/30" },
  SOBRANTE: { nombre: "✚ No está en SAP", color: "bg-red-500/20 text-red-300 border border-red-500/30" },
};

export const limpiarCodigo = (texto) =>
  String(texto ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

export const calcularResumen = (bultos) => {
  const enSap = bultos.filter((b) => b.en_sap);
  const r = {
    total: enSap.length,
    laminas: 0,
    ok: 0,
    diferencia: 0,
    pendiente: 0,
    sobrante: bultos.filter((b) => b.estado === "SOBRANTE").length,
    fueraDeSap: bultos.filter((b) => !b.en_sap && b.estado !== "SOBRANTE").length,
    porEtapa: {
      VIRGEN: { laminas: 0, bultos: 0, picos: 0 },
      RECUBIERTA: { laminas: 0, bultos: 0, picos: 0 },
      IMPRESA: { laminas: 0, bultos: 0, picos: 0 },
      OTRO: { laminas: 0, bultos: 0, picos: 0 },
    },
  };
  for (const b of enSap) {
    r.laminas += Number(b.cantidad_sap);
    if (b.estado === "OK") r.ok++;
    else if (b.estado === "DIFERENCIA") r.diferencia++;
    else r.pendiente++;
    const e = r.porEtapa[b.etapa] ?? r.porEtapa.OTRO;
    e.laminas += Number(b.cantidad_sap);
    e.bultos++;
    if (esPico(b)) e.picos++;
  }
  const pct = r.total ? ((r.ok + r.diferencia) / r.total) * 100 : 0;
  r.avance = pct > 0 && pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return r;
};
