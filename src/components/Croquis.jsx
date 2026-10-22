// src/components/Croquis.jsx
// Mapa del almacén dibujado con las coordenadas del Excel del croquis.
// Cada posición muestra una franja por lote, pintada según calibre / Ecotapa / aluminio.
import { memo } from "react";
import { CARRILES, FONDOS, TITULOS, ZONAS, COLUMNAS, FILAS, COLORES_LOTE, tipoColorLote } from "../lib/croquis";
import { claveUbicacion } from "../lib/formato";

const CW = 14; // ancho de columna en px
const RH = 13; // alto de fila en px
const OX = 30;
const OY = 22;
const px = (col) => OX + (col - 1) * CW;
const py = (row) => OY + (row - 1) * RH;

function Croquis({ mapa, zonaFiltro = "TODAS", seleccion, onSeleccionar }) {
  const atenuar = (zona) => zonaFiltro !== "TODAS" && zonaFiltro !== zona;
  return (
    <div className="overflow-x-auto rounded-xl bg-[#0d1528]">
      <div className="relative" style={{ width: px(COLUMNAS + 1) + 16, height: py(FILAS) + 8 }}>
        {FONDOS.map((f, i) => (
          <div
            key={i}
            className="absolute rounded-lg box-border transition-opacity"
            style={{
              left: px(f.c1),
              top: py(f.r1),
              width: (f.c2 - f.c1 + 1) * CW,
              height: (f.r2 - f.r1 + 1) * RH,
              background: ZONAS[f.zona].fondo,
              border: `1px solid ${ZONAS[f.zona].borde}`,
              opacity: atenuar(f.zona) ? 0.25 : 1,
            }}
          />
        ))}
        {TITULOS.map((t) => (
          <div
            key={t.zona}
            className="absolute text-xs font-extrabold tracking-[.08em] whitespace-nowrap uppercase"
            style={{ left: px(t.col), top: py(t.row), color: ZONAS[t.zona].texto, opacity: atenuar(t.zona) ? 0.3 : 1 }}
          >
            {ZONAS[t.zona].titulo}
          </div>
        ))}
        {CARRILES.map((c) => {
          const e = c.etiqueta;
          const estilo =
            e.lado === "izq"
              ? { left: px(e.col) - 22, top: py(e.row), width: 34, textAlign: "right" }
              : e.lado === "der"
              ? { left: px(e.col) + 2, top: py(e.row), width: 30, textAlign: "left" }
              : { left: px(e.col) - 6, top: py(e.row), width: 26, textAlign: "center" };
          const texto = c.id === "DES" ? "DES" : c.id;
          return (
            <div
              key={`${c.zona}-${c.id}`}
              className="absolute font-mono text-[9px] font-bold leading-[13px] text-slate-300 whitespace-nowrap"
              style={{ ...estilo, opacity: atenuar(c.zona) ? 0.3 : 1 }}
            >
              {texto}
            </div>
          );
        })}
        {CARRILES.map((c) =>
          c.celdas.map((celda, i) => {
            const pos = i + 1;
            const k = claveUbicacion(c.zona, c.id, pos);
            const lotes = mapa.get(k) ?? [];
            const conObs = lotes.some((l) => l.motivo);
            const sel = seleccion === k;
            const exceso = lotes.length > 5;
            return (
              <button
                key={k}
                onClick={() => onSeleccionar?.(k)}
                aria-label={`${ZONAS[c.zona].nombre} carril ${c.nombre} posición ${pos}: ${lotes.length} lotes`}
                title={`${ZONAS[c.zona].nombre} · Carril ${c.nombre} · Posición ${pos}${lotes.length ? `\n${lotes.map((l) => l.lote).join("\n")}` : "\nVacía"}`}
                className="absolute box-border p-0 flex flex-col-reverse gap-px overflow-hidden rounded-[2px] cursor-pointer bg-[#0b1120]"
                style={{
                  left: px(celda.col) + 1,
                  top: py(celda.row) + 1,
                  width: CW - 2,
                  height: RH - 2,
                  border: lotes.length ? "none" : "1px solid rgba(148,163,184,.28)",
                  outline: sel ? "2px solid #f59e0b" : exceso ? "2px solid #ef4444" : conObs ? "2px solid #facc15" : "none",
                  outlineOffset: sel ? 1 : 0,
                  opacity: atenuar(c.zona) ? 0.25 : 1,
                  zIndex: sel ? 2 : 1,
                }}
              >
                {lotes.slice(-5).map((l) => (
                  <span key={l.id} className="block flex-1" style={{ background: COLORES_LOTE[tipoColorLote(l)].color }} />
                ))}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(Croquis);
