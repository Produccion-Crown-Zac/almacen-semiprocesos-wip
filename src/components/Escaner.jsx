// src/components/Escaner.jsx
// Vista de celular: el operador se para en una zona / carril / posición,
// escanea los bultos que hay ahí y les da check (✓) o los registra con observación (>).
import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraOff, Search, Check, ChevronRight, AlertTriangle, PackageX, Ruler, User } from "lucide-react";
import { Registro, Movimiento } from "../api/entities";
import { CAPACIDAD_POSICION, ZONAS, carrilesDeZona, textoUbicacion } from "../lib/croquis";
import { ETAPAS, num, hora, limpiarCodigo } from "../lib/formato";
import { PilaPosicion, Advertencia, HojaObservacion } from "./Comunes";

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

const Flecha = ({ etiqueta, onClick, children }) => (
  <button
    onClick={onClick}
    aria-label={etiqueta}
    className="h-[52px] rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-2xl font-extrabold cursor-pointer"
  >
    {children}
  </button>
);

export default function Escaner({ sap, registros, conteo, zona, auditor, resumen, onCambio }) {
  // ---------- Ubicación actual ----------
  const carriles = carrilesDeZona(zona);
  const [ubic, setUbic] = useState(() => {
    try {
      return JSON.parse(leerLocal("wip_ubicaciones", "{}"));
    } catch {
      return {};
    }
  });
  const actual = ubic[zona] ?? { carril: carriles[0].id, posicion: 1 };
  const idxCarril = Math.max(0, carriles.findIndex((c) => c.id === actual.carril));
  const carril = carriles[idxCarril];
  const posicion = Math.min(actual.posicion, carril.posiciones);
  const moverA = (carrilId, pos) => {
    const nuevo = { ...ubic, [zona]: { carril: carrilId, posicion: pos } };
    setUbic(nuevo);
    guardarLocal("wip_ubicaciones", JSON.stringify(nuevo));
  };
  const cambiarCarril = (d) => {
    const i = (idxCarril + d + carriles.length) % carriles.length;
    moverA(carriles[i].id, 1);
  };
  const cambiarPosicion = (d) => {
    const p = posicion + d;
    if (p < 1) moverA(carril.id, carril.posiciones);
    else if (p > carril.posiciones) moverA(carril.id, 1);
    else moverA(carril.id, p);
  };
  const textoAqui = textoUbicacion(zona, carril.id, posicion);

  const lotesAqui = useMemo(
    () =>
      registros
        .filter((r) => r.zona === zona && r.carril === carril.id && Number(r.posicion) === posicion)
        .sort((a, b) => a.orden - b.orden),
    [registros, zona, carril.id, posicion]
  );

  // ---------- Búsqueda / escaneo ----------
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [errorCamara, setErrorCamara] = useState("");
  const [codigo, setCodigo] = useState("");
  const [coincidencias, setCoincidencias] = useState(null);
  const [seleccionado, setSeleccionado] = useState(null); // fila SAP o { sobrante: true, lote }
  const [conteoInput, setConteoInput] = useState("");
  const [alturaMm, setAlturaMm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [hojaObs, setHojaObs] = useState(false);
  const [advertencia, setAdvertencia] = useState(null); // { opciones }
  const [continuo, setContinuo] = useState(() => leerLocal("wip_modo_continuo", "1") === "1");
  const [espesores, setEspesores] = useState(() => ({
    70: Number(leerLocal("wip_espesor_70", "0.25")),
    75: Number(leerLocal("wip_espesor_75", "0.28")),
  }));
  const inputRef = useRef(null);
  const sapRef = useRef(sap);
  useEffect(() => {
    sapRef.current = sap;
  }, [sap]);

  const registroDe = (clave) => registros.find((r) => r.clave === clave);

  const elegir = (fila) => {
    setSeleccionado(fila);
    const previo = registros.find((r) => r.clave === fila.clave);
    setConteoInput(String(previo?.cantidad_fisica ?? fila.cantidad_sap ?? ""));
    setAlturaMm("");
  };

  const buscar = (texto) => {
    const limpio = limpiarCodigo(texto);
    if (!limpio) return;
    setCodigo(limpio);
    const encontrados = sapRef.current.filter((s) => s.lote === limpio && s.en_sap);
    setCoincidencias(encontrados);
    if (encontrados.length === 1) elegir(encontrados[0]);
    else if (encontrados.length === 0) {
      const sobrante = { sobrante: true, clave: `SOBRANTE|${limpio}`, lote: limpio, cantidad_sap: 0, etapa: "OTRO", calibre: "", texto_breve: "" };
      setSeleccionado(sobrante);
      const previo = registros.find((r) => r.clave === sobrante.clave);
      setConteoInput(previo ? String(previo.cantidad_fisica ?? "") : "");
    } else {
      // Si varios materiales comparten el lote, sugerir el de la zona actual
      const deZona = encontrados.filter((e) => e.etapa === zona);
      if (deZona.length === 1) elegir(deZona[0]);
      else setSeleccionado(null);
    }
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
    lector
      .start(
        { facingMode: "environment" },
        {
          fps: 12,
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

  // ---------- Calculadora ----------
  const calibreSel = seleccionado?.calibre === "75" ? 75 : 70;
  const calcularPorAltura = (mm) => {
    setAlturaMm(mm);
    const v = Number(mm);
    if (v > 0) setConteoInput(String(Math.round(v / espesores[calibreSel])));
  };
  const cambiarEspesor = (cal, valor) => {
    setEspesores((e) => ({ ...e, [cal]: Number(valor) }));
    guardarLocal(`wip_espesor_${cal}`, valor);
  };

  // ---------- Guardar ----------
  const limpiar = () => {
    setSeleccionado(null);
    setCoincidencias(null);
    setCodigo("");
    setConteoInput("");
    setAlturaMm("");
  };

  const terminar = (mensaje, tipo) => {
    setAviso({ mensaje, tipo });
    setTimeout(() => setAviso(null), 4000);
    limpiar();
    onCambio();
    if (continuo) setCamaraActiva(true);
    else inputRef.current?.focus();
  };

  // opciones: { motivo, comentario, destino: "POSICION" | "SEGUIMIENTO", forzado }
  const registrar = async (opciones) => {
    if (!seleccionado || !auditor.trim()) return;
    const fisica = conteoInput === "" ? null : Number(conteoInput);
    const enPosicion = opciones.destino !== "SEGUIMIENTO";

    // Advertencia de capacidad (sin contar el mismo lote si ya estaba aquí)
    const ocupacion = lotesAqui.filter((r) => r.clave !== seleccionado.clave);
    if (enPosicion && ocupacion.length >= CAPACIDAD_POSICION && !opciones.forzado) {
      setAdvertencia({ opciones, lotes: ocupacion });
      return;
    }

    setGuardando(true);
    try {
      const estado = seleccionado.sobrante ? "SOBRANTE" : fisica === Number(seleccionado.cantidad_sap) ? "OK" : "DIFERENCIA";
      const { anterior } = await Registro.guardar({
        conteo_id: conteo.id,
        clave: seleccionado.clave,
        lote: seleccionado.lote,
        material: seleccionado.material ?? "",
        texto_breve: seleccionado.texto_breve ?? "",
        etapa: seleccionado.etapa,
        calibre: seleccionado.calibre,
        cantidad_sap: Number(seleccionado.cantidad_sap ?? 0),
        cantidad_fisica: fisica,
        estado,
        motivo: opciones.motivo ?? null,
        comentario: opciones.comentario ?? "",
        zona: enPosicion ? zona : null,
        carril: enPosicion ? carril.id : null,
        posicion: enPosicion ? posicion : null,
        usuario: auditor.trim(),
      });
      const destinoTxt = enPosicion ? textoAqui : "Área de seguimiento";
      const movido =
        anterior && textoUbicacion(anterior.zona, anterior.carril, anterior.posicion) !== destinoTxt
          ? ` (antes en ${textoUbicacion(anterior.zona, anterior.carril, anterior.posicion)})`
          : "";
      const partes = [];
      if (!seleccionado.sobrante && estado === "DIFERENCIA")
        partes.push(`SAP ${num(seleccionado.cantidad_sap)} vs físico ${num(fisica)}`);
      if (seleccionado.sobrante) partes.push("No está en el reporte SAP");
      if (opciones.motivo) partes.push(`${opciones.motivo}${opciones.comentario ? `: ${opciones.comentario}` : ""}`);
      await Movimiento.create({
        conteo_id: conteo.id,
        lote: seleccionado.lote,
        accion: opciones.motivo ? "CON OBSERVACIÓN" : estado === "OK" ? "CHECK" : estado === "SOBRANTE" ? "NO ESTÁ EN SAP" : "DIFERENCIA",
        detalle: `${destinoTxt}${movido}${partes.length ? " · " + partes.join(" · ") : ""}`,
        usuario: auditor.trim(),
      });
      if (opciones.forzado) {
        await Movimiento.create({
          conteo_id: conteo.id,
          lote: seleccionado.lote,
          accion: "ADVERTENCIA: MÁS DE 5 LOTES",
          detalle: `${destinoTxt} quedó con ${ocupacion.length + 1} lotes`,
          usuario: auditor.trim(),
        });
      }
      terminar(
        opciones.motivo
          ? `● ${seleccionado.lote} registrado con observación (${opciones.motivo})`
          : estado === "OK"
          ? `✓ ${seleccionado.lote} verificado en ${destinoTxt}${movido}`
          : estado === "SOBRANTE"
          ? `✚ ${seleccionado.lote} registrado como no está en SAP`
          : `⚠ ${seleccionado.lote}: diferencia registrada`,
        opciones.motivo || estado !== "OK" ? "warn" : "ok"
      );
    } catch (e) {
      setAviso({ mensaje: "Error al guardar: " + e.message, tipo: "error" });
    } finally {
      setGuardando(false);
      setHojaObs(false);
    }
  };

  const zonaInfo = ZONAS[zona];
  const resumenZona = resumen.zonas[zona];
  const previo = seleccionado ? registroDe(seleccionado.clave) : null;
  const fisica = Number(conteoInput);
  const diferencia = seleccionado && !seleccionado.sobrante && conteoInput !== "" ? fisica - Number(seleccionado.cantidad_sap) : 0;
  const otraEtapa = seleccionado && !seleccionado.sobrante && seleccionado.etapa !== zona && seleccionado.etapa !== "OTRO";

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-3">
      {/* Avance de la zona */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2.5">
        <div className="flex justify-between items-end">
          <div>
            <div className="text-[11px] font-extrabold tracking-[.08em] uppercase" style={{ color: zonaInfo.texto }}>
              {zonaInfo.titulo}
            </div>
            <div className="text-2xl font-black text-white">
              {num(resumenZona.verificados)} <span className="text-sm font-medium text-slate-400">de {num(resumenZona.total)} lotes</span>
            </div>
          </div>
          <div className="text-right text-xs leading-[18px]">
            <div className="text-[22px] font-black" style={{ color: zonaInfo.texto }}>
              {resumenZona.avance}%
            </div>
            <div className="text-amber-200">{resumenZona.observaciones} con observación</div>
          </div>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${resumenZona.avance}%`, background: zonaInfo.color }} />
        </div>
      </section>

      {/* Quién está contando (la sesión iniciada) */}
      <div className="flex items-center gap-2.5 h-12 px-3.5 bg-slate-900 border border-slate-800 rounded-xl text-[15px] text-white">
        <User className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="truncate">{auditor}</span>
        <span className="ml-auto text-[11px] text-slate-500 shrink-0">registra a tu nombre</span>
      </div>

      {/* Carril y posición */}
      <section className="flex flex-col gap-2">
        <div className="grid grid-cols-[64px_64px_1fr_96px] gap-2 items-center">
          <Flecha etiqueta="Carril anterior" onClick={() => cambiarCarril(-1)}>
            &lt;
          </Flecha>
          <Flecha etiqueta="Carril siguiente" onClick={() => cambiarCarril(1)}>
            &gt;
          </Flecha>
          <div className="h-[52px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-[15px]">Carril</div>
          <select
            aria-label="Carril"
            value={carril.id}
            onChange={(e) => moverA(e.target.value, 1)}
            className="h-[52px] rounded-xl bg-slate-950 border border-slate-600 text-center font-mono font-extrabold text-lg text-white"
          >
            {carriles.map((c) => (
              <option key={c.id} value={c.id}>
                {/^\d+$/.test(c.nombre) ? c.nombre.padStart(2, "0") : c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[64px_64px_1fr_96px] gap-2 items-center">
          <Flecha etiqueta="Posición anterior" onClick={() => cambiarPosicion(-1)}>
            &lt;
          </Flecha>
          <Flecha etiqueta="Posición siguiente" onClick={() => cambiarPosicion(1)}>
            &gt;
          </Flecha>
          <div className="h-[52px] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-[15px]">Posición</div>
          <select
            aria-label="Posición"
            value={posicion}
            onChange={(e) => moverA(carril.id, Number(e.target.value))}
            className="h-[52px] rounded-xl bg-slate-950 border border-slate-600 text-center font-mono font-extrabold text-xl text-white"
          >
            {Array.from({ length: carril.posiciones }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {String(i + 1).padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Lo que ya hay en esta posición */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex gap-3 items-center">
        <PilaPosicion lotes={lotesAqui} resaltarExceso />
        <div className="flex flex-col gap-0.5 text-xs text-slate-400 min-w-0">
          <span className="text-sm font-bold text-white">{textoAqui}</span>
          <span className={lotesAqui.length >= CAPACIDAD_POSICION ? "text-red-300 font-semibold" : ""}>
            {lotesAqui.length} de {CAPACIDAD_POSICION} lotes registrados aquí
          </span>
          <span className="font-mono text-slate-300 break-words">{lotesAqui.map((r) => r.lote).join(" · ") || "Posición vacía"}</span>
        </div>
      </section>

      {/* Escaneo */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2.5">
        <button
          onClick={() => {
            setErrorCamara("");
            setCamaraActiva((v) => !v);
          }}
          className={`h-[54px] rounded-xl flex items-center justify-center gap-2 font-extrabold text-base cursor-pointer ${
            camaraActiva ? "bg-slate-700 text-white" : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
          }`}
        >
          {camaraActiva ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
          {camaraActiva ? "Cerrar cámara" : "Escanear bulto"}
        </button>
        {camaraActiva && <div id={ID_LECTOR} className="overflow-hidden rounded-xl bg-black min-h-[220px]" />}
        {errorCamara && <p className="text-xs text-red-300 m-0">{errorCamara}</p>}
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
            aria-label="Número de bulto"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="flex-1 min-w-0 h-12 box-border px-3 rounded-xl border border-slate-600 bg-slate-950 text-white font-mono uppercase text-sm"
          />
          <button type="submit" aria-label="Buscar" className="w-[52px] h-12 rounded-xl bg-blue-600 hover:bg-blue-500 flex items-center justify-center cursor-pointer">
            <Search className="w-5 h-5 text-white" />
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
      </section>

      {aviso && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-sm font-bold ${
            aviso.tipo === "ok" ? "bg-emerald-500 text-slate-950" : aviso.tipo === "warn" ? "bg-amber-400 text-slate-950" : "bg-red-500 text-white"
          }`}
        >
          {aviso.mensaje}
        </div>
      )}

      {/* Varios materiales con el mismo lote */}
      {coincidencias && coincidencias.length > 1 && !seleccionado && (
        <section className="bg-slate-900 border-2 border-blue-500/60 rounded-2xl p-4 flex flex-col gap-2">
          <h3 className="m-0 font-bold text-white">El bulto {codigo} está en {coincidencias.length} materiales</h3>
          <p className="m-0 text-xs text-slate-400">Elige el que corresponde a la tarima que tienes enfrente:</p>
          {coincidencias.map((b) => (
            <button
              key={b.clave}
              onClick={() => elegir(b)}
              className="w-full text-left p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500 cursor-pointer"
            >
              <div className="flex justify-between gap-2">
                <span className="text-sm font-bold text-white">{b.texto_breve}</span>
                <span className="text-sm font-bold text-white shrink-0">{num(b.cantidad_sap)}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Material {b.material} · {ETAPAS[b.etapa]?.nombre}
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Tarjeta del bulto */}
      {seleccionado && (
        <section
          className={`bg-slate-900 border-2 rounded-[20px] p-4 flex flex-col gap-3.5 ${seleccionado.sobrante ? "border-red-500/60" : "border-emerald-500/60"}`}
        >
          <div className="flex justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">Bulto</div>
              <div className="font-mono text-2xl font-extrabold text-white">{seleccionado.lote}</div>
              {seleccionado.sobrante ? (
                <div className="flex items-start gap-1.5 text-sm text-red-300 mt-1">
                  <PackageX className="w-4 h-4 shrink-0 mt-0.5" /> No está en el reporte SAP. Revisa el número; si la tarima sí está aquí, regístrala.
                </div>
              ) : (
                <>
                  <div className="text-sm text-slate-200 mt-0.5">{seleccionado.texto_breve}</div>
                  <div className="text-xs text-slate-500">
                    Material {seleccionado.material} · Almacén {seleccionado.almacen}
                  </div>
                </>
              )}
            </div>
            {!seleccionado.sobrante && (
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${ETAPAS[seleccionado.etapa]?.color}`}>{ETAPAS[seleccionado.etapa]?.nombre}</span>
                {seleccionado.calibre && (
                  <span
                    className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold ${
                      seleccionado.calibre === "75"
                        ? "bg-slate-100 text-slate-950"
                        : seleccionado.calibre === "70"
                        ? "bg-green-500 text-slate-950"
                        : "bg-blue-500 text-white"
                    }`}
                  >
                    {seleccionado.calibre === "ALU" ? "Aluminio" : `Cal. ${seleccionado.calibre}`}
                  </span>
                )}
              </div>
            )}
          </div>

          {otraEtapa && (
            <div className="flex gap-2 items-start text-xs bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Este lote es lámina {ETAPAS[seleccionado.etapa]?.nombre.toLowerCase()} y estás en la zona {zonaInfo.nombre.toLowerCase()}. Si no
              corresponde aquí, usa el botón naranja con "Ubicación incorrecta".
            </div>
          )}
          {previo && (
            <div className="flex gap-2 items-start text-xs bg-blue-500/10 border border-blue-500/30 text-blue-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Ya se registró en este conteo en {textoUbicacion(previo.zona, previo.carril, previo.posicion)} por {previo.usuario} (
              {hora(previo.actualizado_en)}). Si confirmas, se actualiza y se mueve aquí.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div>
              <div className="text-xs text-slate-400">Según SAP</div>
              <div className="text-2xl font-black text-white">{seleccionado.sobrante ? "—" : num(seleccionado.cantidad_sap)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Se registrará en</div>
              <div className="text-sm font-bold" style={{ color: zonaInfo.texto }}>
                {/^\d+$/.test(carril.nombre) ? `Carril ${carril.nombre}` : carril.nombre} · Pos. {posicion}
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-slate-300">Piezas físicas en la tarima</span>
            <input
              type="number"
              inputMode="numeric"
              value={conteoInput}
              onChange={(e) => {
                setConteoInput(e.target.value);
                setAlturaMm("");
              }}
              className="h-14 box-border px-3.5 rounded-xl border border-slate-600 bg-slate-950 text-white text-2xl font-black"
            />
          </label>

          <details className="border border-slate-800 rounded-xl px-3 py-2.5">
            <summary className="flex items-center gap-2 text-[13px] font-semibold text-blue-300 cursor-pointer">
              <Ruler className="w-4 h-4" /> Calcular piezas por altura de la pila
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Altura en mm"
                  value={alturaMm}
                  onChange={(e) => calcularPorAltura(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                />
                <span className="text-xs text-slate-400">÷</span>
                <input
                  type="number"
                  step="0.001"
                  value={espesores[calibreSel]}
                  onChange={(e) => cambiarEspesor(calibreSel, e.target.value)}
                  aria-label="Espesor por pieza en mm"
                  className="w-20 bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
                />
                <span className="text-xs text-slate-400">mm/pieza</span>
              </div>
              <p className="m-0 text-[11px] text-slate-500">
                Espesor para calibre {calibreSel}. Ajústalo midiendo una tarima completa de 1,500 piezas: altura ÷ 1500. Se guarda en este celular.
              </p>
            </div>
          </details>

          {diferencia !== 0 && (
            <div className="text-center text-sm font-bold text-amber-300">
              Diferencia: {diferencia > 0 ? "+" : ""}
              {num(diferencia)} piezas
            </div>
          )}


          <div className="grid grid-cols-2 gap-3">
            <button
              aria-label="Check: confirmar lote"
              disabled={guardando || conteoInput === "" || !auditor.trim()}
              onClick={() => registrar({ destino: "POSICION" })}
              className="h-24 rounded-[18px] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 flex items-center justify-center cursor-pointer"
            >
              <Check className="w-12 h-12 text-white" strokeWidth={3} />
            </button>
            <button
              aria-label="Registrar con observación"
              disabled={guardando || !auditor.trim()}
              onClick={() => setHojaObs(true)}
              className="h-24 rounded-[18px] bg-amber-500 hover:bg-amber-400 disabled:opacity-40 flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-12 h-12 text-white" strokeWidth={3} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 -mt-1.5 text-xs text-center text-slate-400">
            <span>{diferencia === 0 ? "Check" : "Check con diferencia"}</span>
            <span>Con observación</span>
          </div>
          <button onClick={limpiar} className="self-center h-11 px-7 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-sm cursor-pointer">
            Cancelar
          </button>
        </section>
      )}

      {/* Últimos registrados */}
      <RecientesEscaner registros={registros} />

      {hojaObs && seleccionado && (
        <HojaObservacion
          titulo={seleccionado.lote}
          subtitulo={
            seleccionado.sobrante
              ? "No está en el reporte SAP"
              : `${seleccionado.texto_breve} · ${seleccionado.calibre === "ALU" ? "Aluminio" : `Cal. ${seleccionado.calibre || "—"}`} · SAP ${num(seleccionado.cantidad_sap)} pzas`
          }
          ubicacionActual={textoAqui}
          motivoInicial={otraEtapa ? "Ubicación incorrecta" : ""}
          guardando={guardando}
          onVolver={() => setHojaObs(false)}
          onGuardar={(o) => registrar(o)}
        />
      )}

      {advertencia && (
        <Advertencia
          zona={zona}
          carril={carril.id}
          posicion={posicion}
          lotes={advertencia.lotes}
          lote={seleccionado?.lote}
          onOtraPosicion={() => {
            setAdvertencia(null);
            setHojaObs(false);
          }}
          onRegistrar={() => {
            const o = advertencia.opciones;
            setAdvertencia(null);
            registrar({ ...o, forzado: true });
          }}
        />
      )}
    </div>
  );
}

function RecientesEscaner({ registros }) {
  const recientes = [...registros].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)).slice(0, 10);
  if (recientes.length === 0) return null;
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
      <h3 className="m-0 mb-2 text-sm font-bold text-white">Últimos registrados</h3>
      <div className="flex flex-col gap-1.5">
        {recientes.map((r) => (
          <div
            key={r.id}
            className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border ${
              r.motivo ? "bg-yellow-400/10 border-yellow-400/40" : "bg-slate-950 border-slate-800"
            }`}
          >
            <div className="min-w-0">
              <div className="font-mono text-sm font-bold text-white">{r.lote}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {textoUbicacion(r.zona, r.carril, r.posicion)} · {r.usuario} · {hora(r.actualizado_en)}
              </div>
            </div>
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                r.motivo
                  ? "bg-yellow-400 text-slate-950"
                  : r.estado === "OK"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : r.estado === "SOBRANTE"
                  ? "bg-red-500/20 text-red-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {r.motivo ? r.motivo : r.estado === "OK" ? "✓" : r.estado === "SOBRANTE" ? "No en SAP" : `⚠ ${num(r.cantidad_fisica)}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

