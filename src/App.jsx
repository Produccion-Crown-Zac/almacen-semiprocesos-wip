// src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Html5QrcodeScanner } from "html5-qrcode";
import { LoteLamina, MovimientoKardex } from "./api/entities";
import {
  Layers,
  PlusCircle,
  Scissors,
  ArrowRightCircle,
  AlertTriangle,
  CheckCircle2,
  Package,
  History,
  Filter,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  Download,
  Link2,
  QrCode,
  Camera,
  Smartphone,
  Monitor,
  Search,
  Ruler,
  Printer,
  Check,
  XCircle,
} from "lucide-react";

const SIGUIENTE_ETAPA = {
  VIRGEN: "RECUBIERTA",
  RECUBIERTA: "IMPRESA",
  IMPRESA: "TROQUELADO",
};

const normalizarFilaExcel = (fila, index) => {
  const obtenerValor = (posiblesNombres) => {
    const claveEncontrada = Object.keys(fila).find((k) =>
      posiblesNombres.includes(
        k
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
      )
    );
    return claveEncontrada ? fila[claveEncontrada] : undefined;
  };

  const codigoRaw = obtenerValor(["lote", "codigo_lote", "codigo", "id", "tarima"]);
  const tipoRaw = String(
    obtenerValor(["tipo", "tipo_lamina", "tipo de lamina", "etapa", "estado", "proceso", "texto breve de material"]) || "VIRGEN"
  ).toUpperCase();
  const calibreRaw = String(obtenerValor(["calibre", "cal", "espesor"]) || "70").trim();
  const cantidadRaw = Number(
    obtenerValor(["cantidad", "laminas", "cantidad_actual", "piezas", "hojas", "libre utilizacion"]) || 1500
  );
  const ubicacionRaw = obtenerValor(["ubicacion", "ubicacion_rack", "rack", "zona", "almacen"]);
  const disenoRaw = obtenerValor(["diseno", "sku", "diseno_sku", "arte", "recubrimiento", "material"]);

  let etapaNormalizada = "VIRGEN";
  if (tipoRaw.includes("RECUB")) etapaNormalizada = "RECUBIERTA";
  else if (tipoRaw.includes("IMPR") || tipoRaw.includes("ESTAMP")) etapaNormalizada = "IMPRESA";
  else if (tipoRaw.includes("TROQ")) etapaNormalizada = "TROQUELADO";

  const calibreNormalizado = calibreRaw.includes("75") || tipoRaw.includes("75") ? "75" : "70";
  const prefijoBuffer =
    etapaNormalizada === "VIRGEN" ? "B1" : etapaNormalizada === "RECUBIERTA" ? "B2" : "B3";

  return {
    codigo_lote: codigoRaw ? String(codigoRaw).trim().toUpperCase() : `LOT-SAP-${index + 1}`,
    calibre: calibreNormalizado,
    etapa: etapaNormalizada,
    cantidad_inicial: cantidadRaw > 1500 ? cantidadRaw : 1500,
    cantidad_actual: cantidadRaw,
    ubicacion_rack: ubicacionRaw
      ? String(ubicacionRaw).trim()
      : `${prefijoBuffer}-C${calibreNormalizado}-R01`,
    diseno_sku: disenoRaw
      ? String(disenoRaw).trim()
      : etapaNormalizada === "VIRGEN"
      ? "SIN-IMPRESION"
      : "ESTANDAR-SAP",
  };
};

export default function App() {
  const [vistaActiva, setVistaActiva] = useState("DASHBOARD"); // DASHBOARD | AUDITORIA_MOVIL
  const [lotes, setLotes] = useState([]);
  const [kardex, setKardex] = useState([]);
  const [filtroCalibre, setFiltroCalibre] = useState("TODOS");
  const [filtroEtapa, setFiltroEtapa] = useState("TODAS");

  // Estados de Sincronización con Excel / SAP
  const [modalExcel, setModalExcel] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [urlExcelNube, setUrlExcelNube] = useState(
    localStorage.getItem("url_excel_wip") || ""
  );
  const [ultimaSync, setUltimaSync] = useState(
    localStorage.getItem("ultima_sync_wip") || "Sin sincronizar aún"
  );
  const fileInputRef = useRef(null);

  // Estados del Modo Escáner Móvil (Auditoría de Inventario)
  const [codigoBuscado, setCodigoBuscado] = useState("");
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [loteEscaneado, setLoteEscaneado] = useState(null);
  const [conteoFisicoInput, setConteoFisicoInput] = useState("");
  const [alturaPilaMm, setAlturaPilaMm] = useState("");
  const [loteEtiquetaModal, setLoteEtiquetaModal] = useState(null);

  // Modal Crear Lote y Procesar
  const [modalNuevo, setModalNuevo] = useState(false);
  const [nuevoLote, setNuevoLote] = useState({
    codigo_lote: "",
    calibre: "70",
    cantidad_inicial: 1500,
    ubicacion_rack: "B1-C70-R01",
  });
  const [loteSeleccionado, setLoteSeleccionado] = useState(null);
  const [modoOperacion, setModoOperacion] = useState("COMPLETO");
  const [datosProceso, setDatosProceso] = useState({
    laminas_procesadas: 1500,
    merma: 0,
    nueva_ubicacion: "",
    diseno_sku: "",
  });

  const cargarDatos = async () => {
    const listaLotes = await LoteLamina.list();
    const listaKardex = await MovimientoKardex.list();
    const ordenados = [...listaLotes].sort((a, b) => {
      if (a.es_parcial !== b.es_parcial) return a.es_parcial ? -1 : 1;
      return new Date(a.created_date) - new Date(b.created_date);
    });
    setLotes(ordenados);
    setKardex(listaKardex);
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  // Control de Cámara Lectora de Código de Barras / QR en Celular
  useEffect(() => {
    let scanner = null;
    if (camaraActiva && vistaActiva === "AUDITORIA_MOVIL") {
      scanner = new Html5QrcodeScanner(
        "lector-camara-wip",
        { fps: 10, qrbox: { width: 250, height: 150 } },
        false
      );
      scanner.render(
        (textoDecodificado) => {
          const codigoLimpio = textoDecodificado.trim().toUpperCase();
          setCodigoBuscado(codigoLimpio);
          buscarLotePorCodigo(codigoLimpio);
          setCamaraActiva(false);
          scanner.clear();
        },
        () => {}
      );
    }
    return () => {
      if (scanner) {
        scanner.clear().catch(() => {});
      }
    };
  }, [camaraActiva, vistaActiva]);

  const buscarLotePorCodigo = (codigo) => {
    const limpio = String(codigo).trim().toUpperCase();
    const encontrado = lotes.find(
      (l) => String(l.codigo_lote).toUpperCase() === limpio
    );
    if (encontrado) {
      setLoteEscaneado(encontrado);
      setConteoFisicoInput(String(encontrado.cantidad_actual));
      setAlturaPilaMm("");
    } else {
      setLoteEscaneado({ noEncontrado: true, codigo: limpio });
    }
  };

  // Calculadora rápida por altura de estiba (evita contar láminas una por una)
  const calcularPorAltura = (mm, calibre) => {
    setAlturaPilaMm(mm);
    if (!mm || isNaN(mm)) return;
    // Espesor aproximado en mm (ajustable al estándar exacto de tu planta)
    const espesorMm = calibre === "75" ? 0.28 : 0.25;
    const estimadas = Math.round(Number(mm) / espesorMm);
    setConteoFisicoInput(String(estimadas));
  };

  // Confirmar Verificación de Inventario desde el Celular
  const handleConfirmarAuditoriaLote = async (ajustarInventario = false) => {
    if (!loteEscaneado || loteEscaneado.noEncontrado) return;

    const cantFisica = Number(conteoFisicoInput);
    const coincide = cantFisica === Number(loteEscaneado.cantidad_actual);
    const nuevoEstadoVerif = coincide ? "OK" : "DISCREPANCIA";

    const cambios = {
      verificado_fisico: nuevoEstadoVerif,
      cantidad_fisica: cantFisica,
    };

    if (ajustarInventario && !coincide) {
      cambios.cantidad_actual = cantFisica;
      cambios.es_parcial = cantFisica < 1500;
      cambios.verificado_fisico = "OK";
    }

    await LoteLamina.update(loteEscaneado.id, cambios);

    await MovimientoKardex.create({
      codigo_lote: loteEscaneado.codigo_lote,
      accion: coincide ? "VERIFICACIÓN MÓVIL OK" : "DISCREPANCIA EN AUDITORÍA",
      detalle: coincide
        ? `Confirmado en piso: ${cantFisica} láminas (Cal. ${loteEscaneado.calibre} - ${loteEscaneado.etapa}).`
        : `SAP decía ${loteEscaneado.cantidad_actual} lms vs Físico ${cantFisica} lms.${
            ajustarInventario ? " Se ajustó inventario al conteo físico." : ""
          }`,
    });

    await cargarDatos();
    setLoteEscaneado(null);
    setCodigoBuscado("");
  };

  // --- Pegar directo desde SAP (Portapapeles) ---
  const handlePegarDesdeSAP = async () => {
    setSincronizando(true);
    try {
      const textoPortapapeles = await navigator.clipboard.readText();
      if (!textoPortapapeles || !textoPortapapeles.trim()) {
        alert("El portapapeles está vacío. Copia primero las celdas en SAP.");
        setSincronizando(false);
        return;
      }

      const lineasLimpias = textoPortapapeles
        .split(/\r?\n/)
        .filter((l) => !l.startsWith("---") && l.trim().length > 0)
        .map((l) =>
          l.startsWith("|")
            ? l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t")
            : l
        )
        .join("\n");

      const workbook = XLSX.read(lineasLimpias, { type: "string" });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filasJson = XLSX.utils.sheet_to_json(hoja);

      if (filasJson.length === 0) {
        alert("No se detectaron filas válidas en el portapapeles.");
        setSincronizando(false);
        return;
      }

      const filasNormalizadas = filasJson.map((f, idx) =>
        normalizarFilaExcel(f, idx)
      );
      const resultado = await LoteLamina.syncFromExcel(filasNormalizadas);

      const horaActual = new Date().toLocaleTimeString();
      localStorage.setItem("ultima_sync_wip", `SAP Portapapeles (${horaActual})`);
      setUltimaSync(`SAP Portapapeles (${horaActual})`);

      await MovimientoKardex.create({
        codigo_lote: "SYNC-SAP",
        accion: "ACTUALIZACIÓN DIRECTA SAP",
        detalle: `${resultado.creados} lotes nuevos y ${resultado.actualizados} actualizados.`,
      });

      await cargarDatos();
      setModalExcel(false);
    } catch (err) {
      alert("Permite el acceso al portapapeles en tu navegador: " + err.message);
    } finally {
      setSincronizando(false);
    }
  };

  // --- Subir archivo Excel ---
  const handleSubirArchivoExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSincronizando(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filasJson = XLSX.utils.sheet_to_json(hoja);

      const filasNormalizadas = filasJson.map((f, idx) =>
        normalizarFilaExcel(f, idx)
      );
      const resultado = await LoteLamina.syncFromExcel(filasNormalizadas);

      const horaActual = new Date().toLocaleTimeString();
      localStorage.setItem("ultima_sync_wip", `Archivo: ${file.name} (${horaActual})`);
      setUltimaSync(`Archivo: ${file.name} (${horaActual})`);

      await MovimientoKardex.create({
        codigo_lote: "SYNC-EXCEL",
        accion: "ACTUALIZACIÓN DESDE EXCEL",
        detalle: `${resultado.creados} nuevos y ${resultado.actualizados} actualizados.`,
      });

      await cargarDatos();
      setModalExcel(false);
    } catch (err) {
      alert("Error al leer Excel: " + err.message);
    } finally {
      setSincronizando(false);
      e.target.value = "";
    }
  };

  // --- Actualizar 1-Clic desde Nube ---
  const handleActualizarEnUnClic = async () => {
    if (!urlExcelNube.trim()) {
      setModalExcel(true);
      return;
    }

    setSincronizando(true);
    try {
      let urlFetch = urlExcelNube.trim();
      if (urlFetch.includes("docs.google.com/spreadsheets")) {
        const match = urlFetch.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
          urlFetch = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
        }
      } else if (
        urlFetch.includes("1drv.ms") ||
        urlFetch.includes("sharepoint.com") ||
        urlFetch.includes("onedrive.live.com")
      ) {
        if (!urlFetch.includes("download=1")) {
          urlFetch += (urlFetch.includes("?") ? "&" : "?") + "download=1";
        }
      }

      const respuesta = await fetch(urlFetch);
      const arrayBuffer = await respuesta.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filasJson = XLSX.utils.sheet_to_json(hoja);

      const filasNormalizadas = filasJson.map((f, idx) =>
        normalizarFilaExcel(f, idx)
      );
      const resultado = await LoteLamina.syncFromExcel(filasNormalizadas);

      const horaActual = new Date().toLocaleTimeString();
      localStorage.setItem("ultima_sync_wip", `Nube (${horaActual})`);
      setUltimaSync(`Nube (${horaActual})`);

      await cargarDatos();
      setModalExcel(false);
    } catch (err) {
      alert("Verifica que el enlace tenga permiso público de lectura.");
    } finally {
      setSincronizando(false);
    }
  };

  const handleDescargarPlantillaExcel = () => {
    const datosEjemplo = [
      {
        Lote: "LOT-101",
        Calibre: 70,
        "Tipo Lamina": "Lámina Virgen",
        Cantidad: 1320,
        Ubicacion: "B1-C70-R01",
        Diseño: "SIN-IMPRESION",
      },
      {
        Lote: "LOT-205",
        Calibre: 75,
        "Tipo Lamina": "Lámina Virgen",
        Cantidad: 1500,
        Ubicacion: "B1-C75-R03",
        Diseño: "SIN-IMPRESION",
      },
      {
        Lote: "LOT-206",
        Calibre: 70,
        "Tipo Lamina": "Lámina Recubierta",
        Cantidad: 950,
        Ubicacion: "B2-PICOS-02",
        Diseño: "BARNIZ-EPÓXICO",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(datosEjemplo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario_WIP");
    XLSX.writeFile(wb, "Inventario_Laminas_WIP.xlsx");
  };

  const handleCrearLote = async (e) => {
    e.preventDefault();
    const cant = Number(nuevoLote.cantidad_inicial) || 1500;
    const codigo =
      nuevoLote.codigo_lote.trim().toUpperCase() ||
      `LOT-${Math.floor(100 + Math.random() * 900)}`;

    await LoteLamina.create({
      codigo_lote: codigo,
      lote_padre: "",
      calibre: nuevoLote.calibre,
      etapa: "VIRGEN",
      cantidad_inicial: cant,
      cantidad_actual: cant,
      merma_acumulada: 0,
      es_parcial: cant < 1500,
      ubicacion_rack: nuevoLote.ubicacion_rack,
      diseno_sku: "SIN-IMPRESION",
      estado_operativo: "DISPONIBLE",
    });

    setModalNuevo(false);
    cargarDatos();
  };

  const abrirModalProceso = (lote, modo) => {
    const sigEtapa = SIGUIENTE_ETAPA[lote.etapa];
    const prefijoBuffer =
      sigEtapa === "RECUBIERTA" ? "B2" : sigEtapa === "IMPRESA" ? "B3" : "TRQ";

    setLoteSeleccionado(lote);
    setModoOperacion(modo);
    setDatosProceso({
      laminas_procesadas:
        modo === "COMPLETO"
          ? lote.cantidad_actual
          : Math.floor(lote.cantidad_actual / 2),
      merma: 0,
      nueva_ubicacion: `${prefijoBuffer}-C${lote.calibre}-R01`,
      diseno_sku:
        sigEtapa === "RECUBIERTA"
          ? "BARNIZ-ESTANDAR"
          : sigEtapa === "IMPRESA"
          ? "ARTE-ESTANDAR"
          : lote.diseno_sku,
    });
  };

  const handleEjecutarProceso = async (e) => {
    e.preventDefault();
    if (!loteSeleccionado) return;

    const procesadas = Number(datosProceso.laminas_procesadas);
    const merma = Number(datosProceso.merma);
    const sigEtapa = SIGUIENTE_ETAPA[loteSeleccionado.etapa];

    if (
      modoOperacion === "COMPLETO" ||
      procesadas === loteSeleccionado.cantidad_actual
    ) {
      const nuevaCant = loteSeleccionado.cantidad_actual - merma;
      await LoteLamina.update(loteSeleccionado.id, {
        etapa: sigEtapa,
        cantidad_actual: nuevaCant,
        merma_acumulada: (loteSeleccionado.merma_acumulada || 0) + merma,
        ubicacion_rack: datosProceso.nueva_ubicacion,
        diseno_sku: datosProceso.diseno_sku || loteSeleccionado.diseno_sku,
      });
    } else {
      const saldoEnRack = loteSeleccionado.cantidad_actual - procesadas;
      const buenasAvanzan = procesadas - merma;
      const codigoHijo = `${loteSeleccionado.codigo_lote}-A`;

      await LoteLamina.update(loteSeleccionado.id, {
        cantidad_actual: saldoEnRack,
        es_parcial: true,
      });

      await LoteLamina.create({
        codigo_lote: codigoHijo,
        lote_padre: loteSeleccionado.codigo_lote,
        calibre: loteSeleccionado.calibre,
        etapa: sigEtapa,
        cantidad_inicial: procesadas,
        cantidad_actual: buenasAvanzan,
        merma_acumulada: merma,
        es_parcial: true,
        ubicacion_rack: datosProceso.nueva_ubicacion,
        diseno_sku: datosProceso.diseno_sku || loteSeleccionado.diseno_sku,
        estado_operativo: "DISPONIBLE",
      });
    }

    setLoteSeleccionado(null);
    cargarDatos();
  };

  const lotesFiltrados = lotes.filter((l) => {
    if (l.etapa === "TROQUELADO") return filtroEtapa === "TROQUELADO";
    const pasaCalibre =
      filtroCalibre === "TODOS" || l.calibre === filtroCalibre;
    const pasaEtapa = filtroEtapa === "TODAS" || l.etapa === filtroEtapa;
    return pasaCalibre && pasaEtapa;
  });

  const totalPorEtapa = (etapa) =>
    lotes
      .filter((l) => l.etapa === etapa)
      .reduce((acc, el) => acc + Number(el.cantidad_actual), 0);

  const lotesActivos = lotes.filter((l) => l.etapa !== "TROQUELADO");
  const lotesVerificados = lotesActivos.filter(
    (l) => l.verificado_fisico && l.verificado_fisico !== "PENDIENTE"
  ).length;
  const porcentajeAuditoria =
    lotesActivos.length > 0
      ? Math.round((lotesVerificados / lotesActivos.length) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans">
      {/* Selector Superior de Modo: Vista PC vs Modo Escáner Celular */}
      <div className="max-w-7xl mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVistaActiva("DASHBOARD")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              vistaActiva === "DASHBOARD"
                ? "bg-amber-500 text-slate-950 shadow"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Monitor className="w-4 h-4" />
            Tablero General (PC / Almacén)
          </button>

          <button
            onClick={() => setVistaActiva("AUDITORIA_MOVIL")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              vistaActiva === "AUDITORIA_MOVIL"
                ? "bg-emerald-500 text-slate-950 shadow"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            Modo Escáner Inventario (Celular)
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            Avance de Inventario Físico:{" "}
            <strong className="text-emerald-400">
              {lotesVerificados} / {lotesActivos.length} tarimas ({porcentajeAuditoria}%)
            </strong>
          </span>
        </div>
      </div>

      {/* =====================================================================
          VISTA 1: MODO ESCÁNER DE INVENTARIO PARA CELULAR (CÓDIGO DE BARRAS/QR)
         ===================================================================== */}
      {vistaActiva === "AUDITORIA_MOVIL" ? (
        <div className="max-w-lg mx-auto space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase text-emerald-400">
                  Verificación Rápida en Piso
                </span>
                <h2 className="text-xl font-bold text-white">
                  Escanear Lote de Lámina
                </h2>
              </div>
              <QrCode className="w-8 h-8 text-emerald-400" />
            </div>

            {/* Botón para abrir la cámara del celular */}
            <button
              onClick={() => setCamaraActiva(!camaraActiva)}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3.5 rounded-xl shadow-lg text-sm transition cursor-pointer"
            >
              <Camera className="w-5 h-5" />
              {camaraActiva
                ? "Cerrar Cámara Escáner"
                : "Abrir Cámara para Escanear Código"}
            </button>

            {camaraActiva && (
              <div
                id="lector-camara-wip"
                className="overflow-hidden rounded-xl border border-slate-700 bg-black"
              />
            )}

            {/* Buscador manual o con pistola láser Bluetooth */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                buscarLotePorCodigo(codigoBuscado);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Escribe o escanea ej. LOT-101"
                value={codigoBuscado}
                onChange={(e) => setCodigoBuscado(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white font-mono uppercase"
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 rounded-xl flex items-center gap-1 text-sm cursor-pointer"
              >
                <Search className="w-4 h-4" /> Buscar
              </button>
            </form>

            {/* Botones rápidos de prueba para tocar en el celular */}
            <div className="pt-1">
              <span className="text-[11px] text-slate-400 block mb-1.5">
                Toque rápido para simular lectura de código en celular:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {lotesActivos.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      setCodigoBuscado(l.codigo_lote);
                      buscarLotePorCodigo(l.codigo_lote);
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono cursor-pointer"
                  >
                    {l.codigo_lote}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tarjeta de Resultado al Escanear el Lote */}
          {loteEscaneado && (
            <div className="bg-slate-900 border-2 border-emerald-500/60 rounded-2xl p-5 space-y-4 shadow-2xl">
              {loteEscaneado.noEncontrado ? (
                <div className="text-center py-4 space-y-2">
                  <XCircle className="w-12 h-12 text-red-400 mx-auto" />
                  <h3 className="text-lg font-bold text-red-400">
                    Lote {loteEscaneado.codigo} NO existe en SAP
                  </h3>
                  <p className="text-xs text-slate-400">
                    Esta tarima está físicamente en piso pero no aparece en la última carga de datos.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                    <div>
                      <span className="text-xs text-slate-400">Lote Escaneado</span>
                      <h3 className="text-2xl font-black text-white">
                        {loteEscaneado.codigo_lote}
                      </h3>
                      <span className="text-xs text-amber-400 font-mono">
                        Ubicación SAP: {loteEscaneado.ubicacion_rack}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="px-3 py-1 rounded-lg text-sm font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 block">
                        Calibre {loteEscaneado.calibre}
                      </span>
                      <span className="text-xs font-bold text-emerald-400 mt-1 block">
                        {loteEscaneado.etapa}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-xs text-slate-400 block">
                        Cantidad según SAP:
                      </span>
                      <strong className="text-xl font-black text-white">
                        {Number(loteEscaneado.cantidad_actual).toLocaleString()} lms
                      </strong>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block">
                        Tipo de Tarima:
                      </span>
                      <strong className="text-sm font-bold text-amber-400">
                        {loteEscaneado.es_parcial
                          ? "Pico / Saldo (<1500)"
                          : "Lote Completo (1500)"}
                      </strong>
                    </div>
                  </div>

                  {/* Calculadora de láminas por altura con flexómetro */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400">
                      <Ruler className="w-4 h-4" />
                      ¿Es un lote parcial? Calcula láminas midiendo altura:
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="Altura de pila en mm (ej. 210)"
                        value={alturaPilaMm}
                        onChange={(e) =>
                          calcularPorAltura(e.target.value, loteEscaneado.calibre)
                        }
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                      <span className="text-[11px] text-slate-400">
                        mm (Cal. {loteEscaneado.calibre})
                      </span>
                    </div>
                  </div>

                  {/* Confirmación de cantidad física */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Cantidad Física Real en Tarima:
                    </label>
                    <input
                      type="number"
                      value={conteoFisicoInput}
                      onChange={(e) => setConteoFisicoInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg font-bold text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 pt-2">
                    <button
                      onClick={() => handleConfirmarAuditoriaLote(false)}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3 rounded-xl text-sm cursor-pointer"
                    >
                      <Check className="w-5 h-5" />
                      Confirmar Inventario ({conteoFisicoInput} láminas)
                    </button>

                    {Number(conteoFisicoInput) !==
                      Number(loteEscaneado.cantidad_actual) && (
                      <button
                        onClick={() => handleConfirmarAuditoriaLote(true)}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs cursor-pointer"
                      >
                        Corregir cantidad en Sistema a {conteoFisicoInput} láminas
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lista rápida de lotes pendientes por escanear en el pasillo */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">
                Checklist de Tarimas en Almacén
              </h3>
              <button
                onClick={async () => {
                  await LoteLamina.reiniciarAuditoria();
                  cargarDatos();
                }}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Reiniciar conteo
              </button>
            </div>
            <div className="space-y-2">
              {lotesActivos.map((l) => (
                <div
                  key={l.id}
                  onClick={() => {
                    setCodigoBuscado(l.codigo_lote);
                    buscarLotePorCodigo(l.codigo_lote);
                  }}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700"
                >
                  <div>
                    <div className="font-bold text-sm text-white flex items-center gap-2">
                      {l.codigo_lote}
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        Cal. {l.calibre} • {l.etapa}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      Rack: {l.ubicacion_rack} • SAP: {l.cantidad_actual} pzas
                    </div>
                  </div>
                  <div>
                    {l.verificado_fisico === "OK" ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ✓ Verificado
                      </span>
                    ) : l.verificado_fisico === "DISCREPANCIA" ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        ⚠ Diferencia ({l.cantidad_fisica})
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[11px] bg-slate-800 text-slate-400">
                        Pendiente
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* =====================================================================
           VISTA 2: DASHBOARD COMPLETO EN PC + SINCRONIZACIÓN SAP/EXCEL
           ===================================================================== */
        <>
          <header className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800 pb-5 mb-6">
            <div>
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
                <Layers className="w-4 h-4" /> Sistema WIP Metalgráfico •
                Multidispositivo
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mt-1">
                Gestión de Almacenes de Semiprocesos (Lámina de Acero)
              </h1>
              <p className="text-slate-400 text-xs mt-1">
                Última sincronización:{" "}
                <span className="text-emerald-400 font-semibold">
                  {ultimaSync}
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                ref={fileInputRef}
                onChange={handleSubirArchivoExcel}
                className="hidden"
              />

              <button
                onClick={handlePegarDesdeSAP}
                disabled={sincronizando}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-3.5 py-2.5 rounded-lg shadow-lg text-xs transition cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${sincronizando ? "animate-spin" : ""}`}
                />
                Pegar desde SAP
              </button>

              <button
                onClick={() => setModalExcel(true)}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3.5 py-2.5 rounded-lg shadow-lg text-xs transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Actualizar desde Excel
              </button>

              <button
                onClick={() => setModalNuevo(true)}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3.5 py-2.5 rounded-lg shadow-lg text-xs transition cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                Nuevo Lote
              </button>
            </div>
          </header>

          {/* Tarjetas de los 3 Pulmones */}
          <section className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-400 uppercase">
                Buffer 1 • Lámina Virgen
              </span>
              <div className="text-2xl font-bold text-white mt-1">
                {totalPorEtapa("VIRGEN").toLocaleString()}{" "}
                <span className="text-sm font-normal text-slate-400">
                  láminas
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Listas para Recubrimiento
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-blue-400 uppercase">
                Buffer 2 • Lámina Recubierta
              </span>
              <div className="text-2xl font-bold text-white mt-1">
                {totalPorEtapa("RECUBIERTA").toLocaleString()}{" "}
                <span className="text-sm font-normal text-slate-400">
                  láminas
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Listas para Impresión
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-emerald-400 uppercase">
                Buffer 3 • Lámina Impresa
              </span>
              <div className="text-2xl font-bold text-white mt-1">
                {totalPorEtapa("IMPRESA").toLocaleString()}{" "}
                <span className="text-sm font-normal text-slate-400">
                  láminas
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Listas para Troquelado
              </p>
            </div>

            <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400 uppercase">
                  Auditoría con Escáner Móvil
                </span>
                <QrCode className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-300 mt-1">
                {porcentajeAuditoria}%{" "}
                <span className="text-sm font-normal text-emerald-200/70">
                  verificado en piso
                </span>
              </div>
              <p className="text-xs text-emerald-300/70 mt-1">
                {lotesVerificados} de {lotesActivos.length} tarimas escaneadas
              </p>
            </div>
          </section>

          {/* Filtros */}
          <section className="max-w-7xl mx-auto bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
                <Filter className="w-4 h-4 text-amber-400" /> Calibre:
              </span>
              {["TODOS", "70", "75"].map((cal) => (
                <button
                  key={cal}
                  onClick={() => setFiltroCalibre(cal)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    filtroCalibre === cal
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {cal === "TODOS" ? "Todos" : `Calibre ${cal}`}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {["TODAS", "VIRGEN", "RECUBIERTA", "IMPRESA", "TROQUELADO"].map(
                (et) => (
                  <button
                    key={et}
                    onClick={() => setFiltroEtapa(et)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      filtroEtapa === et
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {et}
                  </button>
                )
              )}
            </div>
          </section>

          {/* Tabla Principal */}
          <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h2 className="font-bold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-amber-400" />
                  Inventario en Racks (Con Etiqueta Código de Barras y Estado Móvil)
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 bg-slate-950/50">
                      <th className="p-3">Lote / Auditoría</th>
                      <th className="p-3">Calibre</th>
                      <th className="p-3">Etapa</th>
                      <th className="p-3">Láminas</th>
                      <th className="p-3">Rack</th>
                      <th className="p-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-sm">
                    {lotesFiltrados.map((lote, idx) => (
                      <tr key={lote.id} className="hover:bg-slate-800/40">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">
                              {lote.codigo_lote}
                            </span>
                            {lote.verificado_fisico === "OK" && (
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                                ✓ Verificado
                              </span>
                            )}
                            {lote.verificado_fisico === "DISCREPANCIA" && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-bold">
                                ⚠ Físico: {lote.cantidad_fisica}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            {lote.diseno_sku}
                          </div>
                        </td>

                        <td className="p-3">
                          <span
                            className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                              lote.calibre === "70"
                                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                            }`}
                          >
                            Cal. {lote.calibre}
                          </span>
                        </td>

                        <td className="p-3">
                          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200">
                            {lote.etapa}
                          </span>
                        </td>

                        <td className="p-3">
                          <div className="font-bold text-white">
                            {Number(lote.cantidad_actual).toLocaleString()} pzas
                          </div>
                          {lote.es_parcial && (
                            <span className="text-[11px] text-amber-400 font-semibold">
                              ● Pico Parcial
                            </span>
                          )}
                        </td>

                        <td className="p-3 font-mono text-xs text-slate-300">
                          {lote.ubicacion_rack}
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setLoteEtiquetaModal(lote)}
                              title="Ver e imprimir Etiqueta con Código de Barras / QR"
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg transition cursor-pointer"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                            {lote.etapa !== "TROQUELADO" && (
                              <>
                                <button
                                  onClick={() =>
                                    abrirModalProceso(lote, "COMPLETO")
                                  }
                                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer"
                                >
                                  Avanzar
                                </button>
                                <button
                                  onClick={() =>
                                    abrirModalProceso(lote, "CAMBIO_CALIBRE")
                                  }
                                  className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer"
                                >
                                  Corte
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Kardex */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="font-bold text-white flex items-center gap-2 mb-4">
                <History className="w-5 h-5 text-amber-400" />
                Bitácora de Auditoría y Movimientos
              </h2>
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {kardex.map((mov) => (
                  <div
                    key={mov.id}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                  >
                    <div className="flex items-center justify-between font-bold text-amber-400">
                      <span>{mov.codigo_lote}</span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(mov.created_date).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-200 mt-0.5">
                      {mov.accion}
                    </div>
                    <p className="text-slate-400 mt-1">{mov.detalle}</p>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </>
      )}

      {/* MODAL DE ETIQUETA VIAJERA IMPRIMIBLE (CÓDIGO DE BARRAS + QR) */}
      {loteEtiquetaModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-white text-slate-950 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white px-2 py-0.5 rounded">
                  ETIQUETA VIAJERA WIP
                </span>
                <h3 className="text-3xl font-black mt-1">
                  {loteEtiquetaModal.codigo_lote}
                </h3>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold block uppercase text-slate-500">
                  CALIBRE
                </span>
                <span className="text-3xl font-black">
                  {loteEtiquetaModal.calibre}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm bg-slate-100 p-3 rounded-xl">
              <div>
                <span className="text-[10px] font-bold text-slate-500 block">
                  ETAPA ACTUAL
                </span>
                <strong className="text-base">{loteEtiquetaModal.etapa}</strong>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 block">
                  CANTIDAD ACTUAL
                </span>
                <strong className="text-base">
                  {loteEtiquetaModal.cantidad_actual} LÁMINAS
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 block">
                  UBICACIÓN RACK
                </span>
                <strong className="font-mono">
                  {loteEtiquetaModal.ubicacion_rack}
                </strong>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 block">
                  TIPO LOTE
                </span>
                <strong>
                  {loteEtiquetaModal.es_parcial ? "SALDO / PICO" : "ESTÁNDAR"}
                </strong>
              </div>
            </div>

            {/* Generador de Código de Barras y QR listo para escanear con el celular */}
            <div className="flex flex-col items-center justify-center py-3 border-2 border-dashed border-slate-300 rounded-xl bg-white">
              <img
                src={`https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(
                  loteEtiquetaModal.codigo_lote
                )}&scale=3&height=12&includetext`}
                alt="Código de Barras"
                className="h-16 object-contain"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setLoteEtiquetaModal(null)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-200 text-slate-800 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Imprimir Etiqueta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Excel (Igual que antes) */}
      {modalExcel && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">
                Actualizar Datos desde SAP / Excel
              </h3>
              <button
                onClick={() => setModalExcel(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-emerald-500 text-slate-950 font-bold py-2.5 rounded-lg text-xs cursor-pointer"
              >
                Seleccionar Archivo Excel (.xlsx / .csv)
              </button>
              <button
                onClick={handleDescargarPlantillaExcel}
                className="w-full bg-slate-800 text-slate-200 font-semibold py-2 rounded-lg text-xs cursor-pointer"
              >
                Descargar Plantilla Excel de Prueba
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}