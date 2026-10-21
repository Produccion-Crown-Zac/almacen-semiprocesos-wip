# Inventario WIP · Conteo por bulto

App para dar **check físico a cada bulto** del almacén de semiprocesos contra el reporte de SAP.

- **Tablero (PC dentro de Citrix):** se carga el reporte MB52 copiando la tabla en SAP y presionando
  **Ctrl+V** en la página, o arrastrando el archivo exportado (.MHTML, .XLS, .XLSX, .CSV, .TXT).
- **Escáner (celular):** se escanea el código de barras de la hoja de bulto (= Lote en SAP), se confirma
  la cantidad y queda registrado quién y cuándo.

## Columnas que lee del reporte SAP
`Lote` (obligatoria), `Libre utilización` (obligatoria), `Material`, `Texto breve de material`, `Centro`,
`Almacén`, `Unidad medida base`, `En control calidad`. Las filas de subtotal (sin lote) se ignoran.
La **etapa** (Virgen / Recubierta / Impresa) y el **calibre** (70 / 75 / Aluminio) se deducen del texto breve.

## Datos
- Sin configurar nada: **modo demo**, los datos se guardan solo en el navegador.
- Con Supabase: los datos se comparten entre todos los dispositivos en tiempo real.
  1. Crear proyecto en supabase.com y ejecutar `supabase/schema.sql` en el SQL Editor.
  2. Copiar `.env.example` como `.env.local` y llenar URL y clave anon (Project Settings → API).
  3. En Cloudflare Pages, poner esas mismas dos variables en Settings → Variables and Secrets.

## Desarrollo
```
npm install
npm run dev
```
Build: `npm run build` → carpeta `dist`.
