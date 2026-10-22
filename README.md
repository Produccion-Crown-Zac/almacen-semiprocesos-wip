# Inventario WIP · Croquis y conteo por bulto

App para hacer el inventario físico del almacén de semiprocesos contra el reporte de SAP,
registrando **dónde está cada bulto** (zona, carril y posición del croquis).

- **Tablero (PC dentro de Citrix):** se carga el MB52 copiando la tabla en SAP y presionando **Ctrl+V**,
  o arrastrando el archivo exportado (.MHTML, .XLS, .XLSX, .CSV, .TXT). Muestra el croquis del almacén,
  el avance por tipo de lámina, el área de seguimiento de observaciones y el historial de conteos.
- **Escáner (celular):** se elige la zona, el carril y la posición; se escanea cada bulto y se le da
  **✓** (check) o **>** (con observación: Faltante, Consumo pendiente, En proceso, Ubicación incorrecta,
  Lote mal escrito, Sin papeleta, Otro). Si una posición ya tiene 5 lotes aparece una advertencia.

## Croquis
Definido en `src/lib/croquis.js`, tomado de `CROQUIS_INVENTARIO.xlsx`:
- Recubierta: carriles 1–19 (12 o 14 posiciones), Desperdicio (14) y Ecotapa 1–3 (13).
- Impresa: carriles 1–15 (3 posiciones), 16–23 (10 posiciones).
- Virgen: carriles 1–6 (25 posiciones), 7–9 (4) y 10–11 (6).
Hasta 5 lotes por posición. Colores: calibre 70 verde, calibre 75 blanco, Ecotapa rosa, aluminio azul, sin calibre gris.

## Datos
Por ahora en **modo demo**: todo se guarda en el navegador de cada dispositivo (`src/api/entities.js`).
La siguiente etapa es conectar Cloudflare D1 reescribiendo solo ese archivo.

## Desarrollo
```
npm install
npm run dev
```
Build: `npm run build` → carpeta `dist`.
