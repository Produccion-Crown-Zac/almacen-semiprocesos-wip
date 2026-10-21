// src/components/Escaner.jsx
// Vista de celular: escanear el código de barras del BULTO y darle check.
import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraOff, Search, Check, AlertTriangle, PackageX, Ruler, User } from "lucide-react";
import { Bulto, Movimiento } from "../api/entities";
import { ETAPAS, ESTADOS, num, hora, esPico, limpiarCodigo } from "../lib/formato";

const ID_LECTOR = "lector-camara-wip";

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

export default function Escaner({ bultos, auditor, setAuditor, resumen, onCambio }) {
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [errorCamara, setErrorCamara] = useState("");
  const [codigo, setCodigo] = useState("");
  const [coincidencias, setCoincidencias] = useState(null); // null = nada buscado
  const [seleccionado, setSeleccionado] = useState(null);
  const [conteo, setConteo] = useState("");
  const [alturaMm, setAlturaMm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [continuo, setContinuo] = useState(() => leerLocal("wip_modo_continuo", "1") === "1");
  const [espesores, setEspesores] = useState(() => ({
    70: Number(leerLocal("wip_espesor_70", "0.25")),
    75: Number(leerLocal("wip_espesor_75", "0.28")),
  }));
  const lectorRef = useRef(null);
  const inputRef = useRef(null);
  const bultosRef = useRef(bultos);
  useEffect(() => {
    bultosRef.current = bultos;
  }, [bultos]);

  const buscar = (texto) => {
    const limpio = limpiarCodigo(texto);
    if (!limpio) return;
    setCodigo(limpio);
    const encontrados = bultosRef.current.filter((b) => b.lote === limpio);
    setCoincidencias(encontrados);
    setAlturaMm("");
    if (encontrados.length === 1) elegir(encontrados[0]);
    else {
      setSeleccionado(null);
      setConteo("");
    }
  };

  const elegir = (b) => {
    setSeleccionado(b);
    setConteo(String(b.estado === "PENDIENTE" ? b.cantidad_sap : b.cantidad_fisica ?? b.cantidad_sap));
  };

  // ---------- Cámara ----------
  useEffect(() => {
    if (!camaraActiva) return;
    let cancelado = false;
    const lector = new Html5Qrcode(ID_LECTOR, {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    lectorRef.current = lector;
    lector
      .start(
        { facingMode: "environment" },
        {
          fps: 12,
          // Ventana ancha y baja: ideal para códigos de barras lineales
          qrbox: (ancho, alto) => ({
            width: Math.floor(Math.min(ancho * 0.9, 420)),
            height: Math.floor(Math.min(alto * 0.45, 160)),
          }),
        },
        (texto) => {
          if (cancelado) return;
          cancelado = true;
          try {
            navigator.vibrate?.(120);
          } catch {
            /* sin vibración */
          }
          setCamaraActiva(false);
          buscar(texto);
        },
        () => {}
      )
      .catch((err) => {
        setErrorCamara(
          String(err).includes("NotAllowed")
            ? "Permiso de cámara denegado. Actívalo en la configuración del navegador para este sitio."
            : "No se pudo abrir la cámara: " + String(err)
        );
        setCamaraActiva(false);
      });

    return () => {
      cancelado = true;
      if (lector.isScanning) lector.stop().then(() => lector.clear()).catch(() => {});
      else
        try {
          lector.clear();
        } catch {
          /* ya limpio */
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camaraActiva]);

  // ---------- Calculadora por altura ----------
  const calibreSel = seleccionado?.calibre === "75" ? 75 : 70;
  const calcularPorAltura = (mm) => {
    setAlturaMm(mm);
    const v = Number(mm);
    if (v > 0) setConteo(String(Math.round(v / espesores[calibreSel])));
  };
  const cambiarEspesor = (cal, valor) => {
    setEspesores((e) => ({ ...e, [cal]: Number(valor) }));
    guardarLocal(`wip_espesor_${cal}`, valor);
  };

  // ---------- Guardar ----------
  const terminar = (mensaje, tipo = "ok") => {
    setAviso({ mensaje, tipo });
    setTimeout(() => setAviso(null), 3500);
    setSeleccionado(null);
    setCoincidencias(null);
    setCodigo("");
    setConteo("");
    setAlturaMm("");
    onCambio();
    if (continuo) setCamaraActiva(true);
    else inputRef.current?.focus();
  };

  const confirmar = async () => {
    if (!seleccionado || !auditor.trim()) return;
    const fisica = Number(conteo);
    if (Number.isNaN(fisica) || conteo === "") return;
    setGuardando(true);
    try {
      const coincide = fisica === Number(seleccionado.cantidad_sap);
      await Bulto.registrarConteo(seleccionado.id, {
        estado: coincide ? "OK" : "DIFERENCIA",
        cantidad_fisica: fisica,
        verificado_por: auditor.trim(),
        verificado_en: new Date().toISOString(),
      });
      await Movimiento.create({
        lote: seleccionado.lote,
        accion: coincide ? "CHECK OK" : "DIFERENCIA",
        detalle: coincide
          ? `${num(fisica)} pzas · ${seleccionado.texto_breve}`
          : `SAP ${num(seleccionado.cantidad_sap)} vs físico ${num(fisica)} (${fisica - seleccionado.cantidad_sap > 0 ? "+" : ""}${num(fisica - seleccionado.cantidad_sap)}) · ${seleccionado.texto_breve}`,
        usuario: auditor.trim(),
      });
      terminar(
        coincide ? `✓ Bulto ${seleccionado.lote} verificado` : `⚠ Bulto ${seleccionado.lote}: diferencia registrada`,
        coincide ? "ok" : "warn"
      );
    } catch (e) {
      setAviso({ mensaje: "Error al guardar: " + e.message, tipo: "error" });
    } finally {
      setGuardando(false);
    }
  };

  const registrarSobrante = async () => {
    if (!auditor.trim()) return;
    const fisica = Number(conteo) || 0;
    setGuardando(true);
    try {
      await Bulto.registrarSobrante({ lote: codigo, cantidad_fisica: fisica, verificado_por: auditor.trim() });
      await Movimiento.create({
        lote: codigo,
        accion: "SOBRANTE (NO EN SAP)",
        detalle: `Escaneado en piso con ${num(fisica)} pzas y no viene en el reporte`,
        usuario: auditor.trim(),
      });
      terminar(`✚ Bulto ${codigo} registrado como sobrante`, "warn");
    } catch (e) {
      setAviso({ mensaje: "Error al guardar: " + e.message, tipo: "error" });
    } finally {
      setGuardando(false);
    }
  };

  const fisica = Number(conteo);
  const diferencia = seleccionado && conteo !== "" ? fisica - Number(seleccionado.cantidad_sap) : 0;
  const recientes = bultos
    .filter((b) => b.verificado_en)
    .sort((a, b) => b.verificado_en.localeCompare(a.verificado_en))
    .slice(0, 12);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Avance */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase text-emerald-400">Conteo físico</span>
            <div className="text-2xl font-black text-white">
              {num(resumen.ok + resumen.diferencia)} <span className="text-sm font-normal text-slate-400">de {num(resumen.total)} bultos</span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div className="text-amber-300">{resumen.diferencia} con diferencia</div>
            <div className="text-red-300">{resumen.sobrante} no están en SAP</div>
          </div>
        </div>
        <div className="mt-3 h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${resumen.avance}%` }} />
        </div>
      </div>

      {/* Nombre del auditor */}
      <label className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5">
        <User className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={auditor}
          onChange={(e) => setAuditor(e.target.value)}
          placeholder="Tu nombre o número de empleado"
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
      </label>

      {/* Escaneo */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <button
          onClick={() => {
            setErrorCamara("");
            setCamaraActiva((v) => !v);
          }}
          className={`w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-base transition cursor-pointer ${
            camaraActiva ? "bg-slate-700 text-white" : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
          }`}
        >
          {camaraActiva ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
          {camaraActiva ? "Cerrar cámara" : "Escanear bulto"}
        </button>

        {camaraActiva && <div id={ID_LECTOR} className="overflow-hidden rounded-xl bg-black min-h-[220px]" />}
        {errorCamara && <p className="text-xs text-red-300">{errorCamara}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar(codigo);
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            inputMode="numeric"
            placeholder="Número de bulto (ej. 6009491901)"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-base text-white font-mono uppercase"
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 rounded-xl cursor-pointer" aria-label="Buscar">
            <Search className="w-5 h-5" />
          </button>
        </form>

        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={continuo}
            onChange={(e) => {
              setContinuo(e.target.checked);
              guardarLocal("wip_modo_continuo", e.target.checked ? "1" : "0");
            }}
          />
          Abrir la cámara otra vez al confirmar (escaneo continuo)
        </label>
      </div>

      {aviso && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-bold ${
            aviso.tipo === "ok"
              ? "bg-emerald-500 text-slate-950"
              : aviso.tipo === "warn"
              ? "bg-amber-400 text-slate-950"
              : "bg-red-500 text-white"
          }`}
        >
          {aviso.mensaje}
        </div>
      )}

      {/* No encontrado */}
      {coincidencias && coincidencias.length === 0 && (
        <div className="bg-slate-900 border-2 border-red-500/60 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <PackageX className="w-10 h-10 text-red-400 shrink-0" />
            <div>
              <h3 className="text-lg font-bold text-red-300">Bulto {codigo} no está en el reporte SAP</h3>
              <p className="text-xs text-slate-400">Revisa el número. Si la tarima sí está en piso, regístrala como sobrante.</p>
            </div>
          </div>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Hojas en la tarima"
            value={conteo}
            onChange={(e) => setConteo(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg font-bold text-white"
          />
          <button
            disabled={guardando || !auditor.trim()}
            onClick={registrarSobrante}
            className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white font-bold py-3 rounded-xl cursor-pointer"
          >
            {auditor.trim() ? "Registrar como sobrante" : "Escribe tu nombre arriba"}
          </button>
        </div>
      )}

      {/* Varios materiales con el mismo lote */}
      {coincidencias && coincidencias.length > 1 && !seleccionado && (
        <div className="bg-slate-900 border-2 border-blue-500/60 rounded-2xl p-4 space-y-2">
          <h3 className="font-bold text-white">El bulto {codigo} está en {coincidencias.length} materiales</h3>
          <p className="text-xs text-slate-400">Elige el que corresponde a la tarima que tienes enfrente:</p>
          {coincidencias.map((b) => (
            <button
              key={b.id}
              onClick={() => elegir(b)}
              className="w-full text-left p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500 cursor-pointer"
            >
              <div className="flex justify-between gap-2">
                <span className="text-sm font-bold text-white">{b.texto_breve}</span>
                <span className="text-sm font-bold text-white shrink-0">{num(b.cantidad_sap)}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Material {b.material} · {ETAPAS[b.etapa]?.nombre} · {ESTADOS[b.estado]?.nombre}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Tarjeta del bulto */}
      {seleccionado && (
        <div className="bg-slate-900 border-2 border-emerald-500/60 rounded-2xl p-4 space-y-4 shadow-2xl">
          <div className="border-b border-slate-800 pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-xs text-slate-400">Bulto</span>
                <h3 className="text-2xl font-black text-white font-mono">{seleccionado.lote}</h3>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${ETAPAS[seleccionado.etapa]?.color}`}>
                  {ETAPAS[seleccionado.etapa]?.nombre}
                </span>
                {seleccionado.calibre && (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {seleccionado.calibre === "ALU" ? "Aluminio" : `Cal. ${seleccionado.calibre}`}
                  </span>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-200 mt-1">{seleccionado.texto_breve}</p>
            <p className="text-xs text-slate-500">Material {seleccionado.material} · Almacén {seleccionado.almacen}</p>
          </div>

          {seleccionado.estado !== "PENDIENTE" && (
            <div className="flex gap-2 items-start text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Ya fue contado por {seleccionado.verificado_por} ({hora(seleccionado.verificado_en)}) con{" "}
              {num(seleccionado.cantidad_fisica)} pzas. Si confirmas, se reemplaza.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs text-slate-400 block">Según SAP</span>
              <strong className="text-2xl font-black text-white">{num(seleccionado.cantidad_sap)}</strong>
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Tipo</span>
              <strong className="text-sm font-bold text-amber-400">
                {esPico(seleccionado) ? "Pico (< 1,500)" : "Lote completo"}
              </strong>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Hojas físicas en la tarima</label>
            <input
              type="number"
              inputMode="numeric"
              value={conteo}
              onChange={(e) => {
                setConteo(e.target.value);
                setAlturaMm("");
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-2xl font-black text-white"
            />
          </div>

          <details className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <summary className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 cursor-pointer">
              <Ruler className="w-4 h-4" /> Calcular hojas por altura de la pila
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Altura en mm"
                  value={alturaMm}
                  onChange={(e) => calcularPorAltura(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />
                <span className="text-xs text-slate-400">÷</span>
                <input
                  type="number"
                  step="0.001"
                  value={espesores[calibreSel]}
                  onChange={(e) => cambiarEspesor(calibreSel, e.target.value)}
                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-white"
                  title="Espesor por hoja en mm"
                />
                <span className="text-xs text-slate-400">mm/hoja</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Espesor para calibre {calibreSel}. Ajústalo midiendo una tarima completa de 1,500 hojas: altura ÷ 1500. Se guarda en este celular.
              </p>
            </div>
          </details>

          {conteo !== "" && diferencia !== 0 && (
            <div className="text-center text-sm font-bold text-amber-300">
              Diferencia: {diferencia > 0 ? "+" : ""}
              {num(diferencia)} hojas
            </div>
          )}

          <button
            onClick={confirmar}
            disabled={guardando || conteo === "" || !auditor.trim()}
            className={`w-full flex items-center justify-center gap-2 font-black py-4 rounded-xl text-base disabled:opacity-40 cursor-pointer ${
              diferencia === 0 ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950" : "bg-amber-500 hover:bg-amber-400 text-slate-950"
            }`}
          >
            <Check className="w-5 h-5" />
            {!auditor.trim()
              ? "Escribe tu nombre arriba"
              : diferencia === 0
              ? `Check: coincide (${num(conteo)})`
              : `Registrar diferencia (${num(conteo)})`}
          </button>
          <button
            onClick={() => {
              setSeleccionado(null);
              setCoincidencias(null);
            }}
            className="w-full text-xs text-slate-400 underline cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Últimos registrados */}
      {recientes.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">Últimos registrados</h3>
          <div className="space-y-1.5">
            {recientes.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setCodigo(b.lote);
                  setCoincidencias([b]);
                  elegir(b);
                }}
                className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-bold text-white">{b.lote}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {b.verificado_por} · {hora(b.verificado_en)}
                  </div>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${ESTADOS[b.estado]?.color}`}>
                  {b.estado === "DIFERENCIA" ? `⚠ ${num(b.cantidad_fisica)}` : ESTADOS[b.estado]?.nombre}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
