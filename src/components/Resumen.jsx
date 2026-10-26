// src/components/Resumen.jsx
// Subapartado "Resumen" del tablero: exactitud de inventario, desviación y avance,
// con desglose por Día / Semana / SKU / Proceso. Todo en piezas (láminas).
import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { ZONAS, MOTIVOS, textoUbicacion } from "../lib/croquis";
import { num } from "../lib/formato";
import { metricas, agrupar, pct1 } from "../lib/metricas";

const VERDE = "#22c55e";
const ROJO = "#ef4444";

const Tarjeta = ({ children, className = "" }) => (
  <div className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 ${className}`}>{children}</div>
);

const Estado = ({ valor, meta }) =>
  valor == null ? (
    <span className="text-xs text-slate-500">Sin lotes contados</span>
  ) : valor >= meta ? (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300">
      <CheckCircle2 className="w-4 h-4" /> En meta (≥ {meta}%)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-300">
      <AlertTriangle className="w-4 h-4" /> Debajo de la meta ({meta}%)
    </span>
  );

// Barra horizontal 0–100 % con la marca de la meta
const BarraMeta = ({ valor, meta, alto = 10 }) => (
  <div className="relative w-full rounded-full bg-slate-800" style={{ height: alto }}>
    {valor != null && (
      <div
        className="absolute left-0 top-0 h-full rounded-full"
        style={{ width: `${Math.max(1, Math.min(100, valor))}%`, background: valor >= meta ? VERDE : ROJO }}
      />
    )}
    <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-200" style={{ left: `${meta}%` }} title={`Meta ${meta}%`} />
  </div>
);

const Anillo = ({ titulo, color, r }) => (
  <Tarjeta className="flex items-center gap-4">
    <div
      className="w-[84px] h-[84px] rounded-full shrink-0 flex items-center justify-center"
      style={{ background: `conic-gradient(${color} ${r.avance}%, #1e293b 0)` }}
      role="img"
      aria-label={`${titulo}: ${r.avance}% de lotes contados`}
    >
      <div className="w-[64px] h-[64px] rounded-full bg-slate-900 flex items-center justify-center text-base font-extrabold text-white">{r.avance}%</div>
    </div>
    <div className="flex flex-col gap-1 min-w-0 flex-1">
      <span className="text-xs font-bold tracking-[.06em] uppercase" style={{ color }}>
        {titulo}
      </span>
      <span className="text-lg font-extrabold text-white leading-tight">
        {num(r.verificados)} <span className="text-sm font-medium text-slate-400">de {num(r.total)} lotes</span>
      </span>
      <span className="text-sm font-bold text-slate-200 leading-tight">
        {num(r.piezas)} <span className="text-xs font-medium text-slate-400">de {num(r.piezasTotal)} piezas en SAP</span>
      </span>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden" title={`${r.avancePiezas}% de las piezas de SAP ya contadas`}>
        <div className="h-full rounded-full" style={{ width: `${r.avancePiezas}%`, background: color }} />
      </div>
      <span className="text-[11px] text-slate-500">
        {r.avancePiezas}% de las piezas contadas · {r.observaciones} con observación
      </span>
    </div>
  </Tarjeta>
);

const AGRUPACIONES = [
  ["DIA", "Día"],
  ["SEMANA", "Semana"],
  ["SKU", "SKU"],
  ["PROCESO", "Proceso"],
];

export default function Resumen({ registros, registrosTodos, resumen, zonaFiltro, onUbicar, meta = 95, onCambiarMeta }) {
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [metaInput, setMetaInput] = useState(String(meta));
  const [errorMeta, setErrorMeta] = useState("");
  const [por, setPor] = useState(() => {
    try {
      return localStorage.getItem("wip_resumen_por") || "PROCESO";
    } catch {
      return "PROCESO";
    }
  });
  const [verTodos, setVerTodos] = useState(false);
  const cambiarPor = (v) => {
    setPor(v);
    setVerTodos(false);
    try {
      localStorage.setItem("wip_resumen_por", v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const filtrar = (lista) => (zonaFiltro === "TODAS" ? lista : lista.filter((r) => r.etapa === zonaFiltro || (r.estado === "SOBRANTE" && r.zona === zonaFiltro)));
  const regs = useMemo(() => filtrar(registros), [registros, zonaFiltro]); // eslint-disable-line react-hooks/exhaustive-deps
  const regsTodos = useMemo(() => filtrar(registrosTodos), [registrosTodos, zonaFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMemo(() => metricas(regs), [regs]);
  const grupos = useMemo(() => {
    const g = agrupar(por === "DIA" || por === "SEMANA" ? regsTodos : regs, por);
    return por === "SKU" ? [...g].sort((a, b) => (b.desviacion ?? 0) - (a.desviacion ?? 0) || b.lotes - a.lotes) : g;
  }, [regs, regsTodos, por]);
  const visibles = por === "SKU" && !verTodos ? grupos.slice(0, 12) : grupos;

  const peores = [...regs]
    .map((r) => ({ r, d: Number(r.cantidad_fisica ?? 0) - (r.estado === "SOBRANTE" ? 0 : Number(r.cantidad_sap ?? 0)) }))
    .filter((x) => x.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 10);

  const porMotivo = MOTIVOS.map((mo) => ({ motivo: mo, n: regs.filter((r) => r.motivo === mo).length }));
  const maxMotivo = Math.max(1, ...porMotivo.map((x) => x.n));

  const general = zonaFiltro === "TODAS" ? resumen.general : resumen.zonas[zonaFiltro];
  const zonasMostrar = zonaFiltro === "TODAS" ? ["VIRGEN", "RECUBIERTA", "IMPRESA"] : [zonaFiltro];

  return (
    <div className="flex flex-col gap-4">
      {/* Indicadores principales */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Tarjeta className="flex flex-col gap-2 border-slate-700">
          <span className="text-xs font-bold tracking-[.06em] uppercase text-slate-300">Exactitud de inventario</span>
          <span className="text-4xl font-black text-white">{pct1(m.exactitud)}</span>
          <BarraMeta valor={m.exactitud} meta={meta} />
          <Estado valor={m.exactitud} meta={meta} />
          {editandoMeta ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setErrorMeta("");
                try {
                  await onCambiarMeta(Number(metaInput));
                  setEditandoMeta(false);
                } catch (err) {
                  setErrorMeta(err.message);
                }
              }}
              className="flex items-center gap-2 text-xs"
            >
              <label className="flex items-center gap-1 text-slate-300">
                Meta
                <input
                  type="number"
                  min="50"
                  max="100"
                  step="0.5"
                  value={metaInput}
                  onChange={(e) => setMetaInput(e.target.value)}
                  className="w-16 px-2 py-1 rounded-md bg-slate-950 border border-slate-600 text-white"
                />
                %
              </label>
              <button className="px-2 py-1 rounded-md bg-amber-500 text-slate-950 font-bold cursor-pointer">Guardar</button>
              <button type="button" onClick={() => setEditandoMeta(false)} className="text-slate-400 cursor-pointer">
                Cancelar
              </button>
              {errorMeta && <span className="text-red-300">{errorMeta}</span>}
            </form>
          ) : (
            onCambiarMeta && (
              <button
                onClick={() => {
                  setMetaInput(String(meta));
                  setEditandoMeta(true);
                }}
                className="self-start text-xs text-slate-400 underline hover:text-white cursor-pointer"
              >
                Cambiar meta ({meta}%)
              </button>
            )
          )}
        </Tarjeta>
        <Tarjeta className="flex flex-col gap-2">
          <span className="text-xs font-bold tracking-[.06em] uppercase text-slate-300">Desviación</span>
          <span className="text-4xl font-black text-white">{pct1(m.desviacion)}</span>
          <span className="text-sm text-slate-300">
            {num(m.diferenciaAbs)} piezas de diferencia en {num(m.lotesConDiferencia)} lotes
          </span>
          <span className="text-xs text-slate-500">Lo que le falta a la exactitud para llegar al 100%.</span>
        </Tarjeta>
        <Tarjeta className="flex flex-col gap-2">
          <span className="text-xs font-bold tracking-[.06em] uppercase text-slate-300">Piezas contadas</span>
          <span className="text-3xl font-black text-white">{num(m.piezasFisicas)}</span>
          <span className="text-sm text-slate-300">contra {num(m.piezasSap)} según SAP en los mismos lotes</span>
          <span className="text-xs">
            <span className="text-red-300">−{num(m.faltantes)} faltantes</span> · <span className="text-sky-300">+{num(m.sobrantes)} sobrantes</span>
          </span>
        </Tarjeta>
        <Tarjeta className="flex flex-col gap-2">
          <span className="text-xs font-bold tracking-[.06em] uppercase text-slate-300">Avance del conteo</span>
          <span className="text-3xl font-black text-white">{general.avancePiezas}%</span>
          <span className="text-sm text-slate-300">
            de las piezas · {num(general.verificados)} de {num(general.total)} lotes ({general.avance}%)
          </span>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${general.avancePiezas}%` }} />
          </div>
        </Tarjeta>
      </section>

      {/* Avance por proceso: lotes y piezas */}
      <section className={`grid grid-cols-1 gap-3 ${zonasMostrar.length > 1 ? "lg:grid-cols-3" : ""}`}>
        {zonasMostrar.map((z) => (
          <Anillo key={z} titulo={ZONAS[z].titulo} color={ZONAS[z].texto} r={resumen.zonas[z]} />
        ))}
      </section>

      {/* Exactitud por grupo */}
      <Tarjeta className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-bold text-white">Exactitud por {AGRUPACIONES.find((a) => a[0] === por)[1].toLowerCase()}</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-400">
              {por === "DIA" || por === "SEMANA"
                ? "Todos los conteos guardados, según la fecha en que se registró cada lote."
                : "Lotes del conteo seleccionado."}{" "}
              La línea blanca marca la meta de {meta}%.
            </p>
          </div>
          <div role="tablist" aria-label="Agrupar por" className="flex rounded-xl bg-slate-950 border border-slate-700 p-1">
            {AGRUPACIONES.map(([v, t]) => (
              <button
                key={v}
                role="tab"
                aria-selected={por === v}
                onClick={() => cambiarPor(v)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${por === v ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="m-0 text-sm text-slate-500">Todavía no hay lotes contados para mostrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-slate-400 border-b border-slate-800">
                  <th className="py-2 pr-3 font-semibold">{AGRUPACIONES.find((a) => a[0] === por)[1]}</th>
                  <th className="py-2 pr-3 font-semibold w-[34%]">Exactitud</th>
                  <th className="py-2 pr-3 font-semibold text-right">Desviación</th>
                  <th className="py-2 pr-3 font-semibold text-right">Lotes</th>
                  <th className="py-2 pr-3 font-semibold text-right">Piezas SAP</th>
                  <th className="py-2 pr-3 font-semibold text-right">Piezas físicas</th>
                  <th className="py-2 font-semibold text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visibles.map((g) => (
                  <tr
                    key={g.clave}
                    className="hover:bg-slate-800/40"
                    title={`${g.etiqueta}\nExactitud ${pct1(g.exactitud)} · Desviación ${pct1(g.desviacion)}\n${num(g.piezasFisicas)} físicas vs ${num(g.piezasSap)} SAP`}
                  >
                    <td className="py-2.5 pr-3 text-slate-200 max-w-[340px]">
                      <div className="flex items-center gap-2">
                        {por === "PROCESO" && ZONAS[g.clave] && (
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ZONAS[g.clave].grafica }} aria-hidden="true" />
                        )}
                        <span className="truncate">{g.etiqueta}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <BarraMeta valor={g.exactitud} meta={meta} alto={8} />
                        </div>
                        <span className="w-14 text-right font-bold text-white">{pct1(g.exactitud)}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">{pct1(g.desviacion)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">{num(g.lotes)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">{num(g.piezasSap)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">{num(g.piezasFisicas)}</td>
                    <td className="py-2.5 text-right text-slate-300">{num(g.diferenciaAbs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {por === "SKU" && grupos.length > 12 && (
              <button onClick={() => setVerTodos(!verTodos)} className="mt-2 text-xs font-semibold text-amber-300 underline cursor-pointer">
                {verTodos ? "Ver solo los 12 con más desviación" : `Ver los ${grupos.length} SKU`}
              </button>
            )}
          </div>
        )}
      </Tarjeta>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Tarjeta className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-bold text-white">Lotes con mayor diferencia</h2>
          {peores.length === 0 ? (
            <p className="m-0 text-sm text-slate-500">Sin diferencias en los lotes contados.</p>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800">
              {peores.map(({ r, d }) => (
                <div key={r.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-white">{r.lote}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {r.estado === "SOBRANTE" ? "No está en SAP" : r.texto_breve} · {textoUbicacion(r.zona, r.carril, r.posicion)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-sm font-bold ${d < 0 ? "text-red-300" : "text-sky-300"}`}>
                      {d > 0 ? "+" : ""}
                      {num(d)} pzas
                    </span>
                    {r.posicion && (
                      <button onClick={() => onUbicar(r)} className="text-xs font-semibold text-cyan-300 underline cursor-pointer">
                        Ver en el layout
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
        <Tarjeta className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-bold text-white">Observaciones por motivo</h2>
          <div className="flex flex-col gap-2">
            {porMotivo.map(({ motivo, n }) => (
              <div key={motivo} className="grid grid-cols-[150px_1fr_36px] items-center gap-3 text-sm" title={`${motivo}: ${n} lotes`}>
                <span className="text-slate-300 truncate">{motivo}</span>
                <div className="h-3 rounded bg-slate-800 overflow-hidden">
                  {n > 0 && <div className="h-full rounded bg-yellow-400" style={{ width: `${(n / maxMotivo) * 100}%` }} />}
                </div>
                <span className="text-right font-bold text-white">{n}</span>
              </div>
            ))}
          </div>
        </Tarjeta>
      </section>
    </div>
  );
}
