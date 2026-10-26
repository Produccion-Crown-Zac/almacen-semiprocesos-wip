// server/api.js
// API del Inventario WIP (Cloudflare Worker o Pages Functions + D1).
// Todas las rutas viven bajo /api/... y requieren sesión, salvo estado, setup y login.
// La base de datos D1 debe estar vinculada con el nombre "DB".

const DURACION_SESION_S = 12 * 60 * 60; // 12 horas = un turno
// Iteraciones de PBKDF2 para contraseñas nuevas (Cloudflare admite hasta 100,000).
// Cada contraseña guarda las suyas, así que este valor puede cambiarse sin afectar a las existentes.
const ITERACIONES = 100000;

// ---------------------------------------------------------------- utilidades
const json = (datos, estado = 200, extra = {}) =>
  new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
const error = (estado, mensaje) => json({ error: mensaje }, estado);
const ahora = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const aB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(password, salt, iteraciones = ITERACIONES) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iteraciones }, clave, 256);
  return aB64(new Uint8Array(bits));
}
async function hashNuevo(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { pass_hash: await derivar(password, salt), pass_salt: aB64(salt), pass_iter: ITERACIONES };
}
async function verificar(password, hash, salt, iteraciones) {
  const calculado = await derivar(password, deB64(salt), iteraciones || ITERACIONES);
  if (calculado.length !== hash.length) return false;
  let dif = 0;
  for (let i = 0; i < hash.length; i++) dif |= calculado.charCodeAt(i) ^ hash.charCodeAt(i);
  return dif === 0;
}

const leerCookie = (req, nombre) => {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};
const cookieSesion = (token, maxAge) =>
  `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

const usuarioPublico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: !!u.activo, creado_en: u.creado_en });

const validarPassword = (p) => typeof p === "string" && p.length >= 8;
const validarUsuario = (u) => typeof u === "string" && /^[A-Za-z0-9._-]{3,40}$/.test(u);

// "version" cambia con cualquier escritura; "version_sap" solo cuando cambia el reporte de SAP o los ajustes.
// Los dispositivos comparan estos números para saber qué volver a leer.
async function subirVersion(db, { sap = false } = {}) {
  const claves = sap ? "('version', 'version_sap')" : "('version')";
  await db.prepare(`UPDATE ajustes SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT) WHERE clave IN ${claves}`).run();
}

async function crearSesion(db, usuarioId) {
  const token = aB64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
  const expira = Math.floor(Date.now() / 1000) + DURACION_SESION_S;
  await db.batch([
    db.prepare("DELETE FROM sesiones WHERE expira < ?").bind(Math.floor(Date.now() / 1000)),
    db.prepare("INSERT INTO sesiones (token, usuario_id, expira) VALUES (?, ?, ?)").bind(token, usuarioId, expira),
  ]);
  return token;
}

async function sesionActual(db, req) {
  const token = leerCookie(req, "sid");
  if (!token) return null;
  const u = await db
    .prepare(
      "SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND s.expira > ? AND u.activo = 1"
    )
    .bind(token, Math.floor(Date.now() / 1000))
    .first();
  return u ? { ...u, token } : null;
}

const parsearRegistro = (r) => (r ? { ...r, posicion: r.posicion == null ? null : Number(r.posicion) } : r);

async function totalesSap(db) {
  const { results } = await db
    .prepare("SELECT etapa, COUNT(*) AS lotes, SUM(cantidad_sap) AS piezas FROM sap WHERE en_sap = 1 GROUP BY etapa")
    .all();
  const vacio = () => ({ lotes: 0, piezas: 0 });
  const t = { VIRGEN: vacio(), RECUBIERTA: vacio(), IMPRESA: vacio(), OTRO: vacio(), total: vacio() };
  for (const r of results) {
    const e = t[r.etapa in t ? r.etapa : "OTRO"];
    e.lotes += r.lotes;
    e.piezas += r.piezas || 0;
    t.total.lotes += r.lotes;
    t.total.piezas += r.piezas || 0;
  }
  return t;
}

async function conteoActual(db, nombre) {
  let c = await db.prepare("SELECT * FROM conteos WHERE estado = 'EN_CURSO' ORDER BY creado_en DESC LIMIT 1").first();
  if (!c) {
    c = { id: id(), estado: "EN_CURSO", creado_en: ahora(), cerrado_en: null, creado_por: nombre ?? null, totales_sap: null };
    await db
      .prepare("INSERT INTO conteos (id, estado, creado_en, cerrado_en, creado_por, totales_sap) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(c.id, c.estado, c.creado_en, null, c.creado_por, null)
      .run();
  }
  return c;
}
const parsearConteo = (c) => ({ ...c, totales_sap: c.totales_sap ? JSON.parse(c.totales_sap) : null });

const CAMPOS_REGISTRO_EDITABLES = ["zona", "carril", "posicion", "motivo", "comentario", "cantidad_fisica", "estado"];

// ---------------------------------------------------------------- rutas
export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;
  if (!db) return error(500, "La base de datos D1 no está vinculada. Revisa que wrangler.jsonc tenga el enlace DB con el database_id de tu base.");

  const segmentos = Array.isArray(params.ruta) ? params.ruta : [params.ruta].filter(Boolean);
  const ruta = segmentos.join("/");
  const metodo = request.method;
  const url = new URL(request.url);
  const cuerpo = async () => {
    try {
      return await request.json();
    } catch {
      return {};
    }
  };

  try {
    // ------------------------- públicas
    if (ruta === "estado" && metodo === "GET") {
      const n = await db.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
      return json({ hayUsuarios: (n?.n ?? 0) > 0 });
    }

    if (ruta === "setup" && metodo === "POST") {
      const n = await db.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
      if ((n?.n ?? 0) > 0) return error(403, "El administrador inicial ya fue creado.");
      const b = await cuerpo();
      // Código secreto configurado en Cloudflare (variable CODIGO_INSTALACION) para que nadie más cree el primer administrador
      if (!env.CODIGO_INSTALACION) return error(500, "Falta configurar el secreto CODIGO_INSTALACION en Cloudflare (Settings → Variables and Secrets).");
      if (String(b.codigo ?? "") !== String(env.CODIGO_INSTALACION)) return error(403, "El código de instalación no es correcto.");
      if (!validarUsuario(b.usuario)) return error(400, "Usuario inválido: de 3 a 40 letras, números, punto, guion o guion bajo.");
      if (!b.nombre?.trim()) return error(400, "Escribe el nombre completo.");
      if (!validarPassword(b.password)) return error(400, "La contraseña debe tener al menos 8 caracteres.");
      const h = await hashNuevo(b.password);
      const u = { id: id(), usuario: b.usuario.trim(), nombre: b.nombre.trim(), rol: "ADMIN", ...h, activo: 1, creado_en: ahora() };
      await db
        .prepare("INSERT INTO usuarios (id, usuario, nombre, rol, pass_hash, pass_salt, pass_iter, activo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(u.id, u.usuario, u.nombre, u.rol, u.pass_hash, u.pass_salt, u.pass_iter, u.creado_en, u.creado_en)
        .run();
      const token = await crearSesion(db, u.id);
      return json({ usuario: usuarioPublico(u) }, 200, { "set-cookie": cookieSesion(token, DURACION_SESION_S) });
    }

    if (ruta === "login" && metodo === "POST") {
      const b = await cuerpo();
      const u = await db.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(String(b.usuario ?? "").trim()).first();
      const ok = u && u.activo && (await verificar(String(b.password ?? ""), u.pass_hash, u.pass_salt, u.pass_iter));
      if (!ok) return error(401, "Usuario o contraseña incorrectos, o la cuenta está desactivada.");
      const token = await crearSesion(db, u.id);
      return json({ usuario: usuarioPublico(u) }, 200, { "set-cookie": cookieSesion(token, DURACION_SESION_S) });
    }

    if (ruta === "logout" && metodo === "POST") {
      const token = leerCookie(request, "sid");
      if (token) await db.prepare("DELETE FROM sesiones WHERE token = ?").bind(token).run();
      return json({ ok: true }, 200, { "set-cookie": cookieSesion("", 0) });
    }

    // ------------------------- requieren sesión
    const yo = await sesionActual(db, request);
    if (!yo) return error(401, "Tu sesión terminó. Inicia sesión de nuevo.");
    const esAdmin = yo.rol === "ADMIN";

    if (ruta === "yo" && metodo === "GET") return json({ usuario: usuarioPublico(yo) });

    if (ruta === "yo/password" && metodo === "POST") {
      const b = await cuerpo();
      if (!(await verificar(String(b.actual ?? ""), yo.pass_hash, yo.pass_salt, yo.pass_iter))) return error(400, "La contraseña actual no es correcta.");
      if (!validarPassword(b.nueva)) return error(400, "La contraseña nueva debe tener al menos 8 caracteres.");
      const h = await hashNuevo(b.nueva);
      await db.batch([
        db.prepare("UPDATE usuarios SET pass_hash = ?, pass_salt = ?, pass_iter = ?, actualizado_en = ? WHERE id = ?").bind(h.pass_hash, h.pass_salt, h.pass_iter, ahora(), yo.id),
        db.prepare("DELETE FROM sesiones WHERE usuario_id = ? AND token <> ?").bind(yo.id, yo.token),
      ]);
      return json({ ok: true });
    }

    if (ruta === "version" && metodo === "GET") {
      const { results } = await db.prepare("SELECT clave, valor FROM ajustes WHERE clave IN ('version', 'version_sap')").all();
      const v = Object.fromEntries(results.map((r) => [r.clave, Number(r.valor)]));
      return json({ version: v.version ?? 0, version_sap: v.version_sap ?? 0 });
    }

    if (ruta === "ajustes" && metodo === "GET") {
      const { results } = await db.prepare("SELECT clave, valor FROM ajustes").all();
      const a = Object.fromEntries(results.map((r) => [r.clave, r.valor]));
      return json({ meta_exactitud: Number(a.meta_exactitud ?? 95) });
    }
    if (ruta === "ajustes" && metodo === "PUT") {
      const b = await cuerpo();
      const meta = Number(b.meta_exactitud);
      if (!(meta >= 50 && meta <= 100)) return error(400, "La meta debe estar entre 50 y 100.");
      await db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('meta_exactitud', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor").bind(String(meta)).run();
      await subirVersion(db, { sap: true });
      return json({ meta_exactitud: meta });
    }

    // ------------------------- usuarios (solo administrador)
    if (ruta === "usuarios" || ruta.startsWith("usuarios/")) {
      if (!esAdmin) return error(403, "Solo un administrador puede administrar usuarios.");
      if (ruta === "usuarios" && metodo === "GET") {
        const { results } = await db.prepare("SELECT * FROM usuarios ORDER BY activo DESC, nombre").all();
        return json(results.map(usuarioPublico));
      }
      if (ruta === "usuarios" && metodo === "POST") {
        const b = await cuerpo();
        if (!validarUsuario(b.usuario)) return error(400, "Usuario inválido: de 3 a 40 letras, números, punto, guion o guion bajo.");
        if (!b.nombre?.trim()) return error(400, "Escribe el nombre completo.");
        if (!["ADMIN", "USUARIO"].includes(b.rol)) return error(400, "Perfil inválido.");
        if (!validarPassword(b.password)) return error(400, "La contraseña debe tener al menos 8 caracteres.");
        const existe = await db.prepare("SELECT id FROM usuarios WHERE usuario = ?").bind(b.usuario.trim()).first();
        if (existe) return error(409, "Ya existe un usuario con ese nombre de acceso.");
        const h = await hashNuevo(b.password);
        const t = ahora();
        const u = { id: id(), usuario: b.usuario.trim(), nombre: b.nombre.trim(), rol: b.rol, activo: 1, creado_en: t };
        await db
          .prepare("INSERT INTO usuarios (id, usuario, nombre, rol, pass_hash, pass_salt, pass_iter, activo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
          .bind(u.id, u.usuario, u.nombre, u.rol, h.pass_hash, h.pass_salt, h.pass_iter, t, t)
          .run();
        return json(usuarioPublico(u), 201);
      }
      const uid = segmentos[1];
      if (uid && metodo === "PATCH") {
        const b = await cuerpo();
        const u = await db.prepare("SELECT * FROM usuarios WHERE id = ?").bind(uid).first();
        if (!u) return error(404, "Usuario no encontrado.");
        const quitaAdmin = (b.rol && b.rol !== "ADMIN" && u.rol === "ADMIN") || (b.activo === false && u.rol === "ADMIN");
        if (quitaAdmin) {
          const n = await db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'ADMIN' AND activo = 1").first();
          if ((n?.n ?? 0) <= 1) return error(400, "Debe quedar al menos un administrador activo.");
        }
        if (b.activo === false && u.id === yo.id) return error(400, "No puedes desactivar tu propia cuenta.");
        const sets = [];
        const vals = [];
        if (typeof b.nombre === "string" && b.nombre.trim()) {
          sets.push("nombre = ?");
          vals.push(b.nombre.trim());
        }
        if (b.rol) {
          if (!["ADMIN", "USUARIO"].includes(b.rol)) return error(400, "Perfil inválido.");
          sets.push("rol = ?");
          vals.push(b.rol);
        }
        if (typeof b.activo === "boolean") {
          sets.push("activo = ?");
          vals.push(b.activo ? 1 : 0);
        }
        let cerrarSesiones = b.activo === false;
        if (b.password) {
          if (!validarPassword(b.password)) return error(400, "La contraseña debe tener al menos 8 caracteres.");
          const h = await hashNuevo(b.password);
          sets.push("pass_hash = ?", "pass_salt = ?", "pass_iter = ?");
          vals.push(h.pass_hash, h.pass_salt, h.pass_iter);
          cerrarSesiones = true;
        }
        if (sets.length === 0) return error(400, "No hay cambios.");
        sets.push("actualizado_en = ?");
        vals.push(ahora());
        const stmts = [db.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, uid)];
        if (cerrarSesiones && uid !== yo.id) stmts.push(db.prepare("DELETE FROM sesiones WHERE usuario_id = ?").bind(uid));
        await db.batch(stmts);
        const nuevo = await db.prepare("SELECT * FROM usuarios WHERE id = ?").bind(uid).first();
        return json(usuarioPublico(nuevo));
      }
      return error(404, "Ruta no encontrada.");
    }

    // ------------------------- SAP
    if (ruta === "sap" && metodo === "GET") {
      const { results } = await db.prepare("SELECT * FROM sap").all();
      return json(results.map((s) => ({ ...s, en_sap: !!s.en_sap })));
    }

    if (ruta === "sap/sincronizar" && metodo === "POST") {
      const b = await cuerpo();
      const filas = Array.isArray(b.filas) ? b.filas : [];
      if (filas.length === 0) return error(400, "El reporte no trae bultos.");
      if (filas.length > 20000) return error(400, "El reporte es demasiado grande.");
      const { results: actuales } = await db.prepare("SELECT clave, cantidad_sap, en_sap FROM sap").all();
      const porClave = new Map(actuales.map((s) => [s.clave, s]));
      const nuevas = new Set(filas.map((f) => String(f.clave)));
      let creados = 0;
      let cambiosCantidad = 0;
      for (const f of filas) {
        const e = porClave.get(String(f.clave));
        if (!e) creados++;
        else if (Number(e.cantidad_sap) !== Number(f.cantidad_sap)) cambiosCantidad++;
      }
      const t = ahora();
      const limpias = filas.map((f) => ({
        clave: String(f.clave),
        lote: String(f.lote ?? ""),
        material: String(f.material ?? ""),
        texto_breve: String(f.texto_breve ?? ""),
        centro: String(f.centro ?? ""),
        almacen: String(f.almacen ?? ""),
        unidad: String(f.unidad ?? ""),
        cantidad_sap: Number(f.cantidad_sap ?? 0) || 0,
        en_calidad: Number(f.en_calidad ?? 0) || 0,
        etapa: String(f.etapa ?? "OTRO"),
        calibre: String(f.calibre ?? ""),
      }));
      const stmts = [
        db
          .prepare(
            `INSERT INTO sap (clave, lote, material, texto_breve, centro, almacen, unidad, cantidad_sap, en_calidad, etapa, calibre, en_sap, actualizado_en)
             SELECT json_extract(value, '$.clave'), json_extract(value, '$.lote'), json_extract(value, '$.material'),
                    json_extract(value, '$.texto_breve'), json_extract(value, '$.centro'), json_extract(value, '$.almacen'),
                    json_extract(value, '$.unidad'), json_extract(value, '$.cantidad_sap'), json_extract(value, '$.en_calidad'),
                    json_extract(value, '$.etapa'), json_extract(value, '$.calibre'), 1, ?
             FROM json_each(?) WHERE true
             ON CONFLICT(clave) DO UPDATE SET lote = excluded.lote, material = excluded.material, texto_breve = excluded.texto_breve,
               centro = excluded.centro, almacen = excluded.almacen, unidad = excluded.unidad, cantidad_sap = excluded.cantidad_sap,
               en_calidad = excluded.en_calidad, etapa = excluded.etapa, calibre = excluded.calibre, en_sap = 1,
               actualizado_en = excluded.actualizado_en`
          )
          .bind(t, JSON.stringify(limpias)),
      ];
      let yaNoEnSap = 0;
      if (b.marcarFaltantes !== false) {
        yaNoEnSap = actuales.filter((s) => s.en_sap && !nuevas.has(s.clave)).length;
        stmts.push(
          db.prepare("UPDATE sap SET en_sap = 0 WHERE en_sap = 1 AND clave NOT IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...nuevas]))
        );
      }
      await db.batch(stmts);
      await subirVersion(db, { sap: true });
      return json({ creados, actualizados: filas.length - creados, cambiosCantidad, yaNoEnSap, total: filas.length });
    }

    if (ruta === "sap/quitar-fuera" && metodo === "POST") {
      await db.prepare("DELETE FROM sap WHERE en_sap = 0").run();
      await subirVersion(db, { sap: true });
      return json({ ok: true });
    }

    // ------------------------- conteos
    if (ruta === "conteos" && metodo === "GET") {
      const { results } = await db.prepare("SELECT * FROM conteos ORDER BY creado_en DESC").all();
      return json(results.map(parsearConteo));
    }
    if (ruta === "conteos/actual" && metodo === "POST") {
      return json(parsearConteo(await conteoActual(db, yo.nombre)));
    }
    if (ruta === "conteos/nuevo" && metodo === "POST") {
      const totales = JSON.stringify(await totalesSap(db));
      const t = ahora();
      const c = { id: id(), estado: "EN_CURSO", creado_en: t, cerrado_en: null, creado_por: yo.nombre, totales_sap: null };
      await db.batch([
        db.prepare("UPDATE conteos SET estado = 'CERRADO', cerrado_en = ?, totales_sap = ? WHERE estado = 'EN_CURSO'").bind(t, totales),
        db.prepare("INSERT INTO conteos (id, estado, creado_en, cerrado_en, creado_por, totales_sap) VALUES (?, 'EN_CURSO', ?, NULL, ?, NULL)").bind(c.id, t, yo.nombre),
      ]);
      await subirVersion(db);
      return json(c);
    }

    // ------------------------- registros
    if (ruta === "registros" && metodo === "GET") {
      const conteo = url.searchParams.get("conteo");
      // ?cerrados=1 → registros de conteos ya cerrados (no cambian; se leen una vez para el historial)
      const q = conteo
        ? db.prepare("SELECT * FROM registros WHERE conteo_id = ?").bind(conteo)
        : url.searchParams.get("cerrados")
        ? db.prepare("SELECT r.* FROM registros r JOIN conteos c ON c.id = r.conteo_id WHERE c.estado = 'CERRADO'")
        : db.prepare("SELECT * FROM registros");
      const { results } = await q.all();
      return json(results.map(parsearRegistro));
    }

    if (ruta === "registros" && metodo === "POST") {
      const d = await cuerpo();
      if (!d.conteo_id || !d.clave || !d.lote) return error(400, "Faltan datos del registro.");
      const conteo = await db.prepare("SELECT estado FROM conteos WHERE id = ?").bind(d.conteo_id).first();
      if (!conteo || conteo.estado !== "EN_CURSO") return error(400, "Ese conteo ya está cerrado.");
      const anterior = await db.prepare("SELECT * FROM registros WHERE conteo_id = ? AND clave = ?").bind(d.conteo_id, d.clave).first();
      const t = ahora();
      const r = {
        id: anterior?.id ?? id(),
        conteo_id: d.conteo_id,
        clave: String(d.clave),
        lote: String(d.lote),
        material: d.material ?? "",
        texto_breve: d.texto_breve ?? "",
        etapa: d.etapa ?? "OTRO",
        calibre: d.calibre ?? "",
        cantidad_sap: Number(d.cantidad_sap ?? 0),
        cantidad_fisica: d.cantidad_fisica == null ? null : Number(d.cantidad_fisica),
        estado: d.estado ?? "OK",
        motivo: d.motivo ?? null,
        comentario: d.comentario ?? "",
        zona: d.zona ?? null,
        carril: d.carril ?? null,
        posicion: d.posicion == null ? null : Number(d.posicion),
        orden: Date.now(),
        usuario: yo.nombre,
        usuario_id: yo.id,
        creado_en: anterior?.creado_en ?? t,
        actualizado_en: t,
      };
      await db
        .prepare(
          `INSERT INTO registros (id, conteo_id, clave, lote, material, texto_breve, etapa, calibre, cantidad_sap, cantidad_fisica, estado, motivo,
             comentario, zona, carril, posicion, orden, usuario, usuario_id, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(conteo_id, clave) DO UPDATE SET lote = excluded.lote, material = excluded.material, texto_breve = excluded.texto_breve,
             etapa = excluded.etapa, calibre = excluded.calibre, cantidad_sap = excluded.cantidad_sap, cantidad_fisica = excluded.cantidad_fisica,
             estado = excluded.estado, motivo = excluded.motivo, comentario = excluded.comentario, zona = excluded.zona, carril = excluded.carril,
             posicion = excluded.posicion, orden = excluded.orden, usuario = excluded.usuario, usuario_id = excluded.usuario_id,
             actualizado_en = excluded.actualizado_en`
        )
        .bind(
          r.id, r.conteo_id, r.clave, r.lote, r.material, r.texto_breve, r.etapa, r.calibre, r.cantidad_sap, r.cantidad_fisica, r.estado,
          r.motivo, r.comentario, r.zona, r.carril, r.posicion, r.orden, r.usuario, r.usuario_id, r.creado_en, r.actualizado_en
        )
        .run();
      await subirVersion(db);
      return json({ registro: r, anterior: parsearRegistro(anterior) });
    }

    if (ruta.startsWith("registros/") && (metodo === "PATCH" || metodo === "DELETE")) {
      const rid = segmentos[1];
      const r = await db.prepare("SELECT r.*, c.estado AS estado_conteo FROM registros r JOIN conteos c ON c.id = r.conteo_id WHERE r.id = ?").bind(rid).first();
      if (!r) return error(404, "Registro no encontrado.");
      if (r.estado_conteo !== "EN_CURSO") return error(400, "Ese conteo ya está cerrado.");
      if (metodo === "DELETE") {
        await db.prepare("DELETE FROM registros WHERE id = ?").bind(rid).run();
        await subirVersion(db);
        return json({ ok: true });
      }
      const b = await cuerpo();
      const sets = [];
      const vals = [];
      for (const k of CAMPOS_REGISTRO_EDITABLES) {
        if (k in b) {
          sets.push(`${k} = ?`);
          vals.push(k === "posicion" || k === "cantidad_fisica" ? (b[k] == null ? null : Number(b[k])) : b[k] ?? null);
        }
      }
      if ("posicion" in b) {
        sets.push("orden = ?");
        vals.push(Date.now());
      }
      if (sets.length === 0) return error(400, "No hay cambios.");
      sets.push("actualizado_en = ?");
      vals.push(ahora());
      await db.prepare(`UPDATE registros SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, rid).run();
      await subirVersion(db);
      return json(parsearRegistro(await db.prepare("SELECT * FROM registros WHERE id = ?").bind(rid).first()));
    }

    // ------------------------- movimientos (bitácora)
    if (ruta === "movimientos" && metodo === "GET") {
      const conteo = url.searchParams.get("conteo");
      const q = conteo
        ? db.prepare("SELECT * FROM movimientos WHERE conteo_id = ? ORDER BY creado_en DESC LIMIT 300").bind(conteo)
        : db.prepare("SELECT * FROM movimientos ORDER BY creado_en DESC LIMIT 300");
      const { results } = await q.all();
      return json(results);
    }
    if (ruta === "movimientos" && metodo === "POST") {
      const m = await cuerpo();
      if (!m.accion) return error(400, "Falta la acción.");
      const mov = {
        id: id(),
        conteo_id: m.conteo_id ?? null,
        lote: String(m.lote ?? ""),
        accion: String(m.accion).slice(0, 120),
        detalle: String(m.detalle ?? "").slice(0, 1000),
        usuario: yo.nombre,
        usuario_id: yo.id,
        creado_en: ahora(),
      };
      await db
        .prepare("INSERT INTO movimientos (id, conteo_id, lote, accion, detalle, usuario, usuario_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(mov.id, mov.conteo_id, mov.lote, mov.accion, mov.detalle, mov.usuario, mov.usuario_id, mov.creado_en)
        .run();
      await subirVersion(db);
      return json(mov, 201);
    }

    return error(404, "Ruta no encontrada.");
  } catch (e) {
    return error(500, "Error del servidor: " + (e?.message ?? String(e)));
  }
}
