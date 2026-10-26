// src/lib/croquis.js
// Croquis del almacén tomado del archivo CROQUIS_INVENTARIO.xlsx.
// Cada carril tiene posiciones; en cada posición caben hasta 5 lotes.
// La posición 1 es la que está junto al número del carril.
// `col` y `row` son la columna y fila de la celda en el Excel (para dibujar el mapa).

export const CAPACIDAD_POSICION = 5;

export const ZONAS = {
  VIRGEN: { id: "VIRGEN", nombre: "Virgen", titulo: "Lámina virgen", grafica: "#ec4899", color: "#f472b6", texto: "#f9a8d4", fondo: "rgba(244,114,182,.13)", borde: "rgba(244,114,182,.55)" },
  RECUBIERTA: { id: "RECUBIERTA", nombre: "Recubierta", titulo: "Lámina recubierta", grafica: "#ea580c", color: "#fb923c", texto: "#fdba74", fondo: "rgba(251,146,60,.12)", borde: "rgba(251,146,60,.55)" },
  IMPRESA: { id: "IMPRESA", nombre: "Impresa", titulo: "Lámina impresa", grafica: "#8b5cf6", color: "#a78bfa", texto: "#c4b5fd", fondo: "rgba(167,139,250,.14)", borde: "rgba(167,139,250,.55)" },
};
export const ORDEN_ZONAS = ["VIRGEN", "RECUBIERTA", "IMPRESA"];

const rango = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const construir = () => {
  const carriles = [];
  const agregar = (zona, id, nombre, etiqueta, celdas) =>
    carriles.push({ zona, id, nombre, etiqueta, celdas, posiciones: celdas.length });

  // ---- Recubierta (bloque izquierdo, etiqueta a la izquierda) ----
  const rec = [
    ["E03", "Ecotapa 3", 4, 13],
    ["E02", "Ecotapa 2", 6, 13],
    ["E01", "Ecotapa 1", 8, 13],
    ["DES", "Desperdicio", 10, 14],
  ];
  for (let i = 0; i < 6; i++) rec.push([String(19 - i), String(19 - i), 12 + 2 * i, 14]);
  for (let i = 0; i < 13; i++) rec.push([String(13 - i), String(13 - i), 24 + 2 * i, 12]);
  // Orden de recorrido: 1 → 19, luego Desperdicio y Ecotapas
  const recOrdenado = [...rec].sort((a, b) => {
    const na = Number(a[0]);
    const nb = Number(b[0]);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    if (!Number.isNaN(na)) return -1;
    if (!Number.isNaN(nb)) return 1;
    return ["DES", "E01", "E02", "E03"].indexOf(a[0]) - ["DES", "E01", "E02", "E03"].indexOf(b[0]);
  });
  recOrdenado.forEach(([id, nombre, row, n]) =>
    agregar("RECUBIERTA", id, nombre, { col: 3, row, lado: "izq" }, rango(n, (p) => ({ col: 4 + p, row })))
  );

  // ---- Impresa ----
  for (let L = 1; L <= 15; L++) {
    const col = 59 - 2 * (L - 1);
    agregar("IMPRESA", String(L), String(L), { col, row: 33, lado: "abajo" }, rango(3, (p) => ({ col, row: 32 - p })));
  }
  [["16", 26], ["17", 28], ["18", 30]].forEach(([id, row]) =>
    agregar("IMPRESA", id, id, { col: 72, row, lado: "der" }, rango(10, (p) => ({ col: 71 - p, row })))
  );
  [["19", 26], ["20", 28], ["21", 30], ["22", 32], ["23", 34]].forEach(([id, row]) =>
    agregar("IMPRESA", id, id, { col: 84, row, lado: "der" }, rango(10, (p) => ({ col: 83 - p, row })))
  );

  // ---- Virgen ----
  // Bloque principal: carriles 1 a 11 de 25 posiciones.
  // Los carriles chicos se renumeraron: antes 7-9 → ahora 12-14, antes 10-11 → ahora 15-16.
  for (let L = 1; L <= 11; L++) {
    const row = 18 + 2 * (L - 1);
    agregar("VIRGEN", String(L), String(L), { col: 114, row, lado: "der" }, rango(25, (p) => ({ col: 113 - p, row })));
  }
  [["12", 83], ["13", 85], ["14", 87]].forEach(([id, col]) =>
    agregar("VIRGEN", id, id, { col, row: 42, lado: "abajo" }, rango(4, (p) => ({ col, row: 41 - p })))
  );
  [["15", 85], ["16", 87]].forEach(([id, col]) =>
    agregar("VIRGEN", id, id, { col, row: 29, lado: "arriba" }, rango(6, (p) => ({ col, row: 30 + p })))
  );
  return carriles;
};

export const CARRILES = construir();

export const carrilesDeZona = (zona) => CARRILES.filter((c) => c.zona === zona);
export const buscarCarril = (zona, id) => CARRILES.find((c) => c.zona === zona && c.id === id);

// Rectángulos de fondo de cada zona (columna/fila inicial y final del Excel)
export const FONDOS = [
  { zona: "RECUBIERTA", c1: 1, c2: 18, r1: 3, r2: 49 },
  { zona: "IMPRESA", c1: 61, c2: 84, r1: 25, r2: 35 },
  { zona: "IMPRESA", c1: 29, c2: 60, r1: 29, r2: 34 },
  { zona: "VIRGEN", c1: 85, c2: 115, r1: 17, r2: 28 },
  { zona: "VIRGEN", c1: 89, c2: 115, r1: 29, r2: 38 },
  { zona: "VIRGEN", c1: 85, c2: 88, r1: 29, r2: 36 },
  { zona: "VIRGEN", c1: 82, c2: 88, r1: 37, r2: 43 },
];
export const TITULOS = [
  { zona: "RECUBIERTA", col: 1, row: 1.3 },
  { zona: "IMPRESA", col: 29, row: 27.4 },
  { zona: "VIRGEN", col: 85, row: 15.4 },
];
export const COLUMNAS = 115;
export const FILAS = 50;

export const totalPosiciones = (zona) =>
  CARRILES.filter((c) => !zona || c.zona === zona).reduce((a, c) => a + c.posiciones, 0);

export const textoUbicacion = (zona, carril, posicion) => {
  if (!zona || !carril) return "Área de seguimiento";
  const c = buscarCarril(zona, carril);
  const nombreCarril = c ? c.nombre : carril;
  const prefijo = /^\d+$/.test(nombreCarril) ? `C${nombreCarril}` : nombreCarril;
  return `${ZONAS[zona]?.nombre ?? zona} · ${prefijo} · P${posicion}`;
};

// ---- Colores de los lotes en el croquis ----
export const COLORES_LOTE = {
  C70: { color: "#22c55e", nombre: "Calibre 70" },
  C75: { color: "#f1f5f9", nombre: "Calibre 75" },
  ECO: { color: "#ec4899", nombre: "Ecotapa" },
  ALU: { color: "#3b82f6", nombre: "Aluminio" },
  SIN: { color: "#64748b", nombre: "Sin calibre" },
};

export const tipoColorLote = ({ lote, calibre }) => {
  if (String(lote ?? "").toUpperCase().startsWith("ECOTAP")) return "ECO";
  if (calibre === "ALU") return "ALU";
  if (calibre === "70") return "C70";
  if (calibre === "75") return "C75";
  return "SIN";
};

// ---- Observaciones ----
export const MOTIVOS = [
  "Faltante",
  "Consumo pendiente",
  "En proceso",
  "Ubicación incorrecta",
  "Lote mal escrito",
  "Sin papeleta",
  "Otro",
];
