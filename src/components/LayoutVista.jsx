// src/components/LayoutVista.jsx
// Subapartado "Layout" del tablero: mapa del almacén, buscador de bultos con su ficha
// (zona, carril, posición, nivel, historial) y detalle de la posición seleccionada.
import { useMemo, useState } from "react";
import { Search, X, MapPin } from "lucide-react";
import { CAPACIDAD_POSICION, ZONAS, buscarCarril, textoUbicacion } from "../lib/croquis";
import { ETAPAS, num, hora, fecha, claveUbicacion } from "../lib/formato";
import Croquis from "./Croquis";
import { Leyenda, PilaPosicion } from "./Comunes";
import { EstadoChip, FilaRegistro } from "./Registros";

const Dato = ({ etiqueta, children, grande = false }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[11px] uppercase tracking-[.06em] text-slate-400">{etiqueta}</span>
    <span className={`${grande ? "text-xl font-black" : "text-sm font-bold"} text-white`}>{children}</span>
  </div>
);

export default function LayoutVista({
  sap,
  registros,
  registrosTodos,
  conteos,
  conteoVisto,
  mapa,
  zonaFiltro,
  soloLectura,
  buscado,
  setBuscado,
  acciones,
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState(null);

  const porClave = useMemo(() => new Map(registros.map((r) => [r.clave, r])), [registros]);

  const candidatos = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (t.length < 2) return [];
    const lista = [
      ...registros.filter((r) => r.estado === "SOBRANTE"),
      ...sap.filter((s) => s.en_sap),
    ].filter((x) => String(x.lote).includes(t) || String(x.texto_breve ?? "").toUpperCase().includes(t) || String(x.material ?? "") === t);
    // Primero los que empiezan con el texto buscado
    lista.sort((a, b) => (String(b.lote).startsWith(t) ? 1 : 0) - (String(a.lote).startsWith(t) ? 1 : 0));
    return lista.slice(0, 8);
  }, [q, sap, registros]);

  const elegir = (x) => {
    setBuscado(x.clave);
    setQ(x.lote);
    setAbierto(false);
    const r = porClave.get(x.clave);
    setSeleccion(r?.posicion ? claveUbicacion(r.zona, r.carril, r.posicion) : null);
  };

  // ---------- Ficha del bulto buscado ----------
  const ficha = useMemo(() => {
    if (!buscado) return null;
    const reg = porClave.get(buscado) ?? null;
    const s = sap.find((x) => x.clave === buscado) ?? reg;
    if (!s) return null;
    let nivel = null;
    let pila = [];
    if (reg?.posicion) {
      pila = mapa.get(claveUbicacion(reg.zona, reg.carril, reg.posicion)) ?? [];
      nivel = pila.findIndex((x) => x.id === reg.id) + 1;
    }
    const fechas = new Map(conteos.map((c) => [c.id, c]));
    const historial = registrosTodos
      .filter((r) => r.lote === s.lote && r.conteo_id !== conteoVisto?.id)
      .map((r) => ({ r, c: fechas.get(r.conteo_id) }))
      .sort((a, b) => (b.c?.creado_en ?? "").localeCompare(a.c?.creado_en ?? ""));
    return { s, reg, nivel, pila, historial };
  }, [buscado, porClave, sap, mapa, conteos, registrosTodos, conteoVisto]);

  const resaltado = ficha?.reg?.posicion ? claveUbicacion(ficha.reg.zona, ficha.reg.carril, ficha.reg.posicion) : null;

  const lotesSeleccion = seleccion ? mapa.get(seleccion) ?? [] : [];
  const [selZona, selCarril, selPos] = seleccion ? seleccion.split("|") : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Buscador de bulto */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
        <div className="relative">
          <label className="flex items-center gap-2 bg-slate-950 border border-cyan-700/60 rounded-xl px-3 focus-within:border-cyan-400">
            <Search className="w-5 h-5 text-cyan-300 shrink-0" />
            <span className="sr-only">Buscar bulto</span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setAbierto(true);
              }}
              onFocus={() => setAbierto(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && candidatos[0]) elegir(candidatos[0]);
                if (e.key === "Escape") setAbierto(false);
              }}
              placeholder="Buscar bulto por número de lote, material o descripción y ubicarlo en el layout…"
              className="flex-1 bg-transparent py-3 text-sm text-white outline-none"
            />
            {(q || buscado) && (
              <button
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQ("");
                  setBuscado(null);
                }}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </label>
          {abierto && candidatos.length > 0 && (
            <ul className="absolute z-30 left-0 right-0 mt-1 m-0 p-1 list-none bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto">
              {candidatos.map((x) => {
                const r = porClave.get(x.clave);
                return (
                  <li key={x.clave}>
                    <button onClick={() => elegir(x)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex justify-between gap-3 cursor-pointer">
                      <span className="min-w-0">
                        <span className="font-mono text-sm font-bold text-white">{x.lote}</span>
                        <span className="block text-xs text-slate-400 truncate">
                          {x.estado === "SOBRANTE" ? "No está en SAP" : `${x.material} · ${x.texto_breve}`}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs self-center ${r ? "text-cyan-300" : "text-slate-500"}`}>
                        {r ? textoUbicacion(r.zona, r.carril, r.posicion) : "Pendiente"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {ficha && (
          <div className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 p-4 flex flex-col gap-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <MapPin className="w-4 h-4" /> Ficha del bulto
                </div>
                <div className="font-mono text-2xl font-extrabold text-white">{ficha.s.lote}</div>
                <div className="text-sm text-slate-200">{ficha.reg?.estado === "SOBRANTE" ? "Escaneado en piso — no está en el reporte SAP" : ficha.s.texto_breve}</div>
                {ficha.s.material && (
                  <div className="text-xs text-slate-500">
                    Material (SKU) {ficha.s.material} · Almacén {ficha.s.almacen || "—"} · Centro {ficha.s.centro || "—"}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 items-start">
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${ETAPAS[ficha.s.etapa]?.color ?? ETAPAS.OTRO.color}`}>
                  {ETAPAS[ficha.s.etapa]?.nombre ?? "Otro"}
                </span>
                {ficha.s.calibre && (
                  <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-100">
                    {ficha.s.calibre === "ALU" ? "Aluminio" : `Calibre ${ficha.s.calibre}`}
                  </span>
                )}
                {String(ficha.s.lote).startsWith("ECOTAP") && <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-pink-600 text-white">Ecotapa</span>}
                <EstadoChip enSap={ficha.s.en_sap} r={ficha.reg} />
              </div>
            </div>

            {ficha.reg ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  <Dato etiqueta="Zona">{ficha.reg.zona ? ZONAS[ficha.reg.zona].nombre : "Seguimiento"}</Dato>
                  <Dato etiqueta="Carril">{ficha.reg.carril ? buscarCarril(ficha.reg.zona, ficha.reg.carril)?.nombre ?? ficha.reg.carril : "—"}</Dato>
                  <Dato etiqueta="Posición">{ficha.reg.posicion ?? "—"}</Dato>
                  <Dato etiqueta="Nivel">{ficha.nivel ? `${ficha.nivel} de ${ficha.pila.length}` : "—"}</Dato>
                  <Dato etiqueta="Piezas SAP">{ficha.reg.estado === "SOBRANTE" ? "—" : num(ficha.reg.cantidad_sap)}</Dato>
                  <Dato etiqueta="Piezas físicas">{num(ficha.reg.cantidad_fisica)}</Dato>
                  <Dato etiqueta="Diferencia">
                    {ficha.reg.estado === "SOBRANTE"
                      ? `+${num(ficha.reg.cantidad_fisica)}`
                      : (() => {
                          const d = Number(ficha.reg.cantidad_fisica ?? 0) - Number(ficha.reg.cantidad_sap ?? 0);
                          return `${d > 0 ? "+" : ""}${num(d)}`;
                        })()}
                  </Dato>
                  <Dato etiqueta="Registrado">
                    <span className="text-xs font-semibold">
                      {ficha.reg.usuario} · {hora(ficha.reg.actualizado_en)}
                    </span>
                  </Dato>
                </div>
                {ficha.nivel && (
                  <p className="m-0 text-xs text-slate-400">
                    El nivel cuenta de abajo hacia arriba: nivel 1 es la tarima del piso.
                    {ficha.pila.length > 1 &&
                      ` Comparte la posición con: ${ficha.pila
                        .filter((x) => x.id !== ficha.reg.id)
                        .map((x) => `${x.lote} (nivel ${ficha.pila.indexOf(x) + 1})`)
                        .join(", ")}.`}
                  </p>
                )}
                {ficha.reg.motivo && (
                  <p className="m-0 text-sm text-yellow-200">
                    ● {ficha.reg.motivo}
                    {ficha.reg.comentario ? `: “${ficha.reg.comentario}”` : ""}
                  </p>
                )}
                {!ficha.reg.posicion && (
                  <p className="m-0 text-sm text-yellow-200">Este bulto está en el área de seguimiento, todavía sin posición en el layout.</p>
                )}
              </>
            ) : (
              <p className="m-0 text-sm text-slate-300">
                Todavía no se ha contado en este conteo. Según SAP tiene <strong>{num(ficha.s.cantidad_sap)} piezas</strong>.
              </p>
            )}

            <div>
              <div className="text-xs font-bold text-slate-300 mb-1">Conteos anteriores</div>
              {ficha.historial.length === 0 ? (
                <p className="m-0 text-xs text-slate-500">No aparece en conteos anteriores.</p>
              ) : (
                <ul className="m-0 p-0 list-none flex flex-col gap-1 text-xs text-slate-300">
                  {ficha.historial.slice(0, 6).map(({ r, c }) => (
                    <li key={r.id}>
                      {c ? fecha(c.creado_en) : "—"}: {textoUbicacion(r.zona, r.carril, r.posicion)} · {num(r.cantidad_fisica)} pzas
                      {r.motivo ? ` · ${r.motivo}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Mapa */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <h2 className="m-0 text-lg font-bold text-white">Layout del almacén</h2>
          <Leyenda />
        </div>
        {sap.length === 0 && registros.length === 0 && (
          <p className="m-0 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-300">
            Todavía no hay datos de SAP. Ejecuta el MB52, copia la tabla y presiona Ctrl+V en el tablero, o carga el archivo exportado.
          </p>
        )}
        <Croquis
          mapa={mapa}
          zonaFiltro={zonaFiltro}
          seleccion={seleccion}
          resaltado={resaltado}
          onSeleccionar={(k) => setSeleccion(seleccion === k ? null : k)}
        />
        <p className="m-0 text-xs text-slate-400">
          Cada cuadro es una posición; las franjas son los lotes registrados (máximo {CAPACIDAD_POSICION}), de abajo hacia arriba. El número de cada carril
          marca la posición 1. Haz clic en una posición para ver sus lotes.
        </p>

        {seleccion && (
          <div className="bg-slate-950 border border-amber-500/50 rounded-xl p-3 flex flex-col gap-3">
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-3">
                <PilaPosicion lotes={lotesSeleccion} ancho={40} alto={56} resaltarExceso />
                <div>
                  <div className="text-sm font-bold text-white">{textoUbicacion(selZona, selCarril, selPos)}</div>
                  <div className={`text-xs ${lotesSeleccion.length > CAPACIDAD_POSICION ? "text-red-300" : "text-slate-400"}`}>
                    {lotesSeleccion.length} de {CAPACIDAD_POSICION} lotes
                  </div>
                </div>
              </div>
              <button onClick={() => setSeleccion(null)} aria-label="Cerrar detalle" className="p-2 text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            {lotesSeleccion.length === 0 && <p className="m-0 text-xs text-slate-500">Posición vacía en este conteo.</p>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {[...lotesSeleccion].reverse().map((r) => (
                <FilaRegistro
                  key={r.id}
                  r={r}
                  nivel={lotesSeleccion.indexOf(r) + 1}
                  soloLectura={soloLectura}
                  onMover={() => acciones.mover(r)}
                  onResolver={() => acciones.resolver(r)}
                  onSeguimiento={() => acciones.seguimiento(r)}
                  onEliminar={() => acciones.eliminar(r)}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
