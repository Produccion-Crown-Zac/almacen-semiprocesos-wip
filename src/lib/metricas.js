// src/lib/metricas.js
// Indicadores del inventario. TODO se calcula en PIEZAS (láminas), no en lotes.
//
// Exactitud de inventario = (1 − Σ |piezas físicas − piezas SAP| ÷ Σ piezas SAP) × 100
//   sobre los lotes contados. Así un faltante y un sobrante no se compensan entre sí.
//   Un lote que no está en SAP (sobrante) suma todas sus piezas a la diferencia.
// Desviación = 100 − Exactitud.

export const META_EXACTITUD = 95;

export const metricas = (registros) => {
  const m = { lotes: 0, piezasSap: 0, piezasFisicas: 0, diferenciaAbs: 0, faltantes: 0, sobrantes: 0, lotesConDiferencia: 0 };
  for (const r of registros) {
    const f = Number(r.cantidad_fisica ?? 0);
    const s = r.estado === "SOBRANTE" ? 0 : Number(r.cantidad_sap ?? 0);
    m.lotes++;
    m.piezasSap += s;
    m.piezasFisicas += f;
    const d = f - s;
    m.diferenciaAbs += Math.abs(d);
    if (d < 0) m.faltantes += -d;
    if (d > 0) m.sobrantes += d;
    if (d !== 0) m.lotesConDiferencia++;
  }
  m.exactitud = m.piezasSap > 0 ? Math.max(0, (1 - m.diferenciaAbs / m.piezasSap) * 100) : m.lotes ? 0 : null;
  m.desviacion = m.exactitud == null ? null : 100 - m.exactitud;
  return m;
};

export const pct1 = (v) => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("es-MX")}%`);

const diaLocal = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Lunes de la semana (local) como clave
const lunesDe = (iso) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d;
};

const fmtCorta = (d) => d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

// Agrupa registros por: DIA | SEMANA | SKU | PROCESO
export const agrupar = (registros, por) => {
  const grupos = new Map();
  for (const r of registros) {
    let k;
    let etiqueta;
    let orden;
    if (por === "DIA") {
      k = diaLocal(r.actualizado_en);
      etiqueta = new Date(r.actualizado_en).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
      orden = k;
    } else if (por === "SEMANA") {
      const l = lunesDe(r.actualizado_en);
      const dom = new Date(l);
      dom.setDate(l.getDate() + 6);
      k = diaLocal(l.toISOString());
      etiqueta = `Semana del ${fmtCorta(l)} al ${fmtCorta(dom)}`;
      orden = k;
    } else if (por === "SKU") {
      k = r.estado === "SOBRANTE" ? "SOBRANTE" : r.material || "—";
      etiqueta = r.estado === "SOBRANTE" ? "No están en SAP" : `${r.material} · ${r.texto_breve}`;
      orden = k;
    } else {
      k = r.etapa || "OTRO";
      etiqueta = { VIRGEN: "Lámina virgen", RECUBIERTA: "Lámina recubierta", IMPRESA: "Lámina impresa" }[k] ?? "No están en SAP / otro";
      orden = { VIRGEN: 1, RECUBIERTA: 2, IMPRESA: 3 }[k] ?? 9;
    }
    if (!grupos.has(k)) grupos.set(k, { clave: k, etiqueta, orden, registros: [] });
    grupos.get(k).registros.push(r);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, ...metricas(g.registros) }))
    .sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0));
};
