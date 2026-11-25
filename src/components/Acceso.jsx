// src/components/Acceso.jsx
// Inicio de sesión y creación del primer administrador.
import { useState } from "react";
import { User, KeyRound, ShieldCheck } from "lucide-react";
import { Auth } from "../api/entities";
import logoProduccion from "../assets/logo-produccion.jpg";

const Campo = ({ etiqueta, icono: Icono, ...props }) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-xs font-bold tracking-wide text-slate-300">{etiqueta}</span>
    <span className="flex items-center gap-2.5 h-12 px-3.5 rounded-xl bg-[#040B1A] border border-slate-500/40 focus-within:border-[#38BDF8] focus-within:ring-2 focus-within:ring-[#00A8FF]/25 transition-colors">
      <Icono className="w-4 h-4 text-[#38BDF8] shrink-0" />
      <input {...props} className="flex-1 min-w-0 bg-transparent text-[15px] text-white outline-none placeholder:text-slate-500" />
    </span>
  </label>
);

export default function Acceso({ hayUsuarios, onEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const primerAdmin = !hayUsuarios;

  const enviar = async (e) => {
    e.preventDefault();
    setError("");
    if (primerAdmin && password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const u = primerAdmin ? await Auth.setup({ usuario: usuario.trim(), nombre: nombre.trim(), password, codigo: codigo.trim() }) : await Auth.login(usuario.trim(), password);
      onEntrar(u);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen mc-bg text-slate-100 flex items-center justify-center p-4 font-sans">
      <form onSubmit={enviar} className="w-full max-w-sm mc-glass mc-enter rounded-3xl p-6 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <img
            src={logoProduccion}
            alt="Producción Crowners - Misión Excelencia Crown Zacatecas"
            className="w-24 h-24 rounded-full object-contain ring-2 ring-[#38BDF8]/50 shadow-[0_0_24px_rgba(0,168,255,0.28)]"
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#38BDF8]">Misión Excelencia · Planta Tapas</span>
          <h1 className="m-0 text-xl font-extrabold text-white tracking-tight">Inventario de semiprocesos</h1>
          <p className="m-0 text-sm text-slate-300">
            {primerAdmin
              ? "Primera vez: crea la cuenta del administrador. Después podrá dar de alta al resto del personal."
              : "Inicia sesión con tu usuario y contraseña."}
          </p>
        </div>

        {primerAdmin && (
          <Campo etiqueta="Código de instalación" icono={ShieldCheck} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="El que configuraste en Cloudflare" autoComplete="off" required />
        )}
        <Campo etiqueta="Usuario" icono={User} value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" placeholder="Ej. número de empleado" required />
        {primerAdmin && <Campo etiqueta="Nombre completo" icono={User} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Como aparecerá en la bitácora" required />}
        <Campo
          etiqueta="Contraseña"
          icono={KeyRound}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={primerAdmin ? "new-password" : "current-password"}
          placeholder={primerAdmin ? "Mínimo 8 caracteres" : ""}
          required
        />
        {primerAdmin && (
          <Campo etiqueta="Confirmar contraseña" icono={KeyRound} type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required />
        )}

        {error && (
          <p role="alert" className="m-0 rounded-xl bg-red-500/15 border border-red-400/40 text-red-200 text-sm px-3 py-2.5">
            {error}
          </p>
        )}

        <button
          disabled={enviando}
          className="h-12 rounded-xl bg-[#00A8FF] hover:bg-[#38BDF8] disabled:opacity-50 text-[#040B1A] font-extrabold tracking-wide shadow-[0_8px_20px_-6px_rgba(0,168,255,0.6)] transition-colors cursor-pointer"
        >
          {enviando ? "Verificando…" : primerAdmin ? "Crear administrador y entrar" : "Entrar"}
        </button>
        {!primerAdmin && <p className="m-0 text-center text-xs text-slate-400">¿Olvidaste tu contraseña? Pide a un administrador que la restablezca.</p>}
      </form>
    </div>
  );
}
