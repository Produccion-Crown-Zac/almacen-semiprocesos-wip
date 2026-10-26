// src/components/Inventario.jsx
// Aplicación ya con sesión iniciada: el reporte de SAP (MB52) da la lista de bultos;
// desde el celular se registra cada bulto en su zona / carril / posición.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Smartphone, Users, LogOut, KeyRound, UserCircle2 } from "lucide-react";
import { Sap, Conteo, Registro, Movimiento, Ajustes, suscribir } from "../api/entities";
import { leerArchivoSap, leerTextoSap } from "../lib/sapParser";
import { calcularResumen, num } from "../lib/formato";
import { ZONAS, ORDEN_ZONAS } from "../lib/croquis";
import Tablero from "./Tablero";
import Escaner from "./Escaner";
import Usuarios, { CambiarPassword } from "./Usuarios";

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

export default function Inventario({ usuario, onCerrarSesion }) {
  const esAdmin = usuario.rol === "ADMIN";
  const [vista, setVista] = useState(() => {
    const v = leerLocal("wip_vista", esCelular() ? "ESCANER" : "TABLERO");
    return v === "USUARIOS" && usuario.rol !== "ADMIN" ? "TABLERO" : v;
  });
  const [meta, setMeta] = useState(95);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiarPass, setCambiarPass] = useState(false);
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
  const [registrosCerrados, setRegistrosCerrados] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [resultadoSync, setResultadoSync] = useState(null);
  const auditor = usuario.nombre;
  const cambiarVista = (v) => {
    setVista(v);
    vistaRef.current = v;
    guardarLocal("wip_vista", v);
    if (v !== "USUARIOS") cargar({ sap: false });
  };

  const vistoRef = useRef(null);
  useEffect(() => {
    vistoRef.current = conteoVistoId;
  }, [conteoVistoId]);

  // Carga por partes para leer lo mínimo de la base de datos:
  //  - SAP y ajustes: solo al inicio o cuando alguien carga un reporte nuevo / cambia la meta.
  //  - Historial de conteos cerrados: una sola vez y cuando se cierra un conteo (ya no cambian).
  //  - Conteo en curso: en cada cambio. Bitácora y conteo consultado: solo en el tablero.
  const vistaRef = useRef(vista);
  useEffect(() => {
    vistaRef.current = vista;
  }, [vista]);
  const cerradosRef = useRef(null); // ids de conteos cerrados ya leídos

  const cargar = useCallback(async ({ sap: conSap = true } = {}) => {
    try {
      const enTablero = vistaRef.current !== "ESCANER";
      const actual = await Conteo.actual();
      const [s, aj, cs, ra] = await Promise.all([
        conSap ? Sap.list() : null,
        conSap ? Ajustes.leer() : null,
        Conteo.list(),
        Registro.list(actual.id),
      ]);
      const idsCerrados = cs.filter((c) => c.estado === "CERRADO").map((c) => c.id).join(",");
      let cerrados = null;
      if (enTablero && cerradosRef.current !== idsCerrados) {
        cerrados = await Registro.cerrados();
        cerradosRef.current = idsCerrados;
      }
      const vistoId = vistoRef.current && cs.some((c) => c.id === vistoRef.current) ? vistoRef.current : actual.id;
      const [rv, mv] = enTablero
        ? await Promise.all([vistoId === actual.id ? ra : Registro.list(vistoId), Movimiento.list(vistoId)])
        : [ra, null];
      if (s) setSap(s);
      if (aj) setMeta(aj.meta_exactitud);
      if (cerrados) setRegistrosCerrados(cerrados);
      if (mv) setMovimientos(mv);
      setConteos(cs);
      setConteoActual(actual);
      setConteoVistoId(vistoId);
      setRegistrosActual(ra);
      setRegistrosVisto(rv);
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

  // Historial completo = conteos cerrados (leídos una vez) + conteo en curso (siempre al día)
  const registrosTodos = useMemo(() => [...registrosCerrados, ...registrosActual], [registrosCerrados, registrosActual]);
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
    const c = await Conteo.nuevo();
    await Movimiento.create({ conteo_id: c.id, lote: "CONTEO", accion: "NUEVO CONTEO", detalle: "Se abrió un conteo nuevo; el anterior quedó guardado" });
    vistoRef.current = c.id;
    setConteoVistoId(c.id);
    cargar();
  };

  const onQuitarFueraDeSap = async () => {
    if (!window.confirm(`¿Quitar ${resumenVisto.fueraDeSap} bultos que ya no vienen en el reporte de SAP?`)) return;
    await Sap.quitarFueraDeSap();
    cargar();
  };

  const onCambiarMeta = async (valor) => {
    const r = await Ajustes.guardar({ meta_exactitud: valor });
    setMeta(r.meta_exactitud);
    await Movimiento.create({ conteo_id: conteoActual?.id ?? null, lote: "AJUSTE", accion: "META DE EXACTITUD", detalle: `Nueva meta: ${r.meta_exactitud}%` });
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
          className={`grid ${vista === "ESCANER" ? "grid-cols-3 sm:min-w-[460px]" : esAdmin ? "grid-cols-3 sm:min-w-[440px]" : "grid-cols-2 sm:min-w-[300px]"} gap-1.5 bg-slate-900 border border-slate-800 rounded-2xl p-1.5 w-full sm:w-auto`}
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
          {vista !== "ESCANER" && esAdmin && (
            <button
              onClick={() => cambiarVista("USUARIOS")}
              className={`h-11 flex items-center justify-center gap-2 px-3 rounded-xl text-[13px] font-bold cursor-pointer ${
                vista === "USUARIOS" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Users className="w-4 h-4" /> Usuarios
            </button>
          )}
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
        <div className="relative">
          <button
            onClick={() => setMenuAbierto(!menuAbierto)}
            aria-expanded={menuAbierto}
            className="flex items-center gap-2 h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 cursor-pointer"
          >
            <UserCircle2 className="w-5 h-5 text-slate-300" />
            <span className="text-left leading-tight">
              <span className="block text-[13px] font-bold text-white">{usuario.nombre}</span>
              <span className="block text-[11px] text-slate-400">{esAdmin ? "Administrador" : "Usuario"}</span>
            </span>
          </button>
          {menuAbierto && (
            <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1">
              <button
                onClick={() => {
                  setMenuAbierto(false);
                  setCambiarPass(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <KeyRound className="w-4 h-4" /> Cambiar mi contraseña
              </button>
              <button onClick={onCerrarSesion} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-red-300 hover:bg-red-500/10 cursor-pointer">
                <LogOut className="w-4 h-4" /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </nav>

      {errorCarga && (
        <div className="max-w-[1720px] mx-auto mb-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm px-4 py-3">{errorCarga}</div>
      )}

      {cambiarPass && <CambiarPassword onCerrar={() => setCambiarPass(false)} />}

      {vista === "USUARIOS" && esAdmin ? (
        <Usuarios yo={usuario} />
      ) : cargando || !conteoActual ? (
        <p className="text-center text-slate-400 py-20">Cargando inventario…</p>
      ) : vista === "ESCANER" ? (
        <>
          {sap.length === 0 && (
            <div className="max-w-lg mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm px-4 py-3">
              Todavía no se ha cargado el reporte de SAP. Cárgalo desde <strong>Tablero → Pegar desde SAP</strong> o <strong>Cargar archivo SAP</strong>.
            </div>
          )}
          <Escaner
            sap={sap}
            registros={registrosActual}
            conteo={conteoActual}
            zona={zonaEscaner}
            auditor={auditor}
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
          meta={meta}
          onCambiarMeta={onCambiarMeta}
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
