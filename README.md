# Inventario WIP · Layout y conteo por bulto

Aplicación para hacer el inventario físico del almacén de semiprocesos (Planta Tapas) contra el reporte
MB52 de SAP, registrando **dónde está cada bulto** (zona, carril, posición y nivel del layout).

- **Tablero (PC dentro de Citrix):** carga del MB52 con **Ctrl+V** o arrastrando el archivo exportado
  (.MHTML, .XLS, .XLSX, .CSV, .TXT). Subapartados: **Resumen** (exactitud de inventario, desviación y avance
  por día / semana / SKU / proceso), **Layout** (mapa y buscador de bultos), **Seguimiento** (observaciones)
  y **Bultos** (tabla). Bitácora en el ícono del reloj. Historial de conteos.
- **Escáner (celular):** zona, carril y posición; escaneo del código de barras de la hoja de bulto (= Lote
  en SAP); **✓** check o **>** observación. Advertencia al registrar más de 5 lotes en una posición.
- **Inicio de sesión** con usuario y contraseña. Perfiles: **Administrador** (todo, incluida la
  administración de usuarios) y **Usuario** (todo, excepto usuarios). Sesión de 12 horas.

## Arquitectura
- Interfaz: React + Vite + Tailwind (`src/`), publicada como archivos estáticos (`dist/`).
- API: `server/api.js`, servida por un Cloudflare Worker (`server/worker.js`) en `/api/*`.
  (`functions/api/[[ruta]].js` permite publicar lo mismo como Cloudflare Pages, si se prefiere.)
- Base de datos: Cloudflare D1 (`migrations/0001_inicial.sql`), enlazada como `DB` en `wrangler.jsonc`.
- Contraseñas cifradas con PBKDF2-SHA256 (100,000 iteraciones); sesiones en cookie HttpOnly.

## Publicar en Cloudflare (Worker)
1. **Base de datos:** *Storage & Databases → D1* → *Create* → `inventario-wip`. Abre la base → *Console*
   → pega todo `migrations/0001_inicial.sql` → *Execute*.
2. Copia el **Database ID** de esa base y pégalo en `wrangler.jsonc` en lugar de `PEGA-AQUI-EL-ID`.
   Haz `git push`.
3. **Worker:** *Workers & Pages → Create → Import a repository* → `Produccion-Crown-Zac/almacen-semiprocesos-wip`.
   Build command `npm run build` · Deploy command `npx wrangler deploy`.
4. **Código de instalación:** en el Worker → *Settings → Variables and Secrets → Add* → tipo *Secret* →
   `CODIGO_INSTALACION` = una clave que solo tú conozcas.
5. Abre la dirección `*.workers.dev`: la primera pantalla pide el código y crea al **administrador**.
   Desde *Usuarios* da de alta al resto del personal.

## Pruebas locales (opcional)
```
npm install
npm run build
npx wrangler d1 execute inventario-wip --local --file migrations/0001_inicial.sql
echo CODIGO_INSTALACION=prueba > .dev.vars
npx wrangler dev
```

## Límites del plan gratuito de Cloudflare
D1: 5 millones de filas leídas y 100,000 escritas al día. Workers: 100,000 peticiones al
día y 10 ms de CPU por petición (el cifrado de contraseña tarda ~20 ms; Cloudflare tolera excesos
ocasionales). Si aparece el error 1102 al iniciar sesión o el uso crece, el plan Workers Paid (5 USD/mes)
eleva estos límites.
