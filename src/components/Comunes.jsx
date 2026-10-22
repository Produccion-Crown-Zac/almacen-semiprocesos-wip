// src/components/Comunes.jsx
// Piezas de interfaz compartidas por el escáner y el tablero.
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  CAPACIDAD_POSICION,
  COLORES_LOTE,
  MOTIVOS,
  ORDEN_ZONAS,
  ZONAS,
  carrilesDeZona,
  buscarCarril,
  tipoColorLote,
  textoUbicacion,
} from "../lib/croquis";

// Pila de lotes de una posición (de abajo hacia arriba)
export function PilaPosicion({ lotes, ancho = 54, alto = 74, resaltarExceso = false }) {
  const huecos = Math.max(0, CAPACIDAD_POSICION - lotes.length);
  return (
    <div
      className={`shrink-0 box-border rounded-md p-[3px] flex flex-col-reverse gap-[3px] bg-slate-950 border ${
        resaltarExceso && lotes.length >= CAPACIDAD_POSICION ? "border-red-700" : "border-slate-700"
      }`}
      style={{ width: ancho, height: alto }}
      aria-hidden="true"
    >
      {lotes.map((r) => (
        <div
          key={r.id}
          className="flex-1 rounded-sm"
          style={{
            background: COLORES_LOTE[tipoColorLote(r)].color,
            outline: r.motivo ? "2px solid #facc15" : "none",
            outlineOffset: -2,
          }}
        />
      ))}
      {Array.from({ length: huecos }, (_, i) => (
        <div key={`h${i}`} className="flex-1 rounded-sm border border-dashed border-slate-600" />
      ))}
    </div>
  );
}

export function Leyenda({ compacta = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${compacta ? "text-[11px]" : "text-xs"} text-slate-300`}>
      {Object.entries(COLORES_LOTE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="w-3.5 h-3 rounded-sm" style={{ background: v.color }} />
          {v.nombre}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3 rounded-sm bg-slate-950 border border-slate-600" />
        Vacía
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3 rounded-sm bg-green-500" style={{ outline: "2px solid #facc15", outlineOffset: 1 }} />
        Con observación
      </span>
    </div>
  );
}

// Fondo oscuro + tarjeta centrada (o pegada abajo en celular)
export function Modal({ children, onCerrar, abajo = false, etiqueta }) {
  return (
    <div
      className={`fixed inset-0 z-50 bg-black/75 flex ${abajo ? "items-end sm:items-center" : "items-center"} justify-center p-0 sm:p-4`}
      role="dialog"
      aria-modal="true"
      aria-label={etiqueta}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar?.();
      }}
    >
      {children}
    </div>
  );
}

// Advertencia: la posición ya tiene 5 lotes
export function Advertencia({ zona, carril, posicion, lotes, lote, onOtraPosicion, onRegistrar }) {
  return (
    <Modal onCerrar={onOtraPosicion} etiqueta="Advertencia de capacidad">
      <section className="w-[calc(100%-32px)] max-w-sm bg-[#1a0f12] border-2 border-red-500 rounded-3xl p-5 flex flex-col gap-4">
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center self-center">
          <AlertTriangle className="w-9 h-9 text-red-400" />
        </div>
        <div className="text-center flex flex-col gap-1.5">
          <div className="text-xs font-extrabold tracking-[.1em] text-red-300">ADVERTENCIA</div>
          <h2 className="m-0 text-xl font-extrabold text-red-50">La posición ya tiene {lotes.length} lotes</h2>
          <p className="m-0 text-sm text-red-200 leading-5">
            {textoUbicacion(zona, carril, posicion)} está a su capacidad máxima de {CAPACIDAD_POSICION}. Apilar otro lote pone en riesgo al personal
            y al material.
          </p>
        </div>
        <div className="bg-slate-950 border border-red-950 rounded-xl p-3 flex gap-3 items-center">
          <PilaPosicion lotes={lotes.slice(-CAPACIDAD_POSICION)} ancho={46} alto={70} resaltarExceso />
          <div className="flex flex-col gap-0.5 text-xs text-slate-300">
            <span>Intentas registrar:</span>
            <span className="font-mono text-base font-extrabold text-white">{lote}</span>
            <span>Quedará anotado en la bitácora con tu nombre.</span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <button onClick={onOtraPosicion} className="h-13 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold cursor-pointer">
            Elegir otra posición
          </button>
          <button
            onClick={onRegistrar}
            className="py-3.5 rounded-xl border border-red-500 text-red-300 hover:bg-red-500/10 font-bold cursor-pointer"
          >
            Registrar de todos modos
          </button>
        </div>
      </section>
    </Modal>
  );
}

// Hoja de observación (botón naranja ">")
export function HojaObservacion({ titulo, subtitulo, ubicacionActual, motivoInicial, onGuardar, onVolver, guardando }) {
  const [motivo, setMotivo] = useState(motivoInicial ?? "");
  const [destino, setDestino] = useState("SEGUIMIENTO");
  const [comentario, setComentario] = useState("");
  const faltaTexto = motivo === "Otro" && !comentario.trim();

  return (
    <Modal abajo onCerrar={onVolver} etiqueta="Registrar con observación">
      <section className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-slate-900 border-t-2 sm:border-2 border-amber-500 rounded-t-3xl sm:rounded-3xl px-4 pt-4 pb-6 flex flex-col gap-4">
        <div className="w-11 h-1.5 rounded-full bg-slate-700 self-center sm:hidden" />
        <div className="flex justify-between gap-2">
          <div>
            <div className="text-xs font-extrabold tracking-[.08em] text-amber-300">REGISTRAR CON OBSERVACIÓN</div>
            <div className="font-mono text-xl font-extrabold text-white mt-1">{titulo}</div>
            <div className="text-[13px] text-slate-300">{subtitulo}</div>
          </div>
          <button onClick={onVolver} aria-label="Cerrar" className="self-start p-2 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <fieldset className="border-0 m-0 p-0 flex flex-col gap-2">
          <legend className="text-[13px] font-bold text-white mb-2">Motivo</legend>
          {MOTIVOS.map((m) => (
            <label
              key={m}
              className={`min-h-12 flex items-center gap-3 px-3.5 rounded-xl text-[15px] font-semibold cursor-pointer ${
                motivo === m ? "border-2 border-amber-500 bg-amber-500/10 text-amber-100" : "border border-slate-700 bg-slate-950 text-slate-200"
              }`}
            >
              <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} className="w-[18px] h-[18px] accent-amber-500" />
              {m === "Otro" ? "Otro…" : m}
            </label>
          ))}
        </fieldset>

        {ubicacionActual && (
          <fieldset className="border-0 m-0 p-0 flex flex-col gap-2">
            <legend className="text-[13px] font-bold text-white mb-2">¿Dónde queda el lote?</legend>
            {[
              ["SEGUIMIENTO", "Área de seguimiento", "Queda apartado hasta corregirlo. Desde el tablero se puede mover a una posición."],
              ["POSICION", ubicacionActual, "Se registra en la posición actual con marca amarilla."],
            ].map(([v, t, d]) => (
              <label
                key={v}
                className={`flex gap-3 items-start px-3.5 py-3 rounded-xl cursor-pointer ${
                  destino === v ? "border-2 border-yellow-400 bg-yellow-400/10" : "border border-slate-700 bg-slate-950"
                }`}
              >
                <input type="radio" name="destino" checked={destino === v} onChange={() => setDestino(v)} className="w-[18px] h-[18px] mt-0.5 accent-yellow-400" />
                <span className="flex flex-col gap-0.5">
                  <span className={`text-[15px] font-bold ${destino === v ? "text-yellow-100" : "text-white"}`}>{t}</span>
                  <span className={`text-xs ${destino === v ? "text-yellow-300" : "text-slate-400"}`}>{d}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-white">{motivo === "Otro" ? "Describe la observación" : "Comentario (opcional)"}</span>
          <textarea
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Ej. en línea de recubrimiento desde el turno 2"
            className="box-border px-3 py-2.5 rounded-xl border border-slate-600 bg-slate-950 text-white text-sm resize-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={onVolver} className="py-3.5 rounded-xl border border-slate-700 text-slate-200 font-bold cursor-pointer">
            Volver
          </button>
          <button
            disabled={!motivo || faltaTexto || guardando}
            onClick={() => onGuardar({ motivo, comentario: comentario.trim(), destino: ubicacionActual ? destino : "SEGUIMIENTO" })}
            className="py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-extrabold cursor-pointer"
          >
            Guardar
          </button>
        </div>
      </section>
    </Modal>
  );
}

// Selector de zona / carril / posición (para mover un lote desde el tablero)
export function SelectorUbicacion({ valor, onCambio }) {
  const carriles = carrilesDeZona(valor.zona);
  const carril = buscarCarril(valor.zona, valor.carril) ?? carriles[0];
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Zona"
        value={valor.zona}
        onChange={(e) => {
          const z = e.target.value;
          onCambio({ zona: z, carril: carrilesDeZona(z)[0].id, posicion: 1 });
        }}
        className="bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
      >
        {ORDEN_ZONAS.map((z) => (
          <option key={z} value={z}>
            {ZONAS[z].nombre}
          </option>
        ))}
      </select>
      <select
        aria-label="Carril"
        value={carril.id}
        onChange={(e) => onCambio({ ...valor, carril: e.target.value, posicion: 1 })}
        className="bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
      >
        {carriles.map((c) => (
          <option key={c.id} value={c.id}>
            Carril {c.nombre}
          </option>
        ))}
      </select>
      <select
        aria-label="Posición"
        value={valor.posicion}
        onChange={(e) => onCambio({ ...valor, posicion: Number(e.target.value) })}
        className="bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white"
      >
        {Array.from({ length: carril.posiciones }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            Posición {i + 1}
          </option>
        ))}
      </select>
    </div>
  );
}
