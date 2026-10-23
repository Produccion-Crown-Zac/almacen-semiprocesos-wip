// src/components/Tablero.jsx
// Vista de PC (dentro de Citrix). Subapartados: Resumen · Layout · Seguimiento · Bultos.
// El filtro "Tipo de lámina" aplica a todos; la bitácora se abre con su ícono.
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileUp, ClipboardPaste, Download, RotateCcw, Search, History, Trash2, X, BarChart3, Map as MapIcon, AlertCircle, List } from "lucide-react";
import { Registro, Movimiento } from "../api/entities";
import { CAPACIDAD_POSICION, MOTIVOS, ZONAS, ORDEN_ZONAS, buscarCarril, carrilesDeZona, textoUbicacion } from "../lib/croquis";
import { ETAPAS, num, hora, fecha, mapaPosiciones, claveUbicacion } from "../lib/formato";
import { SelectorUbicacion, Advertencia } from "./Comunes";
import { EstadoChip, FilaRegistro } from "./Registros";
import Resumen from "./Resumen";
import LayoutVista from "./LayoutVista";

const POR_PAGINA = 200;

const leerLocal = (k, def) => {
  try {
    return localStorage.getItem(k) ?? def;
  } catch {
    return def;
  }
};
const guardarLocal = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
};

const Chip = ({ activo, onClick, children, amarillo = false, estilo }) => (
  <button
    onClick={onClick}
    style={estilo}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
      activo
        ? amarillo
          ? "bg-yellow-400 text-slate-950"
          : "bg-amber-500 text-slate-950"
        : amarillo
        ? "border border-yellow-900 text-yellow-200 hover:bg-yellow-400/10"
        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
    }`}
  >
    {children}
  </button>
);

const SUBAPARTADOS = [
  ["RESUMEN", "Resumen", BarChart3],
  ["LAYOUT", "Layout", MapIcon],
  ["SEGUIMIENTO", "Seguimiento", AlertCircle],
  ["BULTOS", "Bultos", List],
];

export default function Tablero({
  sap,
  registros,
  registrosTodos,
  movimientos,
  conteos,
  conteoVisto,
  conteoActual,
  onVerConteo,
  resumen,
  sincronizando,
  resultadoSync,
  auditor,
  onArchivo,
  onPegarBoton,
  onNuevoConteo,
  onQuitarFueraDeSap,
  onCambio,
}) {
  const soloLectura = conteoVisto?.estado === "CERRADO";
  const fileRef = useRef(null);
  const [sub, setSub] = useState(() => leerLocal("wip_subapartado", "RESUMEN"));
  const [zonaFiltro, setZonaFiltro] = useState(() => leerLocal("wip_zona_tablero", "TODAS"));
  const [bitacoraAbierta, setBitacoraAbierta] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [buscado, setBuscado] = useState(null); // clave del bulto buscado en el layout
  const [moviendo, setMoviendo] = useState(null);
  const [advertencia, setAdvertencia] = useState(null);

  const irA = (v) => {
    setSub(v);
    guardarLocal("wip_subapartado", v);
  };
  const cambiarZona = (z) => {
    setZonaFiltro(z);
    guardarLocal("wip_zona_tablero", z);
  };

  useEffect(() => {
    if (!bitacoraAbierta) return;
    const esc = (e) => e.key === "Escape" && setBitacoraAbierta(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [bitacoraAbierta]);

  const mapa = useMemo(() => mapaPosiciones(registros), [registros]);

  // ---------- Acciones sobre un registro ----------
  const ejecutarMovimiento = async (registro, destino, forzado = false) => {
    const ocupacion = (mapa.get(claveUbicacion(destino.zona, destino.carril, destino.posicion)) ?? []).filter((r) => r.id !== registro.id);
    if (ocupacion.length >= CAPACIDAD_POSICION && !forzado) {
      setAdvertencia({ registro, destino, lotes: ocupacion });
      return;
    }
    await Registro.actualizar(registro.id, { zona: destino.zona, carril: destino.carril, posicion: destino.posicion });
    await Movimiento.create({
      conteo_id: registro.conteo_id,
      lote: registro.lote,
      accion: "MOVIDO DESDE TABLERO",
      detalle: `${textoUbicacion(registro.zona, registro.carril, registro.posicion)} → ${textoUbicacion(destino.zona, destino.carril, destino.posicion)}`,
      usuario: auditor || null,
    });
    if (forzado) {
      await Movimiento.create({
        conteo_id: registro.conteo_id,
        lote: registro.lote,
        accion: "ADVERTENCIA: MÁS DE 5 LOTES",
        detalle: `${textoUbicacion(destino.zona, destino.carril, destino.posicion)} quedó con ${ocupacion.length + 1} lotes`,
        usuario: auditor || null,
      });
    }
    setMoviendo(null);
    setAdvertencia(null);
    onCambio();
  };

  const acciones = {
    mover: (r) => {
      const zona = r.zona ?? (r.etapa in ZONAS ? r.etapa : "VIRGEN");
      const carril = r.carril && buscarCarril(zona, r.carril) ? r.carril : carrilesDeZona(zona)[0].id;
      setMoviendo({ registro: r, destino: { zona, carril, posicion: r.posicion ?? 1 } });
    },
    resolver: async (r) => {
      await Registro.actualizar(r.id, { motivo: null, comentario: "" });
      await Movimiento.create({
        conteo_id: r.conteo_id,
        lote: r.lote,
        accion: "OBSERVACIÓN RESUELTA",
        detalle: `${r.motivo}${r.comentario ? `: ${r.comentario}` : ""} · ${textoUbicacion(r.zona, r.carril, r.posicion)}`,
        usuario: auditor || null,
      });
      onCambio();
    },
    seguimiento: async (r) => {
      await Registro.actualizar(r.id, { zona: null, carril: null, posicion: null, motivo: r.motivo || "Ubicación incorrecta" });
      await Movimiento.create({ conteo_id: r.conteo_id, lote: r.lote, accion: "ENVIADO A SEGUIMIENTO", detalle: `Desde ${textoUbicacion(r.zona, r.carril, r.posicion)}`, usuario: auditor || null });
      onCambio();
    },
    eliminar: async (r) => {
      if (!window.confirm(`¿Eliminar el registro del bulto ${r.lote} de este conteo? Volverá a quedar pendiente.`)) return;
      await Registro.eliminar(r.id);
      await Movimiento.create({ conteo_id: r.conteo_id, lote: r.lote, accion: "REGISTRO ELIMINADO", detalle: textoUbicacion(r.zona, r.carril, r.posicion), usuario: auditor || null });
      onCambio();
    },
  };

  const ubicar = (r) => {
    setBuscado(r.clave);
    irA("LAYOUT");
  };

  const exportar = () => {
    const porClave = new Map(registros.map((r) => [r.clave, r]));
    const datos = [...sap.map((s) => ({ s, r: porClave.get(s.clave) })), ...registros.filter((r) => r.estado === "SOBRANTE").map((r) => ({ s: r, r }))].map(
      ({ s, r }) => {
        const pila = r?.posicion ? mapa.get(claveUbicacion(r.zona, r.carril, r.posicion)) ?? [] : [];
        return {
          Bulto: s.lote,
          Material: s.material,
          "Texto breve de material": s.texto_breve,
          Proceso: ETAPAS[s.etapa]?.nombre ?? s.etapa,
          Calibre: s.calibre,
          "Piezas SAP": Number(s.cantidad_sap ?? 0),
          "Piezas físicas": r?.cantidad_fisica ?? "",
          Diferencia: r?.cantidad_fisica == null ? "" : Number(r.cantidad_fisica) - Number(r.estado === "SOBRANTE" ? 0 : s.cantidad_sap ?? 0),
          Estado: !r ? (s.en_sap ? "PENDIENTE" : "YA NO ESTÁ EN SAP") : r.estado === "SOBRANTE" ? "NO ESTÁ EN SAP" : r.estado,
          Zona: r?.zona ? ZONAS[r.zona].nombre : r ? "Seguimiento" : "",
          Carril: r?.carril ?? "",
          Posición: r?.posicion ?? "",
          Nivel: r?.posicion ? pila.findIndex((x) => x.id === r.id) + 1 : "",
          Observación: r?.motivo ?? "",
          Comentario: r?.comentario ?? "",
          "Registrado por": r?.usuario ?? "",
          "Registrado en": r?.actualizado_en ? new Date(r.actualizado_en).toLocaleString("es-MX") : "",
        };
      }
    );
    const hoja = XLSX.utils.json_to_sheet(datos);
    hoja["!cols"] = [12, 10, 42, 11, 8, 11, 13, 11, 18, 12, 8, 9, 6, 20, 30, 18, 20].map((w) => ({ wch: w }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Conteo");
    XLSX.writeFile(libro, `Conteo_${(conteoVisto?.creado_en ?? new Date().toISOString()).slice(0, 10)}.xlsx`);
  };

  const conObservacion = registros.filter((r) => r.motivo);

  return (
    <div
      className="max-w-[1720px] mx-auto flex flex-col gap-4 relative"
      onDragOver={(e) => {
        if (soloLectura) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastrando(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !soloLectura) onArchivo(f);
      }}
    >
      {arrastrando && (
        <div className="absolute inset-0 z-40 rounded-2xl border-4 border-dashed border-amber-400 bg-slate-950/90 flex items-center justify-center text-xl font-bold text-amber-300 pointer-events-none">
          Suelta aquí el reporte de SAP
        </div>
      )}

      {/* Encabezado */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col xl:flex-row xl:items-center gap-3 justify-between">
        <div>
          <h1 className="m-0 text-xl md:text-2xl font-bold text-white">Inventario de semiprocesos · Layout</h1>
          <p className="m-0 mt-1 text-xs text-slate-400">
            Copia la tabla del MB52 en SAP y presiona <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">Ctrl</kbd>+
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">V</kbd> aquí, o arrastra el archivo exportado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-slate-600 bg-slate-950 text-sm text-white">
            <span className={`w-2 h-2 rounded-full ${soloLectura ? "bg-slate-400" : "bg-emerald-500"}`} />
            <span className="sr-only">Conteo</span>
            <select value={conteoVisto?.id ?? ""} onChange={(e) => onVerConteo(e.target.value)} className="bg-transparent text-sm font-semibold text-white outline-none cursor-pointer">
              {conteos.map((c) => (
                <option key={c.id} value={c.id} className="bg-slate-900">
                  {c.estado === "EN_CURSO" ? `Conteo en curso · ${fecha(c.creado_en)}` : `Conteo del ${fecha(c.creado_en)} (cerrado)`}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".mhtml,.mht,.html,.htm,.xls,.xlsx,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onArchivo(f);
              e.target.value = "";
            }}
          />
          <button onClick={onPegarBoton} disabled={sincronizando} className="flex items-center gap-2 h-11 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs cursor-pointer">
            <ClipboardPaste className="w-4 h-4" /> Pegar desde SAP
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={sincronizando}
            className="flex items-center gap-2 h-11 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer"
          >
            <FileUp className="w-4 h-4" /> Cargar archivo SAP
          </button>
          <button onClick={exportar} className="flex items-center gap-2 h-11 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs cursor-pointer">
            <Download className="w-4 h-4" /> Exportar
          </button>
          <button onClick={onNuevoConteo} className="flex items-center gap-2 h-11 px-3.5 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-200 font-bold text-xs cursor-pointer">
            <RotateCcw className="w-4 h-4" /> Nuevo conteo
          </button>
          <button
            onClick={() => setBitacoraAbierta(true)}
            aria-label="Abrir bitácora"
            title="Bitácora"
            className="relative w-11 h-11 rounded-xl border border-slate-600 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
          >
            <History className="w-5 h-5 text-amber-400" />
            {movimientos.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold flex items-center justify-center">
                {movimientos.length > 99 ? "99+" : movimientos.length}
              </span>
            )}
          </button>
        </div>
      </section>

      {soloLectura && (
        <div className="rounded-xl bg-slate-800/60 border border-slate-600 text-slate-200 text-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span>
            Estás viendo el conteo del <strong>{fecha(conteoVisto.creado_en)}</strong>, cerrado el {hora(conteoVisto.cerrado_en)}. Es solo de consulta.
          </span>
          <button onClick={() => onVerConteo(conteoActual?.id)} className="text-amber-300 font-semibold underline cursor-pointer">
            Volver al conteo en curso
          </button>
        </div>
      )}
      {sincronizando && <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-200 text-sm px-4 py-3">Leyendo reporte de SAP…</div>}
      {resultadoSync && !sincronizando && (
        <div
          className={`rounded-xl text-sm px-4 py-3 border ${
            resultadoSync.error ? "bg-red-500/10 border-red-500/30 text-red-200" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
          }`}
        >
          {resultadoSync.error ? (
            <>✕ {resultadoSync.error}</>
          ) : (
            <>
              <strong>✓ {resultadoSync.origen}:</strong> {num(resultadoSync.total)} bultos leídos · {resultadoSync.creados} nuevos · {resultadoSync.cambiosCantidad} con
              cantidad distinta · {resultadoSync.yaNoEnSap} ya no vienen en SAP · {resultadoSync.subtotalesIgnorados} filas de subtotal ignoradas
            </>
          )}
        </div>
      )}

      {/* Subapartados + filtro de tipo de lámina */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-2">
        <div role="tablist" aria-label="Subapartados del tablero" className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          {SUBAPARTADOS.map(([v, t, Icono]) => (
            <button
              key={v}
              role="tab"
              aria-selected={sub === v}
              onClick={() => irA(v)}
              className={`h-11 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-bold cursor-pointer ${
                sub === v ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icono className="w-4 h-4" />
              {t}
              {v === "SEGUIMIENTO" && conObservacion.length > 0 && (
                <span className={`px-1.5 rounded-full text-[10px] font-extrabold ${sub === v ? "bg-yellow-400 text-slate-950" : "bg-yellow-400/20 text-yellow-200"}`}>
                  {conObservacion.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-2">
          <span className="text-xs font-bold uppercase tracking-[.06em] text-slate-400">Tipo de lámina</span>
          <Chip activo={zonaFiltro === "TODAS"} onClick={() => cambiarZona("TODAS")}>
            Todas
          </Chip>
          {ORDEN_ZONAS.map((z) => (
            <button
              key={z}
              onClick={() => cambiarZona(z)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer border"
              style={
                zonaFiltro === z
                  ? { background: ZONAS[z].color, borderColor: ZONAS[z].color, color: "#0b1120" }
                  : { background: "transparent", borderColor: ZONAS[z].borde, color: ZONAS[z].texto }
              }
            >
              {ZONAS[z].nombre}
            </button>
          ))}
        </div>
      </section>

      {sub === "RESUMEN" && <Resumen registros={registros} registrosTodos={registrosTodos} resumen={resumen} zonaFiltro={zonaFiltro} onUbicar={ubicar} />}
      {sub === "LAYOUT" && (
        <LayoutVista
          sap={sap}
          registros={registros}
          registrosTodos={registrosTodos}
          conteos={conteos}
          conteoVisto={conteoVisto}
          mapa={mapa}
          zonaFiltro={zonaFiltro}
          soloLectura={soloLectura}
          buscado={buscado}
          setBuscado={setBuscado}
          acciones={acciones}
        />
      )}
      {sub === "SEGUIMIENTO" && (
        <Seguimiento registros={registros} resumen={resumen} zonaFiltro={zonaFiltro} soloLectura={soloLectura} acciones={acciones} onUbicar={ubicar} />
      )}
      {sub === "BULTOS" && (
        <Bultos sap={sap} registros={registros} zonaFiltro={zonaFiltro} resumen={resumen} soloLectura={soloLectura} onQuitarFueraDeSap={onQuitarFueraDeSap} onUbicar={ubicar} />
      )}

      {/* Bitácora desplegable */}
      {bitacoraAbierta && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={(e) => e.target === e.currentTarget && setBitacoraAbierta(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Bitácora" className="w-full max-w-md h-full bg-slate-900 border-l border-slate-700 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h2 className="m-0 font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" /> Bitácora
                <span className="text-xs font-normal text-slate-400">({movimientos.length})</span>
              </h2>
              <button onClick={() => setBitacoraAbierta(false)} aria-label="Cerrar bitácora" className="p-2 text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {movimientos.length === 0 && <p className="m-0 text-xs text-slate-500">Sin movimientos todavía.</p>}
              {movimientos.map((m) => (
                <div
                  key={m.id}
                  className={`p-2.5 rounded-lg border text-xs ${m.accion.startsWith("ADVERTENCIA") ? "bg-red-500/10 border-red-500/40" : "bg-slate-950 border-slate-800"}`}
                >
                  <div className="flex items-center justify-between font-bold text-amber-400 gap-2">
                    <span className="font-mono truncate">{m.lote}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">{hora(m.creado_en)}</span>
                  </div>
                  <div className={`font-semibold mt-0.5 ${m.accion.startsWith("ADVERTENCIA") ? "text-red-300" : "text-slate-200"}`}>{m.accion}</div>
                  <p className="m-0 text-slate-400 mt-0.5">{m.detalle}</p>
                  {m.usuario && <p className="m-0 text-slate-500 mt-0.5">— {m.usuario}</p>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {/* Mover lote */}
      {moviendo && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mover lote">
          <section className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4">
            <div>
              <div className="text-xs font-bold text-slate-400">Mover lote</div>
              <div className="font-mono text-xl font-extrabold text-white">{moviendo.registro.lote}</div>
              <div className="text-xs text-slate-400">Ahora en: {textoUbicacion(moviendo.registro.zona, moviendo.registro.carril, moviendo.registro.posicion)}</div>
            </div>
            <SelectorUbicacion valor={moviendo.destino} onCambio={(d) => setMoviendo({ ...moviendo, destino: d })} />
            <div className="text-xs text-slate-400">
              Esa posición tiene{" "}
              {(mapa.get(claveUbicacion(moviendo.destino.zona, moviendo.destino.carril, moviendo.destino.posicion)) ?? []).filter((x) => x.id !== moviendo.registro.id).length} de{" "}
              {CAPACIDAD_POSICION} lotes.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMoviendo(null)} className="py-3 rounded-xl border border-slate-700 text-slate-200 font-bold cursor-pointer">
                Cancelar
              </button>
              <button onClick={() => ejecutarMovimiento(moviendo.registro, moviendo.destino)} className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold cursor-pointer">
                Mover aquí
              </button>
            </div>
          </section>
        </div>
      )}
      {advertencia && (
        <Advertencia
          zona={advertencia.destino.zona}
          carril={advertencia.destino.carril}
          posicion={advertencia.destino.posicion}
          lotes={advertencia.lotes}
          lote={advertencia.registro.lote}
          onOtraPosicion={() => setAdvertencia(null)}
          onRegistrar={() => ejecutarMovimiento(advertencia.registro, advertencia.destino, true)}
        />
      )}
    </div>
  );
}

// ======================================================================
function Seguimiento({ registros, resumen, zonaFiltro, soloLectura, acciones, onUbicar }) {
  const [filtroMotivo, setFiltroMotivo] = useState("TODAS");
  const conObservacion = registros.filter((r) => r.motivo && (zonaFiltro === "TODAS" || r.etapa === zonaFiltro || r.zona === zonaFiltro));
  const cuenta = (m) => conObservacion.filter((r) => r.motivo === m).length;
  const lista = conObservacion
    .filter((r) => filtroMotivo === "TODAS" || r.motivo === filtroMotivo)
    .sort((a, b) => (a.posicion ? 1 : 0) - (b.posicion ? 1 : 0) || b.actualizado_en.localeCompare(a.actualizado_en));
  return (
    <section className="bg-slate-900 border border-yellow-900/60 rounded-2xl p-4 flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-lg font-bold text-yellow-200">Área de seguimiento · Observaciones</h2>
        <p className="m-0 mt-1 text-xs text-slate-400">
          {resumen.enSeguimiento} lotes apartados (sin posición) · {registros.filter((r) => r.motivo && r.posicion).length} con observación dentro del layout. Mueve cada
          lote a su posición o marca la observación como resuelta.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip amarillo activo={filtroMotivo === "TODAS"} onClick={() => setFiltroMotivo("TODAS")}>
          Todas ({conObservacion.length})
        </Chip>
        {MOTIVOS.map((m) => (
          <Chip key={m} amarillo activo={filtroMotivo === m} onClick={() => setFiltroMotivo(m)}>
            {m} ({cuenta(m)})
          </Chip>
        ))}
      </div>
      {lista.length === 0 ? (
        <p className="m-0 text-sm text-slate-500">Sin lotes con esta observación.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {lista.map((r) => (
            <FilaRegistro
              key={r.id}
              r={r}
              soloLectura={soloLectura}
              onMover={() => acciones.mover(r)}
              onResolver={() => acciones.resolver(r)}
              onSeguimiento={() => acciones.seguimiento(r)}
              onEliminar={() => acciones.eliminar(r)}
              onUbicar={() => onUbicar(r)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ======================================================================
function Bultos({ sap, registros, zonaFiltro, resumen, soloLectura, onQuitarFueraDeSap, onUbicar }) {
  const [busqueda, setBusqueda] = useState("");
  const [fEstado, setFEstado] = useState("TODOS");
  const [fCalibre, setFCalibre] = useState("TODOS");
  const [limite, setLimite] = useState(POR_PAGINA);
  const porClave = useMemo(() => new Map(registros.map((r) => [r.clave, r])), [registros]);

  const filas = useMemo(() => {
    const deSap = sap.map((s) => ({ ...s, reg: porClave.get(s.clave) }));
    const sobrantes = registros.filter((r) => r.estado === "SOBRANTE").map((r) => ({ ...r, en_sap: false, sobrante: true, reg: r }));
    const q = busqueda.trim().toUpperCase();
    return [...sobrantes, ...deSap]
      .filter((f) => {
        const r = f.reg;
        if (fEstado === "FUERA") {
          if (f.en_sap || f.sobrante) return false;
        } else if (!f.en_sap && !f.sobrante && !r) return false;
        if (fEstado === "PENDIENTE" && r) return false;
        if (fEstado === "OK" && r?.estado !== "OK") return false;
        if (fEstado === "DIFERENCIA" && r?.estado !== "DIFERENCIA") return false;
        if (fEstado === "OBS" && !r?.motivo) return false;
        if (fEstado === "SOBRANTE" && !f.sobrante) return false;
        if (zonaFiltro !== "TODAS" && f.etapa !== zonaFiltro && !(f.sobrante && r?.zona === zonaFiltro)) return false;
        if (fCalibre !== "TODOS") {
          if (fCalibre === "ECO" ? !String(f.lote).startsWith("ECOTAP") : f.calibre !== fCalibre) return false;
        }
        if (q && !`${f.lote} ${f.material} ${f.texto_breve}`.toUpperCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => String(a.material).localeCompare(String(b.material)) || String(a.lote).localeCompare(String(b.lote)));
  }, [sap, registros, porClave, busqueda, fEstado, fCalibre, zonaFiltro]);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 font-bold text-white">
            Bultos <span className="text-slate-400 font-normal text-sm">({num(filas.length)})</span>
          </h2>
          {resumen.fueraDeSap > 0 && !soloLectura && (
            <button onClick={onQuitarFueraDeSap} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" /> Quitar {resumen.fueraDeSap} que ya no están en SAP
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setLimite(POR_PAGINA);
            }}
            placeholder="Buscar por bulto, material o descripción…"
            aria-label="Buscar bulto"
            className="flex-1 bg-transparent py-2.5 text-sm text-white outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["TODOS", "Todos"],
            ["PENDIENTE", "Pendientes"],
            ["OK", "Verificados"],
            ["DIFERENCIA", "Diferencias"],
            ["OBS", "Con observación"],
            ["SOBRANTE", "No en SAP"],
            ["FUERA", "Ya no en SAP"],
          ].map(([v, t]) => (
            <Chip key={v} activo={fEstado === v} onClick={() => setFEstado(v)}>
              {t}
            </Chip>
          ))}
          <span className="w-px h-6 bg-slate-700 mx-1" />
          {[
            ["TODOS", "Todo calibre"],
            ["70", "Cal. 70"],
            ["75", "Cal. 75"],
            ["ECO", "Ecotapa"],
            ["ALU", "Aluminio"],
          ].map(([v, t]) => (
            <Chip key={v} activo={fCalibre === v} onClick={() => setFCalibre(v)}>
              {t}
            </Chip>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 bg-slate-950/50">
              <th className="p-3">Bulto</th>
              <th className="p-3">Material / descripción</th>
              <th className="p-3">Proceso</th>
              <th className="p-3 text-right">SAP</th>
              <th className="p-3 text-right">Físico</th>
              <th className="p-3">Ubicación</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {filas.slice(0, limite).map((f) => {
              const r = f.reg;
              const dif = r?.cantidad_fisica == null || f.sobrante ? null : Number(r.cantidad_fisica) - Number(f.cantidad_sap);
              return (
                <tr key={f.clave} className={r?.motivo ? "bg-yellow-400/[.06]" : "hover:bg-slate-800/40"}>
                  <td className="p-3 font-mono font-bold text-white whitespace-nowrap">{f.lote}</td>
                  <td className="p-3">
                    <div className="text-slate-200">{f.sobrante ? "Escaneado en piso — no está en SAP" : f.texto_breve}</div>
                    <div className="text-xs text-slate-500">
                      {f.material}
                      {f.calibre && ` · ${f.calibre === "ALU" ? "Aluminio" : `Cal. ${f.calibre}`}`}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${ETAPAS[f.etapa]?.color ?? ETAPAS.OTRO.color}`}>{ETAPAS[f.etapa]?.nombre ?? "Otro"}</span>
                  </td>
                  <td className="p-3 text-right font-bold text-white whitespace-nowrap">{f.sobrante ? "—" : num(f.cantidad_sap)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {r?.cantidad_fisica == null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <>
                        <div className="font-bold text-white">{num(r.cantidad_fisica)}</div>
                        {dif !== null && dif !== 0 && (
                          <div className="text-[11px] text-amber-300">
                            {dif > 0 ? "+" : ""}
                            {num(dif)}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="p-3 text-xs whitespace-nowrap">
                    {r ? (
                      r.posicion ? (
                        <button onClick={() => onUbicar(r)} className="text-cyan-300 hover:text-cyan-200 underline cursor-pointer" title="Ver en el layout">
                          {textoUbicacion(r.zona, r.carril, r.posicion)}
                        </button>
                      ) : (
                        <span className="text-yellow-200">Área de seguimiento</span>
                      )
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="p-3">
                    <EstadoChip enSap={f.en_sap} r={r} />
                    {r?.usuario && (
                      <div className="text-[11px] text-slate-500 mt-1 whitespace-nowrap">
                        {r.usuario} · {hora(r.actualizado_en)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filas.length > limite && (
          <button onClick={() => setLimite(limite + POR_PAGINA)} className="w-full py-3 text-sm text-amber-300 hover:bg-slate-800 cursor-pointer">
            Mostrar {Math.min(POR_PAGINA, filas.length - limite)} más (de {num(filas.length - limite)} restantes)
          </button>
        )}
      </div>
    </section>
  );
}
