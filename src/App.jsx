// src/App.jsx
// Puerta de entrada: verifica la sesión. Sin sesión muestra el inicio de sesión
// (o la creación del primer administrador); con sesión, la aplicación de inventario.
import { useCallback, useEffect, useState } from "react";
import { Auth, alPerderSesion } from "./api/entities";
import Acceso from "./components/Acceso";
import Inventario from "./components/Inventario";

export default function App() {
  const [estado, setEstado] = useState({ cargando: true, usuario: null, hayUsuarios: true, error: "" });

  const revisar = useCallback(async () => {
    try {
      const [yo, e] = await Promise.all([Auth.yo(), Auth.estado()]);
      setEstado({ cargando: false, usuario: yo, hayUsuarios: e.hayUsuarios, error: "" });
    } catch (err) {
      setEstado((s) => ({ ...s, cargando: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(revisar);
    return alPerderSesion(() => setEstado((s) => ({ ...s, usuario: null })));
  }, [revisar]);

  if (estado.cargando) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-sans">Cargando…</div>;

  if (estado.error && !estado.usuario)
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md rounded-2xl bg-red-500/10 border border-red-500/30 text-red-200 p-5 text-sm flex flex-col gap-3">
          <strong className="text-red-100">No se pudo conectar con el servidor.</strong>
          <span>{estado.error}</span>
          <button onClick={revisar} className="self-start px-4 py-2 rounded-lg bg-red-500/20 text-red-100 font-bold cursor-pointer">
            Reintentar
          </button>
        </div>
      </div>
    );

  if (!estado.usuario) return <Acceso hayUsuarios={estado.hayUsuarios} onEntrar={(u) => setEstado({ cargando: false, usuario: u, hayUsuarios: true, error: "" })} />;

  return (
    <Inventario
      key={estado.usuario.id}
      usuario={estado.usuario}
      onCerrarSesion={async () => {
        try {
          await Auth.logout();
        } finally {
          setEstado((s) => ({ ...s, usuario: null }));
        }
      }}
    />
  );
}
