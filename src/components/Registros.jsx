// src/components/Registros.jsx
// Fila de un bulto registrado (con sus acciones) y la etiqueta de estado.
import { MoveRight, CheckCheck } from "lucide-react";
import { textoUbicacion } from "../lib/croquis";
import { num, hora } from "../lib/formato";

export function EstadoChip({ enSap, r }) {
  const base = "px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap";
  if (!r) {
    return enSap ? (
      <span className={`${base} bg-slate-800 text-slate-400`}>Pendiente</span>
    ) : (
      <span className={`${base} bg-slate-800 text-slate-500`}>Ya no en SAP</span>
    );
  }
  if (r.motivo) return <span className={`${base} bg-yellow-400 text-slate-950`}>● {r.motivo}</span>;
  if (r.estado === "SOBRANTE") return <span className={`${base} bg-red-500/20 text-red-300 border border-red-500/30`}>✚ No está en SAP</span>;
  if (r.estado === "DIFERENCIA") return <span className={`${base} bg-amber-500/20 text-amber-300 border border-amber-500/30`}>⚠ Diferencia</span>;
  return <span className={`${base} bg-emerald-500/20 text-emerald-300 border border-emerald-500/30`}>✓ Verificado</span>;
}

export function FilaRegistro({ r, nivel, soloLectura, onMover, onResolver, onSeguimiento, onEliminar, onUbicar }) {
  const dif = r.estado === "SOBRANTE" || r.cantidad_fisica == null ? null : Number(r.cantidad_fisica) - Number(r.cantidad_sap);
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${r.motivo ? "bg-yellow-400/[.07] border-yellow-400/40" : "bg-slate-900 border-slate-800"}`}>
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-bold text-white">
            {r.lote}
            {nivel && <span className="ml-2 font-sans text-[11px] font-semibold text-slate-400">Nivel {nivel}</span>}
          </div>
          <div className="text-xs text-slate-300 truncate">{r.estado === "SOBRANTE" ? "No está en el reporte SAP" : r.texto_breve}</div>
          <div className="text-[11px] text-slate-500">
            {textoUbicacion(r.zona, r.carril, r.posicion)} · {num(r.cantidad_fisica)} pzas
            {dif ? ` (${dif > 0 ? "+" : ""}${num(dif)} vs SAP)` : ""} · {r.usuario} · {hora(r.actualizado_en)}
          </div>
        </div>
        {r.motivo && <span className="self-start shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-400 text-slate-950">{r.motivo}</span>}
      </div>
      {r.comentario && <p className="m-0 text-xs text-yellow-100/80">“{r.comentario}”</p>}
      <div className="flex flex-wrap gap-1.5">
        {onUbicar && r.posicion && (
          <button onClick={onUbicar} className="px-2.5 py-1.5 rounded-lg border border-cyan-700 text-cyan-200 hover:bg-cyan-400/10 text-xs font-semibold cursor-pointer">
            Ver en el layout
          </button>
        )}
        {!soloLectura && (
          <>
            <button onClick={onMover} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">
              <MoveRight className="w-3.5 h-3.5" /> {r.posicion ? "Mover" : "Mover a posición"}
            </button>
            {r.motivo && r.posicion && (
              <button
                onClick={onResolver}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Resolver observación
              </button>
            )}
            {r.posicion && (
              <button
                onClick={onSeguimiento}
                className="px-2.5 py-1.5 rounded-lg border border-yellow-800 text-yellow-200 hover:bg-yellow-400/10 text-xs font-semibold cursor-pointer"
              >
                Enviar a seguimiento
              </button>
            )}
            <button onClick={onEliminar} className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-red-300 text-xs font-semibold cursor-pointer">
              Eliminar registro
            </button>
          </>
        )}
      </div>
    </div>
  );
}
