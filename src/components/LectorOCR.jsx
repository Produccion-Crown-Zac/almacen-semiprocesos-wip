// src/components/LectorOCR.jsx
// Lector OCR local (Tesseract.js) para papeletas reimpresas sin código de barras.
// Encuadra el número de bulto impreso, recorta la región, aplica alto contraste y
// cruza el resultado contra el catálogo de lotes SAP para minimizar errores de lectura.
import { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { Camera, Loader2, RotateCcw, X, Check } from "lucide-react";
import { limpiarCodigo } from "../lib/formato";

// Distancia de edición rápida (hasta 2) para sugerir lotes SAP muy parecidos
const distanciaEdicion = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
};

// Extrae tokens candidatos a lote (números de 6-12 dígitos, ECOTAP..., V...)
const extraerCandidatos = (textoRaw) => {
  const sinEspacios = String(textoRaw ?? "").toUpperCase();
  const tokens = sinEspacios.match(/[A-Z0-9-]{5,14}/g) ?? [];
  const limpios = [...new Set(tokens.map(limpiarCodigo).filter((t) => t.length >= 5))];
  // También probar todo junto sin espacios por si el OCR insertó un espacio en medio del lote
  const compacto = limpiarCodigo(sinEspacios.replace(/\s+/g, ""));
  if (compacto.length >= 6 && compacto.length <= 14 && !limpios.includes(compacto)) {
    limpios.unshift(compacto);
  }
  // Priorizar números de 10 dígitos (lote estándar SAP) o prefijos conocidos
  return limpios.sort((a, b) => {
    const score = (s) => (/^\d{10}$/.test(s) ? 3 : /^(ECOTAP\d+|V\d{6,})$/.test(s) ? 2 : /^\d{6,12}$/.test(s) ? 1 : 0);
    return score(b) - score(a);
  });
};

// Preprocesamiento en escala de grises + umbral binario (Otsu) para texto negro sobre papel blanco
const preprocesarCanvas = (ctx, w, h) => {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  const gris = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    gris[p] = g;
    hist[g]++;
  }
  // Umbral de Otsu
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let umbral = 140;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varEntre = wB * wF * (mB - mF) * (mB - mF);
    if (varEntre > maxVar) {
      maxVar = varEntre;
      umbral = t;
    }
  }
  // Ligeramente más estricto para limpiar sombras del papel
  const corte = Math.max(40, umbral - 8);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = gris[p] < corte ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
};

export default function LectorOCR({ sap, zona, onDetectado, onCerrar }) {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const [estado, setEstado] = useState("iniciando"); // iniciando | listo | leyendo | resultado | error
  const [mensajeError, setMensajeError] = useState("");
  const [textoLeido, setTextoLeido] = useState("");
  const [sugerencias, setSugerencias] = useState([]);

  // Abrir cámara trasera
  useEffect(() => {
    let cancelado = false;
    let stream = null;
    const abrir = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setEstado("listo");
      } catch (err) {
        if (cancelado) return;
        setMensajeError(
          String(err).includes("NotAllowed")
            ? "Permiso de cámara denegado. Actívalo en la configuración del navegador."
            : "No se pudo abrir la cámara para OCR: " + String(err)
        );
        setEstado("error");
      }
    };
    abrir();
    return () => {
      cancelado = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Liberar worker de Tesseract al cerrar
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate().catch(() => {});
        workerRef.current = null;
      }
    };
  }, []);

  const asegurarWorker = async () => {
    if (workerRef.current) return workerRef.current;
    const w = await createWorker("eng");
    await w.setParameters({
      tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
      tessedit_pageseg_mode: "7",
    });
    workerRef.current = w;
    return w;
  };

  const capturar = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    setEstado("leyendo");
    setMensajeError("");
    setSugerencias([]);
    setTextoLeido("");

    try {
      // Recortar únicamente la franja central del recuadro guía (80% ancho x 24% alto)
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sx = Math.floor(vw * 0.1);
      const sy = Math.floor(vh * 0.38);
      const sw = Math.floor(vw * 0.8);
      const sh = Math.floor(vh * 0.24);

      const escala = sw < 800 ? 2 : 1;
      const cw = sw * escala;
      const ch = sh * escala;
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
      preprocesarCanvas(ctx, cw, ch);

      const worker = await asegurarWorker();
      const { data } = await worker.recognize(canvas);
      const candidatos = extraerCandidatos(data?.text ?? "");

      if (candidatos.length === 0) {
        setMensajeError("No se detectó ningún número claro. Acerca un poco más la cámara y asegúrate de tener buena luz.");
        setEstado("listo");
        return;
      }

      const activos = sap.filter((s) => s.en_sap);
      // 1. Buscar coincidencia exacta en SAP
      for (const cand of candidatos) {
        if (activos.some((s) => s.lote === cand)) {
          try {
            navigator.vibrate?.(120);
          } catch {
            /* sin vibración */
          }
          onDetectado(cand);
          return;
        }
      }

      // 2. Si no hubo exacta, buscar coincidencias cercanas (hasta 1-2 dígitos de diferencia) en SAP
      const principal = candidatos[0];
      const vistos = new Set();
      const parecidos = [];
      for (const s of activos) {
        if (vistos.has(s.lote)) continue;
        const dist = distanciaEdicion(principal, s.lote);
        if (dist <= 2) {
          vistos.add(s.lote);
          parecidos.push({ s, dist });
        }
      }
      parecidos.sort((a, b) => a.dist - b.dist || (b.s.etapa === zona ? 1 : 0) - (a.s.etapa === zona ? 1 : 0));

      setTextoLeido(principal);
      setSugerencias(parecidos.slice(0, 4).map((p) => p.s));
      setEstado("resultado");
    } catch (err) {
      setMensajeError("Error al leer el número: " + String(err?.message ?? err));
      setEstado("listo");
    }
  };

  return (
    <div className="rounded-xl bg-slate-950 border border-cyan-500/50 p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-cyan-300">Lector de número impreso (OCR)</div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar lector OCR" className="p-1 text-slate-400 hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black aspect-[16/10]">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {/* Máscara con recuadro guía central (80% x 24%) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-[80%] h-[24%] rounded-lg border-2 border-cyan-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.58)] flex items-end justify-center">
            <span className="translate-y-5 text-[10px] font-semibold text-cyan-200 bg-slate-950/80 px-2 py-0.5 rounded">
              Encuadra solo el número de bulto
            </span>
          </div>
        </div>
        {estado === "leyendo" && (
          <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center gap-2 text-cyan-200 text-xs font-bold">
            <Loader2 className="w-6 h-6 animate-spin" />
            Leyendo número…
          </div>
        )}
      </div>

      {mensajeError && <p className="m-0 text-xs text-red-300">{mensajeError}</p>}

      {estado === "resultado" && (
        <div className="rounded-xl bg-slate-900 border border-slate-700 p-2.5 flex flex-col gap-2">
          <div className="text-xs text-slate-400">
            Texto leído: <strong className="font-mono text-white">{textoLeido}</strong>
            {sugerencias.length > 0 ? " · ¿Es alguno de estos lotes en SAP?" : " (no coincide exacto con SAP)"}
          </div>
          {sugerencias.map((s) => (
            <button
              key={s.clave}
              type="button"
              onClick={() => onDetectado(s.lote)}
              className="w-full text-left px-3 py-2 rounded-lg bg-slate-950 border border-cyan-600/60 hover:border-cyan-400 flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="font-mono text-sm font-bold text-white block">{s.lote}</span>
                <span className="text-[11px] text-slate-400 truncate block">{s.texto_breve}</span>
              </span>
              <span className="text-xs font-bold text-cyan-300 shrink-0 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Usar
              </span>
            </button>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onDetectado(textoLeido)}
              className="h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
            >
              Usar {textoLeido}
            </button>
            <button
              type="button"
              onClick={() => setEstado("listo")}
              className="h-10 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reintentar
            </button>
          </div>
        </div>
      )}

      {(estado === "listo" || estado === "iniciando") && (
        <button
          type="button"
          disabled={estado !== "listo"}
          onClick={capturar}
          className="h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
        >
          <Camera className="w-4 h-4" />
          {estado === "iniciando" ? "Abriendo cámara…" : "Capturar número"}
        </button>
      )}
    </div>
  );
}
