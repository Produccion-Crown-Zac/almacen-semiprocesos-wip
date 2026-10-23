// src/App.jsx
// Inventario WIP con layout: el reporte de SAP (MB52) da la lista de bultos;
// desde el celular se registra cada bulto en su zona / carril / posición.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Smartphone, HardDrive } from "lucide-react";
import { Sap, Conteo, Registro, Movimiento, suscribir } from "./api/entities";
import { leerArchivoSap, leerTextoSap } from "./lib/sapParser";
import { calcularResumen, num } from "./lib/formato";
import { ZONAS, ORDEN_ZONAS } from "./lib/croquis";
import Tablero from "./components/Tablero";
import Escaner from "./components/Escaner";

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

const esCelular = () => window.matchMedia?.("(max-width: 767px)").matches;

export default function App() {
  const [vista, setVista] = useState(() => leerLocal("wip_vista", esCelular() ? "ESCANER" : "TABLERO"));
  const [zonaEscaner, setZonaEscaner] = useState(() => {
    const z = leerLocal("wip_zona_escaner", "VIRGEN");
    return ZONAS[z] ? z : "VIRGEN";
  });
  const [sap, setSap] = useState([]);
  const [conteos, setConteos] = useState([]);
  const [conteoActual, setConteoActual] = useState(null);
  const [conteoVistoId, setConteoVistoId] = useState(null);
  const [registrosActual, setRegistrosActual] = useState([]);
  const [registrosVisto, setRegistrosVisto] = useState([]);
  const [registrosTodos, setRegistrosTodos] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState(null);
  const [auditor, setAuditorEstado] = useState(() => leerLocal("wip_auditor", ""));

  const setAuditor = (v) => {
    setAuditorEstado(v);
    guardarLocal("wip_auditor", v);
  };
  const cambiarVista = (v) => {
    setVista(v);
    guardarLocal("wip_vista", v);
  };

  const vistoRef = useRef(null);
  useEffect(() => {
    vistoRef.current = conteoVistoId;
  }, [conteoVistoId]);

  const cargar = useCallback(async () => {
    try {
      const actual = await Conteo.actual();
      const [s, cs, ra, todos] = await Promise.all([Sap.list(), Conteo.list(), Registro.list(actual.id), Registro.todos()]);
      const vistoId = vistoRef.current && cs.some((c) => c.id === vistoRef.current) ? vistoRef.current : actual.id;
      const [rv, mv] = await Promise.all([vistoId === actual.id ? ra : Registro.list(vistoId), Movimiento.list(vistoId)]);
      setSap(s);
      setConteos(cs);
      setConteoActual(actual);
      setConteoVistoId(vistoId);
      setRegistrosActual(ra);
      setRegistrosVisto(rv);
      setRegistrosTodos(todos);
      setMovimientos(mv);
      setErrorCarga("");
    } catch (e) {
      setErrorCarga("No se pudieron leer los datos: " + e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(cargar);
    return suscribir(cargar);
  }, [cargar]);

  const verConteo = (id) => {
    vistoRef.current = id;
    setConteoVistoId(id);
    cargar();
  };

  const conteoVisto = conteos.find((c) => c.id === conteoVistoId) ?? conteoActual;
  const resumenVisto = useMemo(() => calcularResumen(sap, registrosVisto, conteoVisto), [sap, registrosVisto, conteoVisto]);
  const resumenActual = useMemo(() => calcularResumen(sap, registrosActual, conteoActual), [sap, registrosActual, conteoActual]);

  // ---------- Sincronización con SAP ----------
  const sapRef = useRef(sap);
  useEffect(() => {
    sapRef.current = sap;
  }, [sap]);

  const sincronizar = useCallback(
    async (obtenerReporte, origen) => {
      setSincronizando(true);
      setResultadoSync(null);
      try {
        const reporte = await obtenerReporte();
        if (reporte.filas.length === 0) throw new Error("El reporte no trae ningún bulto con lote.");
        const nuevas = new Set(reporte.filas.map((f) => f.clave));
        const actuales = sapRef.current.filter((s) => s.en_sap);
        const faltantes = actuales.filter((s) => !nuevas.has(s.clave)).length;
        let marcarFaltantes = true;
        if (faltantes > 0 && faltantes > actuales.length * 0.2) {
          marcarFaltantes = window.confirm(
            `Esta carga trae ${num(reporte.filas.length)} bultos, pero faltan ${num(faltantes)} que sí estaban en la carga anterior.\n\n` +
              `• ACEPTAR: es el reporte completo → marcar esos ${num(faltantes)} como "ya no en SAP".\n` +
              `• CANCELAR: es solo una parte → actualizar únicamente los bultos que vienen.`
          );
        }
        const r = await Sap.sincronizar(reporte.filas, { marcarFaltantes });
        const actual = await Conteo.actual();
        await Movimiento.create({
          conteo_id: actual.id,
          lote: "SAP",
          accion: "CARGA DE REPORTE SAP",
          detalle: `${origen}: ${num(r.total)} bultos · ${r.creados} nuevos · ${r.cambiosCantidad} con cambio de cantidad · ${r.yaNoEnSap} ya no vienen`,
          usuario: leerLocal("wip_auditor", "") || null,
        });
        setResultadoSync({ ...r, origen, subtotalesIgnorados: reporte.subtotalesIgnorados });
        await cargar();
      } catch (e) {
        setResultadoSync({ error: e.message });
      } finally {
        setSincronizando(false);
      }
    },
    [cargar]
  );

  const onArchivo = (archivo) => sincronizar(() => leerArchivoSap(archivo), `Archivo ${archivo.name}`);

  // Ctrl+V en cualquier parte del tablero
  useEffect(() => {
    if (vista !== "TABLERO") return;
    const alPegar = (e) => {
      const destino = e.target;
      if (destino instanceof HTMLElement && destino.closest("input, textarea, select, [contenteditable]")) return;
      const texto = e.clipboardData?.getData("text/plain") ?? "";
      const html = e.clipboardData?.getData("text/html") ?? "";
      if (!texto.trim() && !html.trim()) return;
      e.preventDefault();
      sincronizar(async () => {
        try {
          return leerTextoSap(texto);
        } catch (err) {
          if (html) return leerTextoSap(html);
          throw err;
        }
      }, "Pegado desde SAP");
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [vista, sincronizar]);

  const onPegarBoton = async () => {
    let texto = "";
    try {
      texto = await navigator.clipboard.readText();
    } catch {
      setResultadoSync({ error: "El navegador no permitió leer el portapapeles con el botón. Presiona Ctrl+V en esta pantalla, funciona igual." });
      return;
    }
    if (!texto.trim()) {
      setResultadoSync({ error: "El portapapeles está vacío. Copia primero la tabla en SAP." });
      return;
    }
    sincronizar(async () => leerTextoSap(texto), "Pegado desde SAP");
  };

  const onNuevoConteo = async () => {
    if (
      !window.confirm(
        "¿Iniciar un conteo nuevo?\n\nEl conteo actual se cierra y se guarda para consultarlo después. El layout empieza vacío."
      )
    )
      return;
    const c = await Conteo.nuevo(auditor);
    await Movimiento.create({ conteo_id: c.id, lote: "CONTEO", accion: "NUEVO CONTEO", detalle: "Se abrió un conteo nuevo; el anterior quedó guardado", usuario: auditor || null });
    vistoRef.current = c.id;
    setConteoVistoId(c.id);
    cargar();
  };

  const onQuitarFueraDeSap = async () => {
    if (!window.confirm(`¿Quitar ${resumenVisto.fueraDeSap} bultos que ya no vienen en el reporte de SAP?`)) return;
    await Sap.quitarFueraDeSap();
    cargar();
  };

  // Selector de zona del escáner (recuadro junto a Tablero / Escáner).
  // En el tablero el filtro "Tipo de lámina" vive junto a los demás filtros.
  const colorZona = ZONAS[zonaEscaner];
  const cambiarZona = (z) => {
    setZonaEscaner(z);
    guardarLocal("wip_zona_escaner", z);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-3 md:p-6 font-sans">
      <nav className="max-w-[1720px] mx-auto mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className={`grid ${vista === "ESCANER" ? "grid-cols-3 sm:min-w-[460px]" : "grid-cols-2 sm:min-w-[300px]"} gap-1.5 bg-slate-900 border border-slate-800 rounded-2xl p-1.5 w-full sm:w-auto`}
        >
          <button
            onClick={() => cambiarVista("TABLERO")}
            className={`h-11 flex items-center justify-center gap-2 px-3 rounded-xl text-[13px] font-bold cursor-pointer ${
              vista === "TABLERO" ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Monitor className="w-4 h-4" /> Tablero
          </button>
          <button
            onClick={() => cambiarVista("ESCANER")}
            className={`h-11 flex items-center justify-center gap-2 px-3 rounded-xl text-[13px] font-bold cursor-pointer ${
              vista === "ESCANER" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Smartphone className="w-4 h-4" /> Escáner
          </button>
          {vista === "ESCANER" && (
          <select
            aria-label="Zona"
            value={zonaEscaner}
            onChange={(e) => cambiarZona(e.target.value)}
            className="h-11 rounded-xl px-2 text-[13px] font-bold text-center cursor-pointer outline-none"
            style={
              colorZona
                ? { background: `${colorZona.color}26`, border: `1px solid ${colorZona.color}`, color: colorZona.texto }
                : { background: "#020617", border: "1px solid #475569", color: "#e2e8f0" }
            }
          >
            {ORDEN_ZONAS.map((z) => (
              <option key={z} value={z} className="bg-slate-900 text-white">
                {ZONAS[z].nombre}
              </option>
            ))}
          </select>
          )}
        </div>
        <span
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300"
          title="Modo de prueba: los datos solo existen en este navegador"
        >
          <HardDrive className="w-3.5 h-3.5" /> Modo demo (solo este navegador)
        </span>
      </nav>

      {errorCarga && (
        <div className="max-w-[1720px] mx-auto mb-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm px-4 py-3">{errorCarga}</div>
      )}

      {cargando || !conteoActual ? (
        <p className="text-center text-slate-400 py-20">Cargando inventario…</p>
      ) : vista === "ESCANER" ? (
        <>
          {sap.length === 0 && (
            <div className="max-w-lg mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm px-4 py-3">
              Este navegador todavía no tiene el reporte de SAP. Ve a <strong>Tablero → Cargar archivo SAP</strong> y selecciona el archivo del MB52.
            </div>
          )}
          <Escaner
            sap={sap}
            registros={registrosActual}
            conteo={conteoActual}
            zona={zonaEscaner}
            auditor={auditor}
            setAuditor={setAuditor}
            resumen={resumenActual}
            onCambio={cargar}
          />
        </>
      ) : (
        <Tablero
          sap={sap}
          registros={registrosVisto}
          registrosTodos={registrosTodos}
          movimientos={movimientos}
          conteos={conteos}
          conteoVisto={conteoVisto}
          conteoActual={conteoActual}
          onVerConteo={verConteo}
          resumen={resumenVisto}
          sincronizando={sincronizando}
          resultadoSync={resultadoSync}
          auditor={auditor}
          onArchivo={onArchivo}
          onPegarBoton={onPegarBoton}
          onNuevoConteo={onNuevoConteo}
          onQuitarFueraDeSap={onQuitarFueraDeSap}
          onCambio={cargar}
        />
      )}
    </div>
  );
}
