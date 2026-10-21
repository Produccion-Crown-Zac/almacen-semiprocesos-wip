// src/components/Tablero.jsx
// Vista de PC (dentro de Citrix): cargar el reporte de SAP y ver el avance del conteo.
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileUp, ClipboardPaste, Download, RotateCcw, Search, History, Trash2, Info } from "lucide-react";
import { ETAPAS, ESTADOS, num, hora, esPico } from "../lib/formato";

const POR_PAGINA = 200;

const Chip = ({ activo, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
      activo ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
    }`}
  >
    {children}
  </button>
);

export default function Tablero({
  bultos,
  movimientos,
  resumen,
  sincronizando,
  resultadoSync,
  onArchivo,
  onPegarBoton,
  onNuevoConteo,
  onQuitarFueraDeSap,
}) {
  const fileRef = useRef(null);
  const [busqueda, setBusqueda] = useState("");
  const [fEstado, setFEstado] = useState("TODOS");
  const [fEtapa, setFEtapa] = useState("TODAS");
  const [fCalibre, setFCalibre] = useState("TODOS");
  const [soloPicos, setSoloPicos] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);
  const [arrastrando, setArrastrando] = useState(false);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    return bultos
      .filter((b) => {
        if (fEstado === "FUERA") {
          if (b.en_sap || b.estado === "SOBRANTE") return false;
        } else {
          if (!b.en_sap && b.estado !== "SOBRANTE") return false;
          if (fEstado !== "TODOS" && b.estado !== fEstado) return false;
        }
        if (fEtapa !== "TODAS" && b.etapa !== fEtapa) return false;
        if (fCalibre !== "TODOS" && b.calibre !== fCalibre) return false;
        if (soloPicos && !esPico(b)) return false;
        if (q && !`${b.lote} ${b.material} ${b.texto_breve}`.toUpperCase().includes(q)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          (a.estado === "SOBRANTE" ? -1 : 0) - (b.estado === "SOBRANTE" ? -1 : 0) ||
          String(a.material).localeCompare(String(b.material)) ||
          String(a.lote).localeCompare(String(b.lote))
      );
  }, [bultos, busqueda, fEstado, fEtapa, fCalibre, soloPicos]);

  const exportar = () => {
    const filas = bultos.map((b) => ({
      Bulto: b.lote,
      Material: b.material,
      "Texto breve de material": b.texto_breve,
      Etapa: ETAPAS[b.etapa]?.nombre ?? b.etapa,
      Calibre: b.calibre,
      Almacén: b.almacen,
      "Cantidad SAP": Number(b.cantidad_sap),
      "Cantidad física": b.cantidad_fisica ?? "",
      Diferencia: b.cantidad_fisica == null ? "" : Number(b.cantidad_fisica) - Number(b.cantidad_sap),
      Estado: b.estado === "PENDIENTE" && !b.en_sap ? "YA NO ESTÁ EN SAP" : b.estado,
      "Verificado por": b.verificado_por ?? "",
      "Verificado en": b.verificado_en ? new Date(b.verificado_en).toLocaleString("es-MX") : "",
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [12, 10, 42, 11, 8, 8, 12, 14, 11, 16, 18, 20].map((w) => ({ wch: w }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Conteo");
    XLSX.writeFile(libro, `Conteo_bultos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const tarjetasEtapa = [
    ["VIRGEN", "Buffer 1 · Lámina virgen", "text-slate-300"],
    ["RECUBIERTA", "Buffer 2 · Recubierta", "text-blue-400"],
    ["IMPRESA", "Buffer 3 · Impresa", "text-emerald-400"],
  ];

  return (
    <div
      className="max-w-7xl mx-auto space-y-5 relative"
      onDragOver={(e) => {
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
        if (f) onArchivo(f);
      }}
    >
      {arrastrando && (
        <div className="absolute inset-0 z-40 rounded-2xl border-4 border-dashed border-amber-400 bg-slate-950/90 flex items-center justify-center text-xl font-bold text-amber-300 pointer-events-none">
          Suelta aquí el reporte de SAP
        </div>
      )}

      {/* Carga de SAP */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Inventario de semiprocesos · Conteo por bulto</h1>
          <p className="text-xs text-slate-400 mt-1">
            Copia la tabla del MB52 en SAP y presiona <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">Ctrl</kbd>+
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">V</kbd> en esta pantalla, o arrastra aquí el archivo exportado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <button
            onClick={onPegarBoton}
            disabled={sincronizando}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-3.5 py-2.5 rounded-lg text-xs cursor-pointer"
          >
            <ClipboardPaste className="w-4 h-4" /> Pegar desde SAP
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={sincronizando}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-3.5 py-2.5 rounded-lg text-xs cursor-pointer"
          >
            <FileUp className="w-4 h-4" /> Cargar archivo SAP
          </button>
          <button
            onClick={exportar}
            disabled={bultos.length === 0}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold px-3.5 py-2.5 rounded-lg text-xs cursor-pointer"
          >
            <Download className="w-4 h-4" /> Exportar conteo
          </button>
        </div>
      </section>

      {sincronizando && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-200 text-sm px-4 py-3">Leyendo reporte de SAP…</div>
      )}
      {resultadoSync && !sincronizando && (
        <div
          className={`rounded-xl text-sm px-4 py-3 border ${
            resultadoSync.error
              ? "bg-red-500/10 border-red-500/30 text-red-200"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
          }`}
        >
          {resultadoSync.error ? (
            <>✕ {resultadoSync.error}</>
          ) : (
            <>
              <strong>✓ {resultadoSync.origen}:</strong> {num(resultadoSync.total)} bultos leídos · {resultadoSync.creados} nuevos ·{" "}
              {resultadoSync.cambiosCantidad} con cantidad distinta a la carga anterior · {resultadoSync.yaNoEnSap} ya no vienen en SAP ·{" "}
              {resultadoSync.subtotalesIgnorados} filas de subtotal ignoradas
            </>
          )}
        </div>
      )}

      {/* Indicadores */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="col-span-2 bg-emerald-950/30 border border-emerald-700/50 rounded-xl p-4">
          <span className="text-xs font-semibold text-emerald-400 uppercase">Avance del conteo</span>
          <div className="text-3xl font-black text-emerald-300 mt-1">{resumen.avance}%</div>
          <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${resumen.avance}%` }} />
          </div>
          <p className="text-xs text-emerald-200/70 mt-2">
            {num(resumen.ok + resumen.diferencia)} de {num(resumen.total)} bultos · {num(resumen.laminas)} hojas en SAP
          </p>
        </div>
        {[
          ["OK", "Verificados", resumen.ok, "text-emerald-300"],
          ["DIFERENCIA", "Con diferencia", resumen.diferencia, "text-amber-300"],
          ["SOBRANTE", "No están en SAP", resumen.sobrante, "text-red-300"],
        ].map(([estado, titulo, valor, color]) => (
          <button
            key={estado}
            onClick={() => setFEstado(fEstado === estado ? "TODOS" : estado)}
            className={`text-left bg-slate-900 border rounded-xl p-4 cursor-pointer ${fEstado === estado ? "border-amber-400" : "border-slate-800"}`}
          >
            <span className="text-xs font-semibold text-slate-400 uppercase">{titulo}</span>
            <div className={`text-3xl font-black mt-1 ${color}`}>{num(valor)}</div>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tarjetasEtapa.map(([etapa, titulo, color]) => (
          <button
            key={etapa}
            onClick={() => setFEtapa(fEtapa === etapa ? "TODAS" : etapa)}
            className={`text-left bg-slate-900 border rounded-xl p-4 cursor-pointer ${fEtapa === etapa ? "border-amber-400" : "border-slate-800"}`}
          >
            <span className={`text-xs font-semibold uppercase ${color}`}>{titulo}</span>
            <div className="text-2xl font-bold text-white mt-1">
              {num(resumen.porEtapa[etapa].laminas)} <span className="text-sm font-normal text-slate-400">hojas</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {num(resumen.porEtapa[etapa].bultos)} bultos · {num(resumen.porEtapa[etapa].picos)} picos
            </p>
          </button>
        ))}
      </section>

      {/* Filtros */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setLimite(POR_PAGINA);
            }}
            placeholder="Buscar por bulto, material o descripción…"
            className="flex-1 bg-transparent py-2.5 text-sm text-white outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[["TODOS", "Todos"], ["PENDIENTE", "Pendientes"], ["OK", "Verificados"], ["DIFERENCIA", "Diferencias"], ["SOBRANTE", "No en SAP"], ["FUERA", "Ya no en SAP"]].map(
            ([v, t]) => (
              <Chip key={v} activo={fEstado === v} onClick={() => setFEstado(v)}>
                {t}
              </Chip>
            )
          )}
          <span className="w-px h-6 bg-slate-700 mx-1" />
          {[["TODOS", "Todo calibre"], ["70", "Cal. 70"], ["75", "Cal. 75"], ["ALU", "Aluminio"]].map(([v, t]) => (
            <Chip key={v} activo={fCalibre === v} onClick={() => setFCalibre(v)}>
              {t}
            </Chip>
          ))}
          <span className="w-px h-6 bg-slate-700 mx-1" />
          <Chip activo={soloPicos} onClick={() => setSoloPicos(!soloPicos)}>
            Solo picos (&lt; 1,500)
          </Chip>
        </div>
      </section>

      {/* Tabla */}
      <main className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
            <h2 className="font-bold text-white">
              Bultos <span className="text-slate-400 font-normal text-sm">({num(filtrados.length)})</span>
            </h2>
            <div className="flex gap-3">
              {resumen.fueraDeSap > 0 && (
                <button onClick={onQuitarFueraDeSap} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" /> Quitar {resumen.fueraDeSap} que ya no están en SAP
                </button>
              )}
              <button onClick={onNuevoConteo} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer">
                <RotateCcw className="w-3.5 h-3.5" /> Nuevo conteo
              </button>
            </div>
          </div>

          {bultos.length === 0 ? (
            <div className="p-10 text-center text-slate-400 space-y-2">
              <Info className="w-8 h-8 mx-auto text-slate-500" />
              <p className="font-semibold text-slate-200">Todavía no hay datos de SAP</p>
              <p className="text-sm">Ejecuta el MB52, copia la tabla y presiona Ctrl+V aquí, o carga el archivo exportado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 bg-slate-950/50">
                    <th className="p-3">Bulto</th>
                    <th className="p-3">Material / descripción</th>
                    <th className="p-3">Etapa</th>
                    <th className="p-3 text-right">SAP</th>
                    <th className="p-3 text-right">Físico</th>
                    <th className="p-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {filtrados.slice(0, limite).map((b) => {
                    const dif = b.cantidad_fisica == null ? null : Number(b.cantidad_fisica) - Number(b.cantidad_sap);
                    return (
                      <tr key={b.id} className="hover:bg-slate-800/40">
                        <td className="p-3 font-mono font-bold text-white whitespace-nowrap">{b.lote}</td>
                        <td className="p-3">
                          <div className="text-slate-200">{b.texto_breve}</div>
                          <div className="text-xs text-slate-500">
                            {b.material}
                            {b.calibre && ` · ${b.calibre === "ALU" ? "Aluminio" : `Cal. ${b.calibre}`}`}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${ETAPAS[b.etapa]?.color}`}>
                            {ETAPAS[b.etapa]?.nombre}
                          </span>
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="font-bold text-white">{num(b.cantidad_sap)}</div>
                          {esPico(b) && <div className="text-[11px] text-amber-400">● Pico</div>}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          {b.cantidad_fisica == null ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <>
                              <div className="font-bold text-white">{num(b.cantidad_fisica)}</div>
                              {dif !== 0 && (
                                <div className="text-[11px] text-amber-300">
                                  {dif > 0 ? "+" : ""}
                                  {num(dif)}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${ESTADOS[b.estado]?.color}`}>
                            {!b.en_sap && b.estado !== "SOBRANTE" ? "Ya no en SAP" : ESTADOS[b.estado]?.nombre}
                          </span>
                          {b.verificado_por && (
                            <div className="text-[11px] text-slate-500 mt-1 whitespace-nowrap">
                              {b.verificado_por} · {hora(b.verificado_en)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtrados.length > limite && (
                <button
                  onClick={() => setLimite(limite + POR_PAGINA)}
                  className="w-full py-3 text-sm text-amber-300 hover:bg-slate-800 cursor-pointer"
                >
                  Mostrar {Math.min(POR_PAGINA, filtrados.length - limite)} más (de {num(filtrados.length - limite)} restantes)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bitácora */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="font-bold text-white flex items-center gap-2 mb-3">
            <History className="w-5 h-5 text-amber-400" /> Bitácora
          </h2>
          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {movimientos.length === 0 && <p className="text-xs text-slate-500">Sin movimientos todavía.</p>}
            {movimientos.map((m) => (
              <div key={m.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <div className="flex items-center justify-between font-bold text-amber-400 gap-2">
                  <span className="font-mono truncate">{m.lote}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{hora(m.creado_en)}</span>
                </div>
                <div className="font-semibold text-slate-200 mt-0.5">{m.accion}</div>
                <p className="text-slate-400 mt-0.5">{m.detalle}</p>
                {m.usuario && <p className="text-slate-500 mt-0.5">— {m.usuario}</p>}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
