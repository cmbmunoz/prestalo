// =====================================================================
//  PRÉSTALO — Backend/API (Node + Express + PostgreSQL)
//  Login por perfil (alumno/docente/panolero/admin), validaciones y
//  restricciones según la normativa UST-IPST 2018.
//  White-label OCULTO: entidad fija, sin selector ni marca conmutable.
// =====================================================================
const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');
const wa = require('./whatsapp');
const mailer = require('./mailer');
const asistente = require('./asistente');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ENTIDAD_ID = 1;            // entidad fija (white-label oculto)
const ANTICIPACION_RECINTO_H = 72;   // RF-53
const ANTICIPACION_MIN_H = 4;        // RF-15 (general)
const DEMO_PASSWORD = 'prestalo';

// ----------------------- Middleware de sesión -----------------------
async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: 'No autenticado' });
  const { rows } = await db.query(
    `SELECT rut, nombre, rol, estado, email FROM usuario WHERE rut=$1 AND entidad_id=$2`,
    [p.rut, ENTIDAD_ID]);
  if (!rows.length) return res.status(401).json({ error: 'Usuario no válido' });
  if (rows[0].estado !== 'activo') return res.status(403).json({ error: 'Usuario inactivo o suspendido' });
  req.user = rows[0];
  next();
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) ? next()
    : res.status(403).json({ error: 'No autorizado para este perfil' });

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e); res.status(500).json({ error: 'Error interno', detalle: e.message });
});

// ----------------------- Autenticación -----------------------
app.post('/api/login', wrap(async (req, res) => {
  const { rut, email, password } = req.body || {};
  if ((!rut && !email) || !password)
    return res.status(400).json({ error: 'Ingresa tu RUT o correo y la clave' });
  // Login por correo o por RUT, según lo que venga
  const { rows } = email
    ? await db.query(
        `SELECT rut, nombre, rol, estado, password_hash FROM usuario WHERE lower(email)=lower($1) AND entidad_id=$2`,
        [email, ENTIDAD_ID])
    : await db.query(
        `SELECT rut, nombre, rol, estado, password_hash FROM usuario WHERE rut=$1 AND entidad_id=$2`,
        [rut, ENTIDAD_ID]);
  if (!rows.length || !verifyPassword(password, rows[0].password_hash))
    return res.status(401).json({ error: 'Credenciales inválidas' });
  if (rows[0].estado !== 'activo') return res.status(403).json({ error: 'Usuario inactivo o suspendido' });
  const u = rows[0];
  const token = signToken({ rut: u.rut, rol: u.rol, exp: Date.now() + 8 * 3600 * 1000 });
  res.json({ token, user: { rut: u.rut, nombre: u.nombre, rol: u.rol } });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const asigs = await db.query(
    `SELECT a.id, a.nombre, a.seccion FROM usuario_asignatura ua
     JOIN asignatura a ON a.id=ua.asignatura_id WHERE ua.usuario_rut=$1`, [req.user.rut]);
  res.json({ user: req.user, asignaturas: asigs.rows });
}));

// ----------------------- Catálogo de equipos -----------------------
// Alumno/Docente ven solo lo elegible para su asignatura (RF-54).
app.get('/api/equipos', auth, wrap(async (req, res) => {
  const base = `
    SELECT e.id, e.codigo_qr, e.nombre, e.modelo, e.marca, e.tipo, e.estado,
           e.condicion, e.requiere_autorizacion, e.foto_referencia, e.accesorios,
           c.nombre AS categoria, c.id AS categoria_id, c.simbolo,
           l.nombre AS laboratorio
    FROM equipo e
    JOIN categoria c ON c.id=e.categoria_id
    LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
    WHERE e.entidad_id=$1`;
  if (req.user.rol === 'alumno' || req.user.rol === 'docente') {
    const { rows } = await db.query(
      `${base} AND c.id IN (
          SELECT el.categoria_id FROM elegibilidad el
          JOIN usuario_asignatura ua ON ua.asignatura_id=el.asignatura_id
          WHERE ua.usuario_rut=$2)
       ORDER BY e.tipo, c.nombre, e.nombre`, [ENTIDAD_ID, req.user.rut]);
    return res.json(rows);
  }
  const { rows } = await db.query(`${base} ORDER BY e.tipo, c.nombre, e.nombre`, [ENTIDAD_ID]);
  res.json(rows);
}));

app.get('/api/equipos/:id', auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.*, c.nombre AS categoria, c.simbolo, l.nombre AS laboratorio
     FROM equipo e JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
     WHERE e.id=$1 AND e.entidad_id=$2`, [req.params.id, ENTIDAD_ID]);
  if (!rows.length) return res.status(404).json({ error: 'Equipo no encontrado' });
  res.json(rows[0]);
}));

// ----------------------- Reservas (validaciones normativa) -----------------------
app.post('/api/reservas', auth, requireRole('alumno', 'docente'), wrap(async (req, res) => {
  const { equipo_id, fecha_inicio, fecha_fin, uso_academico, asignatura_id, integrantes, motivo } = req.body || {};
  if (!equipo_id || !fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: 'Faltan datos de la reserva' });

  const ini = new Date(fecha_inicio), fin = new Date(fecha_fin), now = new Date();
  if (isNaN(ini) || isNaN(fin)) return res.status(400).json({ error: 'Fechas inválidas' });
  if (fin <= ini) return res.status(400).json({ error: 'La fecha de término debe ser posterior al inicio' });
  if (ini < now) return res.status(400).json({ error: 'La reserva no puede iniciar en el pasado' });

  // RF-55: declaración de uso académico obligatoria
  if (uso_academico !== true)
    return res.status(400).json({ error: 'Debe declarar el uso exclusivamente académico (RF-55)' });

  // Equipo
  const eq = (await db.query(
    `SELECT * FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, ENTIDAD_ID])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (eq.estado !== 'disponible')
    return res.status(409).json({ error: `El equipo no está disponible (estado: ${eq.estado})` });

  // RF-54: elegibilidad equipo × asignatura (alumno/docente)
  const asig = asignatura_id || null;
  if (asig) {
    const eleg = await db.query(
      `SELECT 1 FROM elegibilidad WHERE asignatura_id=$1 AND categoria_id=$2`, [asig, eq.categoria_id]);
    if (!eleg.rows.length)
      return res.status(403).json({ error: 'El equipo no está habilitado para tu asignatura (RF-54)' });
    const insc = await db.query(
      `SELECT 1 FROM usuario_asignatura WHERE usuario_rut=$1 AND asignatura_id=$2`, [req.user.rut, asig]);
    if (!insc.rows.length)
      return res.status(403).json({ error: 'No estás inscrito en esa asignatura' });
  }

  // RF-57/58: sanción vigente bloquea la reserva (alcance global o por asignatura)
  const sanc = await db.query(
    `SELECT motivo, asignatura_id, fecha_fin FROM v_sanciones_vigentes
     WHERE usuario_rut=$1 AND (asignatura_id IS NULL OR asignatura_id=$2)`, [req.user.rut, asig]);
  if (sanc.rows.length)
    return res.status(403).json({ error: `Bloqueado por sanción vigente: ${sanc.rows[0].motivo} (hasta ${sanc.rows[0].fecha_fin})` });

  // RF-51/53: recinto o equipo que requiere autorización → 72 h + flujo Jefatura/DAO
  const esRecinto = eq.tipo === 'recinto' || eq.requiere_autorizacion;
  const horas = (ini - now) / 3600000;
  if (esRecinto) {
    if (horas < ANTICIPACION_RECINTO_H)
      return res.status(400).json({ error: `Los recintos requieren al menos ${ANTICIPACION_RECINTO_H} h de anticipación (RF-53)` });
  } else if (horas < ANTICIPACION_MIN_H) {
    return res.status(400).json({ error: `Reserva con al menos ${ANTICIPACION_MIN_H} h de anticipación` });
  }

  // RF-52: reserva grupal
  const grupo = Array.isArray(integrantes) ? integrantes.filter(i => i && i.nombre && i.rut) : [];
  const esGrupal = grupo.length > 0;

  const estado = esRecinto ? 'pendiente' : 'confirmada';
  const r = (await db.query(
    `INSERT INTO reserva (usuario_rut, equipo_id, fecha_inicio, fecha_fin, estado, uso_academico, es_grupal, motivo)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7) RETURNING id`,
    [req.user.rut, equipo_id, ini, fin, estado, esGrupal, motivo || null])).rows[0];

  // Integrantes (responsabilidad solidaria): el solicitante es responsable
  await db.query(
    `INSERT INTO integrante (reserva_id, usuario_rut, nombre, rut, es_responsable)
     VALUES ($1,$2,$3,$4,TRUE)`, [r.id, req.user.rut, req.user.nombre, req.user.rut]);
  for (const g of grupo) {
    if (g.rut === req.user.rut) continue;
    await db.query(
      `INSERT INTO integrante (reserva_id, nombre, rut, es_responsable) VALUES ($1,$2,$3,FALSE)
       ON CONFLICT (reserva_id, rut) DO NOTHING`, [r.id, g.nombre, g.rut]);
  }

  // Autorización multinivel para recintos (RF-51/53)
  if (esRecinto) {
    await db.query(`INSERT INTO autorizacion (reserva_id, nivel, estado) VALUES ($1,'jefatura_carrera','pendiente'),($1,'direccion_academica','pendiente')`, [r.id]);
  }

  // Equipo pasa a reservado
  await db.query(`UPDATE equipo SET estado='reservado' WHERE id=$1`, [equipo_id]);

  res.status(201).json({
    id: r.id, estado,
    mensaje: esRecinto
      ? 'Reserva creada. Requiere autorización de Jefatura de Carrera y Dirección Académica (DAO).'
      : 'Reserva confirmada.'
  });
}));

app.get('/api/mis-reservas', auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, r.es_grupal, r.uso_academico,
            e.nombre AS equipo, e.tipo, c.nombre AS categoria,
            (SELECT count(*) FROM integrante i WHERE i.reserva_id=r.id) AS integrantes
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE r.usuario_rut=$1 ORDER BY r.fecha_inicio DESC`, [req.user.rut]);
  res.json(rows);
}));

// ----------------------- Flujo de préstamo (lista + detalle) -----------------------
// Lista para la pestaña "Préstamos", con el estado del flujo por reserva.
app.get('/api/flujo', auth, wrap(async (req, res) => {
  const soloMios = (req.user.rol === 'alumno' || req.user.rol === 'docente');
  const params = [ENTIDAD_ID];
  let filtro = '';
  if (soloMios) { params.push(req.user.rut); filtro = 'AND r.usuario_rut=$2'; }
  const { rows } = await db.query(
    `SELECT r.id, r.estado, r.fecha_inicio, r.fecha_fin, r.usuario_rut,
            e.nombre AS equipo, e.marca, c.nombre AS categoria, u.nombre AS solicitante,
            (SELECT p.estado FROM prestamo p WHERE p.reserva_id=r.id) AS prestamo_estado
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     JOIN usuario u ON u.rut=r.usuario_rut
     WHERE e.entidad_id=$1 ${filtro}
     ORDER BY r.fecha_inicio DESC LIMIT 100`, params);
  const flowOf = (estado, pe) => {
    if (pe === 'devuelto' || estado === 'completada') return 'devuelto';
    if (pe === 'abierto' || pe === 'atrasado') return 'entregado';
    if (estado === 'confirmada') return 'aprobada';
    if (estado === 'cancelada' || estado === 'expirada') return estado;
    return 'pendiente';
  };
  res.json(rows.map(r => ({
    id: r.id, folio: 'PR-' + String(r.id).padStart(4, '0'),
    equipo: r.equipo, marca: r.marca, categoria: r.categoria,
    solicitante: r.solicitante, flow: flowOf(r.estado, r.prestamo_estado),
    fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
  })));
}));

// Detalle de un préstamo/solicitud con el flujo y el historial (prototipo).
app.get('/api/flujo/:id', auth, wrap(async (req, res) => {
  const r = (await db.query(
    `SELECT r.*, e.nombre AS equipo, e.marca, e.codigo_qr, c.nombre AS categoria,
            COALESCE(l.nombre, '—') AS laboratorio
     FROM reserva r JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     LEFT JOIN laboratorio l ON l.id=e.laboratorio_id
     WHERE r.id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  if ((req.user.rol === 'alumno' || req.user.rol === 'docente') && r.usuario_rut !== req.user.rut)
    return res.status(403).json({ error: 'No autorizado' });

  const prestamo = (await db.query(`SELECT * FROM prestamo WHERE reserva_id=$1`, [r.id])).rows[0];
  const sol = (await db.query(`SELECT nombre FROM usuario WHERE rut=$1`, [r.usuario_rut])).rows[0];

  let flow = 'pendiente';
  if (r.estado === 'confirmada') flow = 'aprobada';
  if (prestamo && ['abierto', 'atrasado'].includes(prestamo.estado)) flow = 'entregado';
  if ((prestamo && prestamo.estado === 'devuelto') || r.estado === 'completada') flow = 'devuelto';

  const hist = [];
  hist.push({ orden: 1, evento: 'Solicitud enviada', actor: sol?.nombre || r.usuario_rut, fecha: r.created_at, nota: r.motivo || null });
  if (!['pendiente', 'cancelada', 'expirada'].includes(r.estado)) {
    const aut = (await db.query(
      `SELECT autorizante, fecha FROM autorizacion WHERE reserva_id=$1 AND estado='aprobada' ORDER BY fecha DESC LIMIT 1`, [r.id])).rows[0];
    hist.push({ orden: 2, evento: 'Solicitud aprobada', actor: aut?.autorizante || 'Pañol', fecha: aut?.fecha || r.updated_at, nota: null });
  }
  if (prestamo) {
    const pan = prestamo.panolero_rut
      ? (await db.query(`SELECT nombre FROM usuario WHERE rut=$1`, [prestamo.panolero_rut])).rows[0] : null;
    hist.push({ orden: 3, evento: 'Equipo entregado', actor: pan?.nombre || 'Pañol', fecha: prestamo.fecha_salida, nota: prestamo.observacion || null });
    if (prestamo.estado === 'devuelto')
      hist.push({ orden: 4, evento: 'Equipo devuelto', actor: pan?.nombre || 'Pañol', fecha: prestamo.fecha_retorno, nota: prestamo.condicion_retorno ? ('Condición: ' + prestamo.condicion_retorno) : null });
  }
  res.json({
    id: r.id, folio: 'PR-' + String(r.id).padStart(4, '0'), flow, estado: r.estado,
    equipo: { nombre: r.equipo, marca: r.marca, codigo_qr: r.codigo_qr, categoria: r.categoria },
    periodo: { inicio: r.fecha_inicio, fin: r.fecha_fin },
    cantidad: 1, ubicacion: r.laboratorio, motivo: r.motivo || null,
    historial: hist.filter(h => h.fecha).sort((a, b) => a.orden - b.orden).map(({ orden, ...h }) => h),
  });
}));

app.post('/api/reservas/:id/cancelar', auth, wrap(async (req, res) => {
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.usuario_rut !== req.user.rut && !['panolero', 'admin'].includes(req.user.rol))
    return res.status(403).json({ error: 'No puedes cancelar esta reserva' });
  if (['completada', 'cancelada'].includes(r.estado))
    return res.status(409).json({ error: 'La reserva ya está cerrada' });
  await db.query(`UPDATE reserva SET estado='cancelada', motivo_cancelacion=$2 WHERE id=$1`,
    [r.id, req.body?.motivo || 'Cancelada por el usuario']);
  await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1 AND estado='reservado'`, [r.equipo_id]);
  res.json({ ok: true });
}));

// ----------------------- Pañolero: agenda / entrega / recepción -----------------------
app.get('/api/agenda', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, u.nombre AS usuario, u.rut,
            e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, e.tipo, c.nombre AS categoria
     FROM reserva r JOIN usuario u ON u.rut=r.usuario_rut
     JOIN equipo e ON e.id=r.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE r.estado='confirmada' AND e.entidad_id=$1
     ORDER BY r.fecha_inicio`, [ENTIDAD_ID]);
  res.json(rows);
}));

// Entregar (check-out) — crea préstamo, verifica QR opcional
app.post('/api/entregar', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { reserva_id, qr, condicion_salida } = req.body || {};
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [reserva_id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.estado !== 'confirmada') return res.status(409).json({ error: `La reserva está ${r.estado}` });
  const eq = (await db.query(`SELECT * FROM equipo WHERE id=$1`, [r.equipo_id])).rows[0];
  if (qr && qr.toLowerCase() !== eq.codigo_qr.toLowerCase())
    return res.status(409).json({ error: `El QR escaneado (${qr}) no corresponde al equipo` });

  const p = (await db.query(
    `INSERT INTO prestamo (reserva_id, usuario_rut, equipo_id, panolero_rut, condicion_salida, estado)
     VALUES ($1,$2,$3,$4,$5,'abierto') RETURNING id`,
    [r.id, r.usuario_rut, r.equipo_id, req.user.rut, condicion_salida || eq.condicion])).rows[0];
  await db.query(`UPDATE reserva SET estado='en_uso' WHERE id=$1`, [r.id]);
  await db.query(`UPDATE equipo SET estado='prestado' WHERE id=$1`, [r.equipo_id]);
  res.status(201).json({ id: p.id, mensaje: 'Entrega registrada' });
}));

// Equipos por recibir (en préstamo)
app.get('/api/por-recibir', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id AS prestamo_id, p.fecha_salida, u.nombre AS usuario, u.rut,
            e.id AS equipo_id, e.nombre AS equipo, e.codigo_qr, c.nombre AS categoria
     FROM prestamo p JOIN usuario u ON u.rut=p.usuario_rut
     JOIN equipo e ON e.id=p.equipo_id JOIN categoria c ON c.id=e.categoria_id
     WHERE p.estado IN ('abierto','atrasado') AND e.entidad_id=$1
     ORDER BY p.fecha_salida`, [ENTIDAD_ID]);
  res.json(rows);
}));

// Recibir (check-in) — RF-59: daño → bloqueo por reposición + sanción
app.post('/api/recibir', auth, requireRole('panolero', 'admin'), wrap(async (req, res) => {
  const { prestamo_id, condicion_retorno, observacion } = req.body || {};
  const p = (await db.query(`SELECT * FROM prestamo WHERE id=$1`, [prestamo_id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Préstamo no encontrado' });
  if (p.estado === 'devuelto') return res.status(409).json({ error: 'El préstamo ya fue devuelto' });

  const danio = ['con_danio', 'inoperativo'].includes(condicion_retorno);
  await db.query(
    `UPDATE prestamo SET estado='devuelto', fecha_retorno=now(), condicion_retorno=$2,
            requiere_reposicion=$3, observacion=$4 WHERE id=$1`,
    [p.id, condicion_retorno || 'bueno', danio, observacion || null]);
  await db.query(`UPDATE reserva SET estado='completada' WHERE id=$1`, [p.reserva_id]);
  // Equipo: a mantención si hay daño, si no disponible
  await db.query(`UPDATE equipo SET estado=$2, condicion=$3 WHERE id=$1`,
    [p.equipo_id, danio ? 'mantencion' : 'disponible', condicion_retorno || 'bueno']);

  let sancion = null;
  if (danio) {
    const fin = new Date(); fin.setDate(fin.getDate() + 30); // bloqueo 1 mes por daño (RF-59)
    const s = (await db.query(
      `INSERT INTO sancion (usuario_rut, motivo, tramo, fecha_fin, vigente)
       VALUES ($1,$2,'grave',$3,TRUE) RETURNING id`,
      [p.usuario_rut, 'Equipo devuelto con daño — bloqueo hasta reposición', fin])).rows[0];
    await db.query(
      `INSERT INTO mantencion (equipo_id, tipo, detalle) VALUES ($1,'reposicion',$2)`,
      [p.equipo_id, observacion || 'Daño detectado en devolución']);
    sancion = s.id;
  }
  res.json({ ok: true, requiere_reposicion: danio, sancion });
}));

// ----------------------- Autorizaciones (recintos) -----------------------
app.get('/api/autorizaciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.reserva_id, a.nivel, a.estado, r.fecha_inicio, u.nombre AS solicitante,
            e.nombre AS recinto
     FROM autorizacion a JOIN reserva r ON r.id=a.reserva_id
     JOIN usuario u ON u.rut=r.usuario_rut JOIN equipo e ON e.id=r.equipo_id
     WHERE a.estado='pendiente' ORDER BY a.reserva_id, a.nivel`);
  res.json(rows);
}));

app.post('/api/autorizaciones/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { decision, comentario } = req.body || {}; // 'aprobada' | 'rechazada'
  if (!['aprobada', 'rechazada'].includes(decision))
    return res.status(400).json({ error: 'Decisión inválida' });
  const a = (await db.query(
    `UPDATE autorizacion SET estado=$2, autorizante=$3, comentario=$4, fecha=now()
     WHERE id=$1 RETURNING reserva_id`, [req.params.id, decision, req.user.nombre, comentario || null])).rows[0];
  if (!a) return res.status(404).json({ error: 'Autorización no encontrada' });

  if (decision === 'rechazada') {
    await db.query(`UPDATE reserva SET estado='cancelada', motivo_cancelacion='Autorización rechazada' WHERE id=$1`, [a.reserva_id]);
    const r = (await db.query(`SELECT equipo_id FROM reserva WHERE id=$1`, [a.reserva_id])).rows[0];
    await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1`, [r.equipo_id]);
    return res.json({ ok: true, reserva: 'cancelada' });
  }
  // Si TODOS los niveles están aprobados → reserva confirmada
  const pend = await db.query(
    `SELECT count(*)::int AS n FROM autorizacion WHERE reserva_id=$1 AND estado<>'aprobada'`, [a.reserva_id]);
  if (pend.rows[0].n === 0) {
    await db.query(`UPDATE reserva SET estado='confirmada' WHERE id=$1`, [a.reserva_id]);
    return res.json({ ok: true, reserva: 'confirmada' });
  }
  res.json({ ok: true, reserva: 'pendiente' });
}));

// ----------------------- Admin: inventario, usuarios, sanciones, KPIs -----------------------
app.get('/api/admin/kpis', auth, requireRole('admin'), wrap(async (req, res) => {
  const q = (s) => db.query(s, [ENTIDAD_ID]).then(r => r.rows[0].n);
  res.json({
    equipos: await q(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1`),
    disponibles: await q(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='disponible'`),
    reservas_activas: await q(`SELECT count(*)::int n FROM reserva r JOIN equipo e ON e.id=r.equipo_id WHERE e.entidad_id=$1 AND r.estado IN ('pendiente','confirmada','en_uso')`),
    prestamos_abiertos: await q(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')`),
    sanciones_vigentes: await q(`SELECT count(*)::int n FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.vigente=TRUE AND s.fecha_fin>=CURRENT_DATE`),
    reposiciones: await q(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.requiere_reposicion=TRUE`),
  });
}));

// Dashboard enriquecido para el panel móvil (y web)
app.get('/api/admin/dashboard', auth, requireRole('admin'), wrap(async (req, res) => {
  const one = (s) => db.query(s, [ENTIDAD_ID]).then(r => r.rows[0].n);
  const kpis = {
    prestamos_activos: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')`),
    reservas_vigentes: await one(`SELECT count(*)::int n FROM reserva r JOIN equipo e ON e.id=r.equipo_id WHERE e.entidad_id=$1 AND r.estado IN ('pendiente','confirmada','en_uso')`),
    solicitudes_pendientes: await one(`SELECT count(*)::int n FROM solicitud_especial s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.estado='pendiente'`),
    equipos_disponibles: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='disponible'`),
    total_equipos: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1`),
    atrasados: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.estado='atrasado'`),
    en_mantencion: await one(`SELECT count(*)::int n FROM equipo WHERE entidad_id=$1 AND estado='mantencion'`),
    sanciones_vigentes: await one(`SELECT count(*)::int n FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1 AND s.vigente=TRUE AND s.fecha_fin>=CURRENT_DATE`),
    reposiciones: await one(`SELECT count(*)::int n FROM prestamo p JOIN equipo e ON e.id=p.equipo_id WHERE e.entidad_id=$1 AND p.requiere_reposicion=TRUE`),
  };
  const top = (await db.query(
    `SELECT e.nombre, count(r.*)::int AS total
     FROM equipo e LEFT JOIN reserva r ON r.equipo_id=e.id
     WHERE e.entidad_id=$1
     GROUP BY e.id, e.nombre ORDER BY total DESC, e.nombre LIMIT 5`, [ENTIDAD_ID])).rows;
  const inv = (await db.query(
    `SELECT estado, count(*)::int AS n FROM equipo WHERE entidad_id=$1 GROUP BY estado`, [ENTIDAD_ID])).rows
    .reduce((a, r) => (a[r.estado] = r.n, a), {});
  const inventario = ['disponible','prestado','reservado','mantencion','baja']
    .map(k => ({ estado: k, n: inv[k] || 0 }));
  const devoluciones = (await db.query(
    `SELECT e.nombre AS equipo, u.nombre AS usuario, p.fecha_salida
     FROM prestamo p JOIN equipo e ON e.id=p.equipo_id JOIN usuario u ON u.rut=p.usuario_rut
     WHERE e.entidad_id=$1 AND p.estado IN ('abierto','atrasado')
     ORDER BY p.fecha_salida LIMIT 5`, [ENTIDAD_ID])).rows;
  const tendencia = (await db.query(
    `SELECT to_char(date_trunc('week', p.fecha_salida), 'DD-MM') AS semana, count(*)::int AS n
     FROM prestamo p JOIN equipo e ON e.id=p.equipo_id
     WHERE e.entidad_id=$1 AND p.fecha_salida >= (CURRENT_DATE - INTERVAL '8 weeks')
     GROUP BY date_trunc('week', p.fecha_salida)
     ORDER BY date_trunc('week', p.fecha_salida)`, [ENTIDAD_ID])).rows;
  res.json({ kpis, top_solicitados: top, inventario, devoluciones_proximas: devoluciones, tendencia });
}));

app.post('/api/admin/equipos', auth, requireRole('admin'), wrap(async (req, res) => {
  const { codigo_qr, nombre, modelo, marca, n_serie, tipo, categoria_id, requiere_autorizacion, accesorios } = req.body || {};
  if (!codigo_qr || !nombre || !categoria_id) return res.status(400).json({ error: 'codigo_qr, nombre y categoria_id requeridos' });
  const reqAut = tipo === 'recinto' ? true : !!requiere_autorizacion;
  try {
    const r = (await db.query(
      `INSERT INTO equipo (codigo_qr, nombre, modelo, marca, n_serie, tipo, categoria_id, requiere_autorizacion, accesorios, entidad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [codigo_qr, nombre, modelo || null, marca || null, n_serie || null, tipo || 'equipo', categoria_id, reqAut, accesorios || null, ENTIDAD_ID])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'El código QR ya existe' });
    throw e;
  }
}));

app.post('/api/admin/equipos/:id/estado', auth, requireRole('admin'), wrap(async (req, res) => {
  const { estado } = req.body || {};
  const permitidos = ['disponible', 'mantencion', 'baja'];
  if (!permitidos.includes(estado)) return res.status(400).json({ error: 'Estado no permitido' });
  await db.query(`UPDATE equipo SET estado=$2 WHERE id=$1 AND entidad_id=$3`, [req.params.id, estado, ENTIDAD_ID]);
  res.json({ ok: true });
}));

app.get('/api/admin/usuarios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT rut, nombre, email, rol, estado FROM usuario WHERE entidad_id=$1 ORDER BY rol, nombre`, [ENTIDAD_ID]);
  res.json(rows);
}));

// --- Gestión de usuarios (alta/edición/estado/clave) ---
const ROLES_OK = ['alumno', 'docente', 'panolero', 'admin'];
const ESTADOS_OK = ['activo', 'inactivo', 'suspendido'];

app.post('/api/admin/usuarios', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rut, nombre, email, rol, estado, password } = req.body || {};
  if (!rut || !nombre || !rol) return res.status(400).json({ error: 'RUT, nombre y rol son obligatorios' });
  if (!ROLES_OK.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
  const est = ESTADOS_OK.includes(estado) ? estado : 'activo';
  const hash = password ? hashPassword(password) : null;
  try {
    await db.query(
      `INSERT INTO usuario (rut, nombre, email, rol, estado, password_hash, entidad_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rut, nombre, email || null, rol, est, hash, ENTIDAD_ID]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese RUT o correo' });
    throw e;
  }
}));

app.put('/api/admin/usuarios/:rut', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, email, rol, estado } = req.body || {};
  if (rol && !ROLES_OK.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
  if (estado && !ESTADOS_OK.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  const r = await db.query(
    `UPDATE usuario SET nombre=COALESCE($2,nombre), email=COALESCE($3,email), rol=COALESCE($4,rol), estado=COALESCE($5,estado)
     WHERE rut=$1 AND entidad_id=$6`,
    [req.params.rut, nombre || null, email || null, rol || null, estado || null, ENTIDAD_ID]);
  if (!r.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}));

app.post('/api/admin/usuarios/:rut/estado', auth, requireRole('admin'), wrap(async (req, res) => {
  const { estado } = req.body || {};
  if (!ESTADOS_OK.includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
  await db.query(`UPDATE usuario SET estado=$2 WHERE rut=$1 AND entidad_id=$3`, [req.params.rut, estado, ENTIDAD_ID]);
  res.json({ ok: true });
}));

app.post('/api/admin/usuarios/:rut/clave', auth, requireRole('admin'), wrap(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });
  await db.query(`UPDATE usuario SET password_hash=$2 WHERE rut=$1 AND entidad_id=$3`, [req.params.rut, hashPassword(password), ENTIDAD_ID]);
  res.json({ ok: true });
}));

app.get('/api/admin/sanciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.usuario_rut, u.nombre, s.motivo, s.tramo, s.fecha_inicio, s.fecha_fin, s.solidaria, s.vigente
     FROM sancion s JOIN usuario u ON u.rut=s.usuario_rut WHERE u.entidad_id=$1
     ORDER BY s.vigente DESC, s.fecha_fin DESC`, [ENTIDAD_ID]);
  res.json(rows);
}));

app.post('/api/admin/sanciones/:id/levantar', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`UPDATE sancion SET vigente=FALSE WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/sanciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { usuario_rut, motivo, tramo, dias, asignatura_id, solidaria } = req.body || {};
  if (!usuario_rut || !motivo || !tramo) return res.status(400).json({ error: 'Datos de sanción incompletos' });
  const fin = new Date(); fin.setDate(fin.getDate() + (Number(dias) || 7));
  const r = (await db.query(
    `INSERT INTO sancion (usuario_rut, asignatura_id, motivo, tramo, fecha_fin, solidaria, vigente)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
    [usuario_rut, asignatura_id || null, motivo, tramo, fin, !!solidaria])).rows[0];
  res.status(201).json({ id: r.id });
}));

// ----------------------- Chatbot WhatsApp (RF-61) -----------------------
// Chat dentro de la app: responde con el motor y registra la conversación.
app.post('/api/whatsapp', auth, wrap(async (req, res) => {
  const { telefono, consulta } = req.body || {};
  if (!consulta) return res.status(400).json({ error: 'Consulta vacía' });
  const bot = await wa.responder(req.user, consulta);
  const r = (await db.query(
    `INSERT INTO consulta_whatsapp (usuario_rut, telefono, rol, consulta, respuesta, estado)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.user.rut, telefono || '—', req.user.rol, consulta, bot.texto, bot.estado])).rows[0];
  res.status(201).json({ id: r.id, estado: bot.estado, respuesta: bot.texto });
}));

// Webhook Meta (WhatsApp Business API) — verificación
app.get('/webhook/whatsapp', (req, res) => {
  const token = process.env.WHATSAPP_VERIFY_TOKEN || 'prestalo-verify';
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token)
    return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// Webhook Meta — mensajes entrantes (número real de la institución)
app.post('/webhook/whatsapp', wrap(async (req, res) => {
  res.sendStatus(200); // Meta exige 200 inmediato
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;
    const telefono = msg.from, texto = msg.text.body;
    // Identificar al usuario por teléfono (si está registrado)
    const u = (await db.query(
      `SELECT rut, nombre, rol FROM usuario WHERE entidad_id=$1 AND email IS NOT NULL LIMIT 0`, [ENTIDAD_ID])).rows[0] || null;
    const bot = await wa.responder(u, texto);
    await db.query(
      `INSERT INTO consulta_whatsapp (telefono, consulta, respuesta, estado) VALUES ($1,$2,$3,$4)`,
      [telefono, texto, bot.texto, bot.estado]);
    await wa.sendWhatsApp(telefono, bot.texto);
  } catch (e) { console.error('webhook wa:', e.message); }
}));

// ----------------------- RF-56: expiración por no-show -----------------------
async function expirarNoShow() {
  // Reservas con atraso > 1 h sin justificación y sin préstamo asociado
  const exp = await db.query(
    `UPDATE reserva r SET estado='expirada',
            motivo_cancelacion='No-show: atraso > 1 h sin justificación (RF-56)'
     WHERE r.estado IN ('pendiente','confirmada')
       AND r.justificada = FALSE
       AND r.fecha_inicio < now() - interval '1 hour'
       AND NOT EXISTS (SELECT 1 FROM prestamo p WHERE p.reserva_id = r.id)
     RETURNING r.id, r.equipo_id`);
  for (const row of exp.rows)
    await db.query(`UPDATE equipo SET estado='disponible' WHERE id=$1 AND estado='reservado'`, [row.equipo_id]);
  if (exp.rows.length) console.log(`RF-56: ${exp.rows.length} reserva(s) expirada(s) por no-show`);
  return exp.rows.length;
}

// Justificar atraso (evita la expiración) — RF-56
app.post('/api/reservas/:id/justificar', auth, wrap(async (req, res) => {
  const { justificacion } = req.body || {};
  if (!justificacion) return res.status(400).json({ error: 'Indica la justificación' });
  const r = (await db.query(`SELECT * FROM reserva WHERE id=$1`, [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
  if (r.usuario_rut !== req.user.rut && !['panolero', 'admin'].includes(req.user.rol))
    return res.status(403).json({ error: 'No puedes justificar esta reserva' });
  await db.query(`UPDATE reserva SET justificada=TRUE, justificacion=$2 WHERE id=$1`, [r.id, justificacion]);
  res.json({ ok: true });
}));

// Ejecutar manualmente la rutina de no-show (admin)
app.post('/api/admin/run-noshow', auth, requireRole('admin'), wrap(async (req, res) => {
  const n = await expirarNoShow();
  res.json({ expiradas: n });
}));

// ----------------------- A.2: Recuperación de clave (RF-02) -----------------------
app.post('/api/recuperar', wrap(async (req, res) => {
  const { rut, email } = req.body || {};
  if (!rut || !email) return res.status(400).json({ error: 'RUT y correo requeridos' });
  const r = (await db.query(
    `SELECT rut, email FROM usuario WHERE rut=$1 AND lower(email)=lower($2) AND entidad_id=$3`,
    [rut, email, ENTIDAD_ID])).rows[0];
  // Si coinciden, genera el token y envía el correo (sin revelar si existe o no).
  if (r) {
    const token = mailer.makeResetToken(r.rut);
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset.html?token=${encodeURIComponent(token)}`;
    try { await mailer.sendResetEmail(r.email, link); } catch (e) { console.error('mail:', e.message); }
  }
  res.json({ ok: true, mensaje: 'Si los datos coinciden, enviaremos un enlace de recuperación al correo registrado.' });
}));

// Restablecer contraseña con el token recibido por correo
app.post('/api/reset', wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token y nueva clave requeridos' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La clave debe tener al menos 6 caracteres' });
  const p = mailer.verifyResetToken(token);
  if (!p) return res.status(400).json({ error: 'El enlace es inválido o expiró. Solicita uno nuevo.' });
  await db.query(`UPDATE usuario SET password_hash=$1 WHERE rut=$2 AND entidad_id=$3`,
    [hashPassword(password), p.rut, ENTIDAD_ID]);
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
}));

// ----------------------- A.2: Perfil (RF-06) -----------------------
app.put('/api/perfil', auth, wrap(async (req, res) => {
  const { nombre, email, password, foto_url } = req.body || {};
  const sets = [], vals = []; let i = 1;
  if (nombre)  { sets.push(`nombre=$${i++}`); vals.push(nombre); }
  if (email)   { sets.push(`email=$${i++}`);  vals.push(email); }
  if (foto_url){ sets.push(`foto_url=$${i++}`); vals.push(foto_url); }
  if (password){ sets.push(`password_hash=$${i++}`); vals.push(hashPassword(password)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.user.rut);
  try {
    await db.query(`UPDATE usuario SET ${sets.join(', ')} WHERE rut=$${i}`, vals);
  } catch (e) {
    if (e.code === '42703') { // sin columna foto_url: reintentar sin ella
      return res.status(400).json({ error: 'Campo no disponible' });
    }
    throw e;
  }
  res.json({ ok: true });
}));

// ----------------------- A.2: Categorías y laboratorios (RF-10) -----------------------
app.get('/api/categorias', auth, wrap(async (req, res) => {
  res.json((await db.query(`SELECT id, nombre, simbolo FROM categoria ORDER BY nombre`)).rows);
}));
app.get('/api/laboratorios', auth, wrap(async (req, res) => {
  res.json((await db.query(`SELECT id, nombre, ubicacion FROM laboratorio WHERE entidad_id=$1 ORDER BY nombre`, [ENTIDAD_ID])).rows);
}));
app.get('/api/academico', auth, requireRole('admin','docente'), wrap(async (req, res) => {
  const carreras = (await db.query(`SELECT id, nombre FROM carrera WHERE entidad_id=$1 ORDER BY nombre`, [ENTIDAD_ID])).rows;
  const asignaturas = (await db.query(`SELECT a.id, a.nombre, a.seccion, a.carrera_id FROM asignatura a JOIN carrera c ON c.id=a.carrera_id WHERE c.entidad_id=$1 ORDER BY a.nombre`, [ENTIDAD_ID])).rows;
  res.json({ carreras, asignaturas });
}));

// ----------------------- Admin: Estructura académica (carreras / asignaturas / inscripción) -----------------------
app.post('/api/admin/carreras', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const r = (await db.query(`INSERT INTO carrera (nombre, entidad_id) VALUES ($1,$2) RETURNING id`, [nombre.trim(), ENTIDAD_ID])).rows[0];
    res.status(201).json({ id: r.id });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una carrera con ese nombre' }); throw e; }
}));
app.put('/api/admin/carreras/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const r = await db.query(`UPDATE carrera SET nombre=$2 WHERE id=$1 AND entidad_id=$3`, [req.params.id, nombre.trim(), ENTIDAD_ID]);
  if (!r.rowCount) return res.status(404).json({ error: 'Carrera no encontrada' });
  res.json({ ok: true });
}));
app.delete('/api/admin/carreras/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM carrera WHERE id=$1 AND entidad_id=$2`, [req.params.id, ENTIDAD_ID]);
  res.json({ ok: true });
}));

app.post('/api/admin/asignaturas', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, seccion, carrera_id } = req.body || {};
  if (!nombre || !carrera_id) return res.status(400).json({ error: 'Nombre y carrera son obligatorios' });
  const c = await db.query(`SELECT 1 FROM carrera WHERE id=$1 AND entidad_id=$2`, [carrera_id, ENTIDAD_ID]);
  if (!c.rowCount) return res.status(400).json({ error: 'Carrera no válida' });
  const r = (await db.query(`INSERT INTO asignatura (nombre, seccion, carrera_id) VALUES ($1,$2,$3) RETURNING id`, [nombre.trim(), seccion || null, carrera_id])).rows[0];
  res.status(201).json({ id: r.id });
}));
app.put('/api/admin/asignaturas/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  const { nombre, seccion } = req.body || {};
  const r = await db.query(
    `UPDATE asignatura SET nombre=COALESCE($2,nombre), seccion=$3
     WHERE id=$1 AND carrera_id IN (SELECT id FROM carrera WHERE entidad_id=$4)`,
    [req.params.id, nombre || null, seccion || null, ENTIDAD_ID]);
  if (!r.rowCount) return res.status(404).json({ error: 'Asignatura no encontrada' });
  res.json({ ok: true });
}));
app.delete('/api/admin/asignaturas/:id', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM asignatura WHERE id=$1 AND carrera_id IN (SELECT id FROM carrera WHERE entidad_id=$2)`, [req.params.id, ENTIDAD_ID]);
  res.json({ ok: true });
}));

app.get('/api/admin/asignaturas/:id/inscritos', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT ua.usuario_rut AS rut, u.nombre, ua.rol_en_asig FROM usuario_asignatura ua
     JOIN usuario u ON u.rut=ua.usuario_rut
     WHERE ua.asignatura_id=$1 AND u.entidad_id=$2 ORDER BY ua.rol_en_asig, u.nombre`, [req.params.id, ENTIDAD_ID]);
  res.json(rows);
}));
app.post('/api/admin/asignaturas/:id/inscritos', auth, requireRole('admin'), wrap(async (req, res) => {
  const { usuario_rut, rol_en_asig } = req.body || {};
  if (!usuario_rut) return res.status(400).json({ error: 'RUT requerido' });
  const rol = rol_en_asig === 'docente' ? 'docente' : 'alumno';
  const u = await db.query(`SELECT 1 FROM usuario WHERE rut=$1 AND entidad_id=$2`, [usuario_rut, ENTIDAD_ID]);
  if (!u.rowCount) return res.status(400).json({ error: 'El usuario no existe' });
  try {
    await db.query(`INSERT INTO usuario_asignatura (usuario_rut, asignatura_id, rol_en_asig) VALUES ($1,$2,$3)`, [usuario_rut, req.params.id, rol]);
    res.status(201).json({ ok: true });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'El usuario ya está inscrito' }); throw e; }
}));
app.delete('/api/admin/asignaturas/:id/inscritos/:rut', auth, requireRole('admin'), wrap(async (req, res) => {
  await db.query(`DELETE FROM usuario_asignatura WHERE asignatura_id=$1 AND usuario_rut=$2`, [req.params.id, req.params.rut]);
  res.json({ ok: true });
}));

// ----------------------- Admin: Mantenciones (RF-30/31/32) -----------------------
app.get('/api/admin/mantenciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.id, m.tipo, m.fecha, m.detalle, m.costo, e.nombre AS equipo, e.codigo_qr, e.id AS equipo_id
     FROM mantencion m JOIN equipo e ON e.id=m.equipo_id WHERE e.entidad_id=$1
     ORDER BY m.fecha DESC, m.id DESC`, [ENTIDAD_ID]);
  res.json(rows);
}));
app.post('/api/admin/mantenciones', auth, requireRole('admin'), wrap(async (req, res) => {
  const { equipo_id, tipo, detalle, costo, fecha, cerrar } = req.body || {};
  if (!equipo_id || !tipo) return res.status(400).json({ error: 'equipo_id y tipo requeridos' });
  const eq = (await db.query(`SELECT 1 FROM equipo WHERE id=$1 AND entidad_id=$2`, [equipo_id, ENTIDAD_ID])).rows[0];
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  const m = (await db.query(
    `INSERT INTO mantencion (equipo_id, tipo, detalle, costo, fecha)
     VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE)) RETURNING id`,
    [equipo_id, tipo, detalle || null, costo || null, fecha || null])).rows[0];
  // Poner el equipo en mantención (o disponible si se cierra)
  await db.query(`UPDATE equipo SET estado=$2 WHERE id=$1`, [equipo_id, cerrar ? 'disponible' : 'mantencion']);
  res.status(201).json({ id: m.id });
}));

// ----------------------- Carga masiva Excel (RF-11 / RF-44) -----------------------
async function leerFilas(buffer, headersEsperados) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas');
  const headers = (ws.getRow(1).values || []).map(v => (v == null ? '' : String(v).trim().toLowerCase()));
  const col = {}; headersEsperados.forEach(h => { col[h] = headers.indexOf(h); });
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (h) => { const i = col[h]; return i >= 0 ? (row.values[i] ?? '') : ''; };
    const obj = {}; headersEsperados.forEach(h => obj[h] = String(get(h) ?? '').trim());
    if (Object.values(obj).some(v => v !== '')) filas.push({ n, ...obj });
  });
  return { filas, headers };
}

// Plantillas descargables
app.get('/api/admin/import/plantilla/:tipo', auth, requireRole('admin'), wrap(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  if (req.params.tipo === 'equipos') {
    ws.addRow(['codigo_qr','nombre','modelo','marca','n_serie','categoria','tipo']);
    ws.addRow(['QR-CAM-100','Cámara Sony FX3','FX3','Sony','SN-12345','Cámaras','equipo']);
  } else if (req.params.tipo === 'nomina') {
    ws.addRow(['rut','nombre','email','rol']);
    ws.addRow(['12.345.678-9','Juan Pérez','juan@ust.cl','alumno']);
  } else return res.status(400).json({ error: 'Tipo inválido (equipos|nomina)' });
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=plantilla_${req.params.tipo}.xlsx`);
  await wb.xlsx.write(res); res.end();
}));

// Importar inventario (RF-11) — validación por fila
app.post('/api/admin/import/equipos', auth, requireRole('admin'), upload.single('archivo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo .xlsx (campo "archivo")' });
  const { filas } = await leerFilas(req.file.buffer, ['codigo_qr','nombre','modelo','marca','n_serie','categoria','tipo']);
  const cats = (await db.query(`SELECT id, lower(nombre) AS n FROM categoria`)).rows
    .reduce((a, r) => (a[r.n] = r.id, a), {});
  let insertados = 0; const errores = [];
  for (const f of filas) {
    if (!f.codigo_qr || !f.nombre) { errores.push({ fila: f.n, error: 'Falta codigo_qr o nombre' }); continue; }
    const tipo = (f.tipo || 'equipo').toLowerCase();
    if (!['equipo','recinto'].includes(tipo)) { errores.push({ fila: f.n, error: `Tipo inválido: ${f.tipo}` }); continue; }
    const catId = cats[(f.categoria || '').toLowerCase()];
    if (!catId) { errores.push({ fila: f.n, error: `Categoría no existe: ${f.categoria}` }); continue; }
    try {
      await db.query(
        `INSERT INTO equipo (codigo_qr,nombre,modelo,marca,n_serie,tipo,categoria_id,requiere_autorizacion,entidad_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [f.codigo_qr, f.nombre, f.modelo || null, f.marca || null, f.n_serie || null, tipo, catId, tipo === 'recinto', ENTIDAD_ID]);
      insertados++;
    } catch (e) {
      errores.push({ fila: f.n, error: e.code === '23505' ? `QR duplicado: ${f.codigo_qr}` : e.message });
    }
  }
  res.json({ total: filas.length, insertados, errores });
}));

// Importar nómina (RF-44) — validación por fila
app.post('/api/admin/import/nomina', auth, requireRole('admin'), upload.single('archivo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo .xlsx (campo "archivo")' });
  const { filas } = await leerFilas(req.file.buffer, ['rut','nombre','email','rol']);
  const rolesOK = ['alumno','docente','panolero','admin'];
  const pwd = hashPassword('prestalo'); // clave inicial; el usuario la cambia luego
  let insertados = 0, actualizados = 0; const errores = [];
  for (const f of filas) {
    if (!f.rut || !f.nombre) { errores.push({ fila: f.n, error: 'Falta rut o nombre' }); continue; }
    const rol = (f.rol || 'alumno').toLowerCase();
    if (!rolesOK.includes(rol)) { errores.push({ fila: f.n, error: `Rol inválido: ${f.rol}` }); continue; }
    try {
      const up = await db.query(
        `INSERT INTO usuario (rut,nombre,email,rol,password_hash,entidad_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (rut) DO UPDATE SET nombre=EXCLUDED.nombre, email=EXCLUDED.email, rol=EXCLUDED.rol
         RETURNING (xmax=0) AS insertado`,
        [f.rut, f.nombre, f.email || null, rol, pwd, ENTIDAD_ID]);
      up.rows[0].insertado ? insertados++ : actualizados++;
    } catch (e) {
      errores.push({ fila: f.n, error: e.code === '23505' ? `Correo duplicado: ${f.email}` : e.message });
    }
  }
  res.json({ total: filas.length, insertados, actualizados, errores });
}));

// Exporta la app Express y utilidades (usado por server.js local y por Netlify Functions)
// ----------------------- Asistente IA (acotado a la app + normativa del pañol) -----------------------
app.post('/api/asistente', wrap(async (req, res) => {
  const { pregunta, historial } = req.body || {};
  if (!pregunta || !String(pregunta).trim())
    return res.status(400).json({ error: 'Falta la pregunta' });
  const r = await asistente.responder(String(pregunta), historial);
  if (!r.ok) return res.status(502).json({ error: r.error, detalle: r.detalle });
  res.json({ respuesta: r.respuesta });
}));

module.exports = { app, expirarNoShow };
