// src/components/Usuarios.jsx
// Administración de usuarios (solo perfil Administrador) y cambio de contraseña propio.
import { useCallback, useEffect, useState } from "react";
import { UserPlus, KeyRound, X } from "lucide-react";
import { Auth, Usuarios as UsuariosApi } from "../api/entities";
import { fecha } from "../lib/formato";

const ROLES = {
  ADMIN: { nombre: "Administrador", detalle: "Todo, incluida la administración de usuarios", color: "bg-amber-500/20 text-amber-200 border border-amber-500/40" },
  USUARIO: { nombre: "Usuario", detalle: "Todo, excepto administrar usuarios", color: "bg-sky-500/15 text-sky-200 border border-sky-500/40" },
};

const Entrada = ({ etiqueta, ...props }) => (
  <label className="flex flex-col gap-1">
    <span className="text-xs font-bold text-slate-300">{etiqueta}</span>
    <input {...props} className="h-11 px-3 rounded-xl bg-slate-950 border border-slate-600 text-sm text-white outline-none focus:border-amber-400" />
  </label>
);

const Modal = ({ titulo, onCerrar, children }) => (
  <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={titulo}>
    <section className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-bold text-white">{titulo}</h2>
        <button onClick={onCerrar} aria-label="Cerrar" className="p-2 text-slate-400 hover:text-white cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      {children}
    </section>
  </div>
);

export function CambiarPassword({ onCerrar }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [msg, setMsg] = useState(null);
  const enviar = async (e) => {
    e.preventDefault();
    if (nueva !== confirmar) return setMsg({ error: "Las contraseñas nuevas no coinciden." });
    try {
      await Auth.cambiarPassword(actual, nueva);
      setMsg({ ok: "Contraseña actualizada. Las demás sesiones abiertas con tu cuenta se cerraron." });
      setActual("");
      setNueva("");
      setConfirmar("");
    } catch (err) {
      setMsg({ error: err.message });
    }
  };
  return (
    <Modal titulo="Cambiar mi contraseña" onCerrar={onCerrar}>
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <Entrada etiqueta="Contraseña actual" type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" required />
        <Entrada etiqueta="Contraseña nueva (mínimo 8 caracteres)" type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" required />
        <Entrada etiqueta="Confirmar contraseña nueva" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required />
        {msg?.error && <p className="m-0 text-sm text-red-300">{msg.error}</p>}
        {msg?.ok && <p className="m-0 text-sm text-emerald-300">{msg.ok}</p>}
        <button className="h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold cursor-pointer">Guardar</button>
      </form>
    </Modal>
  );
}

export default function Usuarios({ yo }) {
  const [lista, setLista] = useState([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [nuevo, setNuevo] = useState({ usuario: "", nombre: "", rol: "USUARIO", password: "" });
  const [restablecer, setRestablecer] = useState(null); // usuario
  const [passNueva, setPassNueva] = useState("");

  const cargar = useCallback(async () => {
    try {
      setLista(await UsuariosApi.list());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(cargar);
  }, [cargar]);

  const accion = async (fn, mensaje) => {
    setError("");
    setAviso("");
    try {
      await fn();
      setAviso(mensaje);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  };

  const crear = (e) => {
    e.preventDefault();
    accion(async () => {
      await UsuariosApi.crear({ ...nuevo, usuario: nuevo.usuario.trim(), nombre: nuevo.nombre.trim() });
      setNuevo({ usuario: "", nombre: "", rol: "USUARIO", password: "" });
    }, `Se creó el usuario ${nuevo.usuario.trim()}.`);
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-1">
        <h1 className="m-0 text-xl font-bold text-white">Usuarios</h1>
        <p className="m-0 text-sm text-slate-400">
          Solo los administradores ven este apartado. Hay dos perfiles: <strong className="text-amber-200">Administrador</strong> (todo, incluida la
          administración de usuarios) y <strong className="text-sky-200">Usuario</strong> (todo lo demás).
        </p>
      </section>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm px-4 py-3">{error}</div>}
      {aviso && <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3">{aviso}</div>}

      <form onSubmit={crear} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
        <h2 className="m-0 text-base font-bold text-white flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-amber-400" /> Nuevo usuario
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Entrada etiqueta="Usuario de acceso" value={nuevo.usuario} onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value })} placeholder="Ej. 1230142" required />
          <Entrada etiqueta="Nombre completo" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-300">Perfil</span>
            <select
              value={nuevo.rol}
              onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}
              className="h-11 px-3 rounded-xl bg-slate-950 border border-slate-600 text-sm text-white"
            >
              <option value="USUARIO">Usuario</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </label>
          <Entrada
            etiqueta="Contraseña inicial"
            type="password"
            value={nuevo.password}
            onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
            required
          />
        </div>
        <p className="m-0 text-xs text-slate-500">El usuario puede llevar letras, números, punto, guion o guion bajo (3 a 40 caracteres). Entrega la contraseña inicial en persona y pide que la cambie al entrar.</p>
        <button className="self-start h-11 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold cursor-pointer">Crear usuario</button>
      </form>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 bg-slate-950/50">
                <th className="p-3">Usuario</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Perfil</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Alta</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {lista.map((u) => (
                <tr key={u.id} className={u.activo ? "" : "opacity-60"}>
                  <td className="p-3 font-mono font-bold text-white">
                    {u.usuario}
                    {u.id === yo.id && <span className="ml-2 font-sans text-[11px] text-slate-400">(tú)</span>}
                  </td>
                  <td className="p-3 text-slate-200">{u.nombre}</td>
                  <td className="p-3">
                    <select
                      aria-label={`Perfil de ${u.usuario}`}
                      value={u.rol}
                      onChange={(e) => accion(() => UsuariosApi.actualizar(u.id, { rol: e.target.value }), `Perfil de ${u.usuario} actualizado.`)}
                      className={`px-2 py-1 rounded-lg text-xs font-bold cursor-pointer ${ROLES[u.rol].color} bg-transparent`}
                    >
                      <option value="USUARIO" className="bg-slate-900 text-white">
                        Usuario
                      </option>
                      <option value="ADMIN" className="bg-slate-900 text-white">
                        Administrador
                      </option>
                    </select>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${u.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                      {u.activo ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-slate-400">{fecha(u.creado_en)}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => {
                          setRestablecer(u);
                          setPassNueva("");
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" /> Restablecer contraseña
                      </button>
                      {u.id !== yo.id && (
                        <button
                          onClick={() =>
                            accion(() => UsuariosApi.actualizar(u.id, { activo: !u.activo }), `${u.usuario} ${u.activo ? "desactivado" : "reactivado"}.`)
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                            u.activo ? "text-red-300 hover:bg-red-500/10" : "text-emerald-300 hover:bg-emerald-500/10"
                          }`}
                        >
                          {u.activo ? "Desactivar" : "Reactivar"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {restablecer && (
        <Modal titulo={`Restablecer contraseña de ${restablecer.usuario}`} onCerrar={() => setRestablecer(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const u = restablecer;
              accion(() => UsuariosApi.actualizar(u.id, { password: passNueva }), `Contraseña de ${u.usuario} restablecida. Sus sesiones abiertas se cerraron.`);
              setRestablecer(null);
            }}
            className="flex flex-col gap-3"
          >
            <Entrada etiqueta="Contraseña nueva (mínimo 8 caracteres)" type="password" value={passNueva} onChange={(e) => setPassNueva(e.target.value)} autoComplete="new-password" required />
            <button className="h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold cursor-pointer">Restablecer</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
