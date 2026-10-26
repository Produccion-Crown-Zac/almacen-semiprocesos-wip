// src/lib/sapParser.js
// Lee reportes de stock de SAP (MB52 y similares) en cualquiera de estos formatos:
//  - Archivo .MHTML / .MHT / .HTML exportado desde SAP ("Hoja de cálculo")
//  - Archivo .XLSX / .XLS / .CSV / .TXT
//  - Texto pegado con Ctrl+V desde un ALV (separado por tabuladores o por "|")
// Devuelve filas normalizadas: una por bulto (lote), ignorando subtotales.

import * as XLSX from "xlsx";

export const LOTE_ESTANDAR = 1500;

const normalizarTexto = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------- 1. Convertir cualquier entrada en una matriz de celdas (texto) ----------

const decodificarQuotedPrintable = (texto) =>
  texto
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

const extraerHtmlDeMhtml = (texto) => {
  const inicio = texto.search(/<html[\s>]/i);
  if (inicio === -1) return texto;
  let html = texto.slice(inicio);
  const fin = html.search(/<\/html>/i);
  if (fin !== -1) html = html.slice(0, fin + 7);
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(texto.slice(0, inicio))) {
    html = decodificarQuotedPrintable(html);
    // Los bytes decodificados vienen en UTF-8: reinterpretarlos
    try {
      html = new TextDecoder("utf-8").decode(
        Uint8Array.from(html, (c) => c.charCodeAt(0) & 0xff)
      );
    } catch {
      /* se queda como está */
    }
  }
  return html;
};

const matrizDesdeHtml = (html) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tablas = [...doc.querySelectorAll("table")];
  if (tablas.length === 0) return [];
  // La tabla con más filas es la del reporte
  const tabla = tablas.reduce((a, b) =>
    b.querySelectorAll("tr").length > a.querySelectorAll("tr").length ? b : a
  );
  return [...tabla.querySelectorAll("tr")].map((tr) =>
    [...tr.querySelectorAll("td,th")].map((td) =>
      (td.getAttribute("x:str") ?? td.textContent ?? "").replace(/\u00a0/g, " ").trim()
    )
  );
};

const matrizDesdeTextoPlano = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !/^[\s|-]+$/.test(l)) // líneas "-----" del ALV
    .map((l) => {
      if (l.includes("\t")) return l.split("\t").map((c) => c.trim());
      if (l.trim().startsWith("|"))
        return l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      return l.split(/;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim());
    });

const matrizDesdeLibro = (datos, opciones) => {
  const libro = XLSX.read(datos, { ...opciones, raw: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(hoja, { header: 1, raw: false, defval: "" })
    .map((fila) => fila.map((c) => String(c ?? "").trim()));
};

export const matrizDesdeTexto = (texto) => {
  if (/<table[\s>]/i.test(texto)) return matrizDesdeHtml(extraerHtmlDeMhtml(texto));
  return matrizDesdeTextoPlano(texto);
};

export const matrizDesdeArchivo = async (archivo) => {
  const nombre = archivo.name.toLowerCase();
  if (/\.(xlsx|xlsm|xlsb|ods)$/.test(nombre)) {
    return matrizDesdeLibro(await archivo.arrayBuffer(), { type: "array" });
  }
  // .mhtml, .mht, .html, .xls (SAP suele guardar HTML con extensión .xls), .csv, .txt
  const buffer = await archivo.arrayBuffer();
  const texto = new TextDecoder("utf-8").decode(buffer);
  if (/<table[\s>]/i.test(texto)) return matrizDesdeHtml(extraerHtmlDeMhtml(texto));
  if (nombre.endsWith(".xls")) return matrizDesdeLibro(buffer, { type: "array" });
  // SAP a veces exporta texto en Windows-1252
  const textoPlano = texto.includes("�")
    ? new TextDecoder("windows-1252").decode(buffer)
    : texto;
  return matrizDesdeTextoPlano(textoPlano);
};

// ---------- 2. Encontrar encabezados y columnas ----------

const COLUMNAS = {
  lote: (h) => h === "lote" || h === "bulto" || h === "no. de lote" || h === "numero de lote",
  material: (h) => h === "material" || h === "numero de material" || h === "clave de material",
  texto: (h) => h.startsWith("texto breve") || h === "descripcion" || h === "denominacion",
  centro: (h) => h === "centro",
  almacen: (h) => h === "almacen" || h.startsWith("almacen "),
  unidad: (h) => h.startsWith("unidad medida") || h === "umb" || h === "un. medida base",
  libre: (h) =>
    h.startsWith("libre util") ||
    h === "cantidad" ||
    h === "stock disponible" ||
    h === "hojas" ||
    h === "laminas",
  calidad: (h) => h.includes("control calidad") || h.includes("control de calidad"),
};

const ubicarColumnas = (matriz) => {
  for (let i = 0; i < Math.min(matriz.length, 30); i++) {
    const encabezados = matriz[i].map(normalizarTexto);
    const idx = {};
    for (const [clave, coincide] of Object.entries(COLUMNAS)) {
      const j = encabezados.findIndex(coincide);
      if (j !== -1) idx[clave] = j;
    }
    if (idx.lote !== undefined && idx.libre !== undefined) return { filaEncabezado: i, idx };
  }
  return null;
};

// ---------- 3. Interpretar cantidades, etapa y calibre ----------

export const parsearCantidad = (valor) => {
  let s = String(valor ?? "").replace(/\s/g, "");
  if (!s) return 0;
  let negativo = false;
  if (s.endsWith("-")) {
    negativo = true; // SAP pone el signo al final: "20-"
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negativo = true;
    s = s.slice(1);
  }
  const tieneComa = s.includes(",");
  const tienePunto = s.includes(".");
  if (tieneComa && tienePunto) {
    // El último separador es el decimal
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (tieneComa) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (tienePunto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  return negativo ? -n : n;
};

export const derivarEtapa = (texto) => {
  const t = String(texto ?? "").toUpperCase();
  if (t.includes("VIRGEN")) return "VIRGEN";
  if (t.includes("RECUB")) return "RECUBIERTA";
  if (/\bIMP\b|IMPRES/.test(t)) return "IMPRESA";
  return "OTRO";
};

export const derivarCalibre = (texto) => {
  const t = String(texto ?? "").toUpperCase();
  if (/^ALU|ALUMINIO/.test(t)) return "ALU";
  const patrones = [
    /CAL\.?\s*(70|75)\b/, // CAL 70, CAL.75, CAL75
    /\b(70|75)\s*T4\b/, // 75T4, 70 T4
    /\bC(70|75)\b/, // PRY C70
    /\bTFS\s*(70|75)\b/, // TFS 70
    /\b(70|75)\s*LB\b/, // 70 LB, 70LB
    /\b(70|75)$/, // ... PRY OFF 70
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (m) return m[1];
  }
  return "";
};

// ---------- 4. Función principal ----------

export const normalizarReporteSap = (matriz) => {
  const ubicacion = ubicarColumnas(matriz);
  if (!ubicacion) {
    throw new Error(
      'No encontré los encabezados del reporte. Deben incluir al menos "Lote" y "Libre utilización".'
    );
  }
  const { filaEncabezado, idx } = ubicacion;
  const celda = (fila, clave) => (idx[clave] === undefined ? "" : String(fila[idx[clave]] ?? "").trim());

  const filas = [];
  let subtotalesIgnorados = 0;
  const vistos = new Set();
  let duplicados = 0;

  for (const fila of matriz.slice(filaEncabezado + 1)) {
    const lote = celda(fila, "lote").toUpperCase();
    if (!lote) {
      subtotalesIgnorados++; // filas de subtotal/total de SAP no traen lote
      continue;
    }
    const material = celda(fila, "material").replace(/^0+(?=\d)/, "");
    const clave = `${material}|${lote}`;
    if (vistos.has(clave)) {
      duplicados++;
      continue;
    }
    vistos.add(clave);
    const texto = celda(fila, "texto");
    const libre = parsearCantidad(celda(fila, "libre"));
    const calidad = parsearCantidad(celda(fila, "calidad"));
    filas.push({
      clave,
      lote,
      material,
      texto_breve: texto,
      centro: celda(fila, "centro"),
      almacen: celda(fila, "almacen"),
      unidad: celda(fila, "unidad"),
      // Las piezas del bulto pueden estar en "Libre utilización" o en "En control calidad":
      // si libre viene en 0 se toma la de calidad (se suman por si algún día vienen las dos)
      cantidad_sap: libre + calidad,
      en_calidad: calidad,
      etapa: derivarEtapa(texto),
      calibre: derivarCalibre(texto),
    });
  }

  return {
    filas,
    subtotalesIgnorados,
    duplicados,
    columnasDetectadas: Object.keys(idx),
  };
};

export const leerArchivoSap = async (archivo) =>
  normalizarReporteSap(await matrizDesdeArchivo(archivo));

export const leerTextoSap = (texto) => normalizarReporteSap(matrizDesdeTexto(texto));
