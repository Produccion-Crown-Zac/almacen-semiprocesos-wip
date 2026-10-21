// src/App.jsx
// Inventario WIP: el reporte de SAP (MB52) alimenta la lista de bultos y
// desde el celular se escanea cada bulto para darle check.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Smartphone, Database, HardDrive } from "lucide-react";
import { Bulto, Movimiento, MODO_DATOS } from "./api/entities";
import { leerArchivoSap, leerTextoSap } from "./lib/sapParser";
import { calcularResumen, num } from "./lib/formato";
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
  const [bultos, setBultos] = useState([]);
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

  const cargar = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([Bulto.list(), Movimiento.list()]);
      setBultos(b);
      setMovimientos(m);
      setErrorCarga("");
    } catch (e) {
      setErrorCarga("No se pudo conectar con la base de datos: " + e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(cargar);
    return Bulto.suscribir(cargar); // cambios desde otros dispositivos
  }, [cargar]);

  const resumen = useMemo(() => calcularResumen(bultos), [bultos]);
  const bultosRef = useRef(bultos);
  useEffect(() => {
    bultosRef.current = bultos;
  }, [bultos]);

  // ---------- Sincronización con SAP ----------
  const sincronizar = useCallback(
    async (obtenerReporte, origen) => {
      setSincronizando(true);
      setResultadoSync(null);
      try {
        const reporte = await obtenerReporte();
        if (reporte.filas.length === 0) throw new Error("El reporte no trae ningún bulto con lote.");

        // Protección: si la carga trae muchos menos bultos que los actuales,
        // probablemente se copió solo una parte de la tabla.
        const clavesNuevas = new Set(reporte.filas.map((f) => f.clave));
        const enSapActuales = bultosRef.current.filter((b) => b.en_sap);
        const faltantes = enSapActuales.filter((b) => !clavesNuevas.has(b.clave)).length;
        let marcarFaltantes = true;
        if (faltantes > 0 && faltantes > enSapActuales.length * 0.2) {
          marcarFaltantes = window.confirm(
            `Esta carga trae ${num(reporte.filas.length)} bultos, pero faltan ${num(faltantes)} que sí estaban en la carga anterior.\n\n` +
              `• ACEPTAR: es el reporte completo → marcar esos ${num(faltantes)} como "ya no en SAP".\n` +
              `• CANCELAR: es solo una parte → actualizar únicamente los bultos que vienen.`
          );
        }
        const r = await Bulto.sincronizarSap(reporte.filas, { marcarFaltantes });
        await Movimiento.create({
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

  // Ctrl+V en cualquier parte del tablero (no requiere permisos del navegador)
  useEffect(() => {
    if (vista !== "TABLERO") return;
    const alPegar = (e) => {
      const destino = e.target;
      if (destino instanceof HTMLElement && destino.closest("input, textarea, [contenteditable]")) return;
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
      setResultadoSync({
        error: "El navegador no permitió leer el portapapeles con el botón. Presiona Ctrl+V en esta pantalla, funciona igual.",
      });
      return;
    }
    if (!texto.trim()) {
      setResultadoSync({ error: "El portapapeles está vacío. Copia primero la tabla en SAP." });
      return;
    }
    sincronizar(async () => leerTextoSap(texto), "Pegado desde SAP");
  };

  const onNuevoConteo = async () => {
    if (!window.confirm("¿Iniciar un conteo nuevo? Todos los bultos vuelven a PENDIENTE y se borran los sobrantes registrados.")) return;
    await Bulto.reiniciarConteo();
    await Movimiento.create({ lote: "CONTEO", accion: "NUEVO CONTEO", detalle: "Se reiniciaron todos los checks", usuario: auditor || null });
    cargar();
  };

  const onQuitarFueraDeSap = async () => {
    if (!window.confirm(`¿Quitar ${resumen.fueraDeSap} bultos que ya no vienen en el reporte de SAP?`)) return;
    await Bulto.eliminarFueraDeSap();
    cargar();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-3 md:p-6 font-sans">
      <nav className="max-w-7xl mx-auto mb-4 flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 p-2 rounded-xl">
        <div className="flex gap-1.5">
          <button
            onClick={() => cambiarVista("TABLERO")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              vista === "TABLERO" ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Monitor className="w-4 h-4" /> Tablero
          </button>
          <button
            onClick={() => cambiarVista("ESCANER")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer ${
              vista === "ESCANER" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Smartphone className="w-4 h-4" /> Escáner
          </button>
        </div>
        <span
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full ${
            MODO_DATOS === "SUPABASE" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"
          }`}
          title={
            MODO_DATOS === "SUPABASE"
              ? "Los datos se comparten entre todos los dispositivos"
              : "Modo demo: los datos solo existen en este navegador"
          }
        >
          {MODO_DATOS === "SUPABASE" ? <Database className="w-3.5 h-3.5" /> : <HardDrive className="w-3.5 h-3.5" />}
          {MODO_DATOS === "SUPABASE" ? "Datos compartidos" : "Modo demo (solo este navegador)"}
        </span>
      </nav>

      {errorCarga && (
        <div className="max-w-7xl mx-auto mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm px-4 py-3">{errorCarga}</div>
      )}

      {cargando ? (
        <p className="text-center text-slate-400 py-20">Cargando inventario…</p>
      ) : vista === "ESCANER" ? (
        <Escaner bultos={bultos} auditor={auditor} setAuditor={setAuditor} resumen={resumen} onCambio={cargar} />
      ) : (
        <Tablero
          bultos={bultos}
          movimientos={movimientos}
          resumen={resumen}
          sincronizando={sincronizando}
          resultadoSync={resultadoSync}
          onArchivo={onArchivo}
          onPegarBoton={onPegarBoton}
          onNuevoConteo={onNuevoConteo}
          onQuitarFueraDeSap={onQuitarFueraDeSap}
        />
      )}
    </div>
  );
}
