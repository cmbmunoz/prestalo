// ===================== Préstalo — Frontend SPA =====================
let TOKEN = localStorage.getItem('prestalo_token') || null;
let ME = null;                 // {user, asignaturas}
let SEDE = null;               // sede activa (id) — admin puede cambiarla
let PANEL_SEDE = '';           // selección del panel ('' = todas las sedes)
const $ = (s, el = document) => el.querySelector(s);

const ICON_CAT = { 'Cámaras':'📷','Audio':'🎙️','Iluminación':'💡','Trípodes':'🎥','Accesorios':'🎒','Recintos':'🏢' };
const icon = (c) => ICON_CAT[c] || '📦';
const ESTADO_EQ = {
  disponible:['Disponible','ok'], reservado:['Reservado','warn'], prestado:['En préstamo','warn'],
  mantencion:['Mantención','bad'], baja:['De baja','bad']
};
const ESTADO_RES = {
  pendiente:['Pendiente','warn'], confirmada:['Confirmada','ok'], en_uso:['En uso','warn'],
  completada:['Completada','info'], cancelada:['Cancelada','bad'], expirada:['Expirada','bad']
};

// ---------- API helper ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(SEDE ? { 'X-Sede-Id': String(SEDE) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function fmtDate(s) {
  const d = new Date(s);
  return d.toLocaleString('es-CL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ---------- Login (por RUT o correo) ----------
let MODO = 'rut';
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => {
  MODO = b.dataset.modo;
  document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('active', x === b));
  $('#idLabel').textContent = MODO === 'rut' ? 'RUT' : 'Correo';
  $('#ident').placeholder = MODO === 'rut' ? '11.111.111-1' : 'correo@ust.cl';
  $('#ident').value = '';
});

async function doLogin(credencial, password, modo) {
  $('#loginErr').textContent = '';
  const body = { password };
  if ((modo || MODO) === 'correo') body.email = credencial; else body.rut = credencial;
  try {
    const { token } = await api('/login', { method:'POST', body });
    TOKEN = token; localStorage.setItem('prestalo_token', token);
    await boot();
  } catch (e) { $('#loginErr').textContent = e.message; }
}
$('#btnLogin').onclick = () => doLogin($('#ident').value.trim(), $('#password').value);
$('#password').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#ident').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
document.querySelectorAll('.demo-grid button').forEach(b =>
  b.onclick = () => { MODO='rut'; $('#ident').value = b.dataset.rut; $('#password').value = 'prestalo'; doLogin(b.dataset.rut, 'prestalo', 'rut'); });

// Recuperar contraseña
$('#linkRecuperar').onclick = (e) => {
  e.preventDefault();
  openModal(`<h3>Recuperar contraseña</h3>
    <p class="muted" style="margin-top:0;font-size:13px">Ingresa tu RUT y el correo registrado. Si coinciden, te enviaremos un enlace de recuperación.</p>
    <div class="field"><label>RUT</label><input id="recRut" placeholder="11.111.111-1"></div>
    <div class="field"><label>Correo</label><input id="recMail" placeholder="correo@ust.cl"></div>
    <div class="err" id="recErr"></div>
    <div id="recOk" class="aviso ok" style="display:none"></div>
    <button class="btn full" id="recBtn">Enviar enlace</button>`);
  $('#recBtn').onclick = async () => {
    $('#recErr').textContent = '';
    const rut = $('#recRut').value.trim(), email = $('#recMail').value.trim();
    if (!rut || !email) { $('#recErr').textContent = 'Completa RUT y correo'; return; }
    try {
      const r = await api('/recuperar', { method:'POST', body:{ rut, email } });
      $('#recOk').style.display = 'block'; $('#recOk').textContent = r.mensaje || 'Solicitud enviada.';
      $('#recBtn').disabled = true;
    } catch (e) { $('#recErr').textContent = e.message; }
  };
};

$('#btnLogout').onclick = () => { TOKEN = null; localStorage.removeItem('prestalo_token'); location.reload(); };

// ---------- Menú por perfil ----------
const MENUS = {
  alumno:   [['catalogo','📚','Reserva y Catálogo'],['asignaturas','🎓','Mis asignaturas'],['reservas','📅','Mis reservas'],['disponibilidad','🗓️','Disponibilidad'],['solicitudes','🙋','Solicitudes especiales'],['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  // Nota: "Compañeros" del alumno ahora vive dentro de cada asignatura (ver Mis asignaturas).
  docente:  [['tareas','📝','Tareas'],['solicitudes','🙋','Solicitudes especiales'],['grupos','👪','Grupos'],['catalogo','📚','Catálogo'],['asignaturas','🎓','Mis asignaturas'],['reservas','📅','Mis reservas'],['disponibilidad','🗓️','Disponibilidad'],['companeros','🧑‍🤝‍🧑','Compañeros'],['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  panolero: [['agenda','📋','Agenda / Entregas'],['recibir','📥','Recibir'],['pedidos','🧾','Pedidos'],['disponibilidad','🗓️','Disponibilidad'],['bloqueos','🚫','Bloqueos'],['anuncios','📢','Anuncios'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
  admin:    [[null,null,'Operación'],
             ['kpis','📊','Panel'],['reportes','📈','Reportes'],['inventario','🧰','Inventario'],['pedidos','🧾','Pedidos'],['disponibilidad','🗓️','Disponibilidad'],['bloqueos','🚫','Bloqueos'],['mantenciones','🔧','Mantenciones'],
             [null,null,'Gestión académica'],
             ['importar','📥','Importar Excel'],['autoriz','✅','Autorizaciones'],['grupos','👪','Grupos'],['sanciones','⛔','Sanciones'],['usuarios','👥','Usuarios'],['academico','🎓','Académico'],['catalogos','🗂️','Catálogos'],
             [null,null,'Sistema'],
             ['anuncios','📢','Anuncios'],['sedes','🏫','Sedes'],['respaldos','💾','Respaldos'],['manuales','❓','Ayuda'],['perfil','👤','Mi perfil']],
};
function firstView(rol) { const m = MENUS[rol].find(x => x[0] !== null); return m ? m[0] : null; }
function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  let firstDone = false;
  MENUS[ME.user.rol].forEach(([k, ic, label]) => {
    if (k === null) { const g = document.createElement('div'); g.className = 'nav-group'; g.textContent = label; nav.appendChild(g); return; }
    const b = document.createElement('button');
    b.dataset.key = k;
    b.innerHTML = `<span class="ic">${ic}</span><span class="lb">${label}</span>`;
    b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); render(k); };
    if (!firstDone) { b.classList.add('active'); firstDone = true; }
    nav.appendChild(b);
  });
}

// Globo con el número de anuncios sin leer (por usuario, en este dispositivo)
async function updateAnunciosBadge() {
  const btn = document.querySelector('#nav button[data-key="anuncios"]');
  if (!btn) return;
  let rows = [];
  try { rows = await api('/anuncios'); } catch (e) { return; }
  let seen = 0;
  try { seen = Number(localStorage.getItem('prestalo_anuncios_seen_' + ME.user.rut) || 0); } catch (e) {}
  const nuevos = rows.filter(a => Number(a.id) > seen).length;
  let badge = btn.querySelector('.nav-badge');
  if (nuevos > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; btn.appendChild(badge); }
    badge.textContent = '☁ ' + (nuevos > 9 ? '9+' : nuevos);
    badge.title = nuevos + ' anuncio(s) sin leer';
  } else if (badge) { badge.remove(); }
}
function marcarAnunciosLeidos(rows) {
  try {
    const maxId = rows && rows.length ? Math.max(...rows.map(a => Number(a.id))) : 0;
    localStorage.setItem('prestalo_anuncios_seen_' + ME.user.rut, String(maxId));
  } catch (e) {}
}

// ---------- Boot ----------
async function boot() {
  ME = await api('/me');
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoName').textContent = ME.user.nombre;
  $('#whoRole').textContent = ({alumno:'Alumno',docente:'Docente',panolero:'Pañolero',admin:'Administrador'})[ME.user.rol];
  await buildSedeSelector();
  buildNav();
  render(firstView(ME.user.rol));
  updateAnunciosBadge();
}

// Multisede: selector de sede en la barra superior (solo admin con >1 sede)
async function buildSedeSelector() {
  const host = $('#sedeHost'); if (host) host.innerHTML = '';
  try {
    const s = await api('/sedes');
    SEDE = (s.sede_activa || (s.actual && s.actual.id)) || null;
    if (ME.user.rol === 'admin' && host && s.sedes && s.sedes.length > 1) {
      host.innerHTML = `<select id="sedeSel" title="Sede activa">${s.sedes.map(x => `<option value="${x.id}" ${x.id === SEDE ? 'selected' : ''}>${escD(x.nombre)}</option>`).join('')}</select>`;
      $('#sedeSel').onchange = (e) => { SEDE = Number(e.target.value); PANEL_SEDE = String(SEDE); buildNav(); render(firstView(ME.user.rol)); toast('Sede cambiada'); };
    }
  } catch (e) { /* sede opcional */ }
}

// ===================== Vistas =====================
const view = () => $('#view');
function h(html) { view().innerHTML = html; }

async function render(key) {
  try {
    if (key === 'catalogo')   return viewCatalogo();
    if (key === 'reservas')   return viewReservas();
    if (key === 'agenda')     return viewAgenda();
    if (key === 'recibir')    return viewRecibir();
    if (key === 'kpis')       return viewKpis();
    if (key === 'inventario') return viewInventario();
    if (key === 'mantenciones') return viewMantenciones();
    if (key === 'importar')   return viewImportar();
    if (key === 'autoriz')    return viewAutoriz();
    if (key === 'sanciones')  return viewSanciones();
    if (key === 'usuarios')   return viewUsuarios();
    if (key === 'academico')  return viewAcademico();
    if (key === 'perfil')     return viewPerfil();
    if (key === 'tareas')     return viewTareas();
    if (key === 'solicitudes') return viewSolicitudes();
    if (key === 'disponibilidad') return viewDisponibilidad();
    if (key === 'pedidos')    return viewPedidos();
    if (key === 'catalogos')  return viewCatalogos();
    if (key === 'bloqueos')   return viewBloqueos();
    if (key === 'grupos')     return viewGrupos();
    if (key === 'reportes')   return viewReportes();
    if (key === 'anuncios')   return viewAnuncios();
    if (key === 'companeros') return viewCompaneros();
    if (key === 'asignaturas') return viewAsignaturas();
    if (key === 'sedes')      return viewSedes();
    if (key === 'respaldos')  return viewRespaldos();
    if (key === 'manuales')   return viewManuales();
  } catch (e) { h(`<h2 class="page">Error</h2><div class="aviso bad">${e.message}</div>`); }
}

// ----- Catálogo (alumno/docente) -----
async function viewCatalogo() {
  h(`<h2 class="page">Catálogo de equipos</h2><p class="muted">Solo se muestran los equipos habilitados para tus asignaturas.</p><div class="grid" id="cat"></div>`);
  const eq = await api('/equipos');
  if (!eq.length) { $('#cat').innerHTML = '<p class="muted">No hay equipos habilitados para tu asignatura.</p>'; return; }
  $('#cat').innerHTML = eq.map(e => {
    const [lab, cls] = ESTADO_EQ[e.estado] || [e.estado,'info'];
    const rec = e.tipo === 'recinto' ? '<span class="pill warn">Requiere autorización</span>' : '';
    return `<div class="card">
      <div class="thumb">${icon(e.categoria)}</div>
      <h3>${e.nombre}</h3><div class="cat">${e.categoria}${e.marca ? ' · ' + e.marca : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="pill ${cls}">${lab}</span>${rec}</div>
      <div style="display:flex;gap:6px">
        <button class="btn sm" style="flex:1" ${e.estado !== 'disponible' ? 'disabled style="opacity:.5;flex:1"' : ''} data-id="${e.id}">Reservar</button>
        <button class="btn sm ghost" data-ficha="${e.id}">Ficha</button>
      </div>
    </div>`;
  }).join('');
  $('#cat').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => modalReserva(b.dataset.id));
  $('#cat').querySelectorAll('button[data-ficha]').forEach(b => b.onclick = () => fichaEquipo(b.dataset.ficha));
}

async function modalReserva(id) {
  const e = await api('/equipos/' + id);
  const esRecinto = e.tipo === 'recinto' || e.requiere_autorizacion;
  const asigs = ME.asignaturas;
  const now = new Date();
  const defIni = new Date(now.getTime() + (esRecinto ? 73 : 5) * 3600000);
  const toLocal = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  openModal(`
    <h3>Reservar: ${e.nombre}</h3>
    <p class="muted" style="margin-top:0">${e.categoria} · ${e.codigo_qr}</p>
    ${esRecinto ? `<div class="aviso warn">Recinto: requiere 72 h de anticipación y autorización de Jefatura de Carrera y Dirección Académica (DAO).</div>` : ''}
    ${asigs.length ? `<div class="field"><label>Asignatura</label><select id="rAsig">${asigs.map(a=>`<option value="${a.id}">${a.nombre}${a.seccion?' · '+a.seccion:''}</option>`).join('')}</select></div>` : '<div class="aviso bad">No tienes asignaturas inscritas.</div>'}
    <div class="field"><label>Inicio</label><input type="datetime-local" id="rIni" value="${toLocal(defIni)}"></div>
    <div class="field"><label>Término</label><input type="datetime-local" id="rFin" value="${toLocal(new Date(defIni.getTime()+3*3600000))}"></div>
    <label style="font-size:12px;font-weight:600;color:var(--muted)">Integrantes del grupo (opcional — RF-52)</label>
    <div id="integrantes"></div>
    <button class="btn sm ghost" id="addInt" style="margin:4px 0 8px">+ Agregar integrante</button>
    <div class="toggle"><input type="checkbox" id="rUso"><label for="rUso" style="margin:0">Declaro que el uso es exclusivamente académico (obligatorio)</label></div>
    <div class="err" id="rErr"></div>
    <button class="btn full" id="rSubmit">Confirmar reserva</button>
  `);
  const cont = $('#integrantes');
  $('#addInt').onclick = () => {
    const d = document.createElement('div'); d.className = 'integrantes-row';
    d.innerHTML = `<input placeholder="Nombre" class="i-nom"><input placeholder="RUT" class="i-rut"><button class="btn sm danger">×</button>`;
    d.querySelector('button').onclick = () => d.remove();
    cont.appendChild(d);
  };
  $('#rSubmit').onclick = async () => {
    $('#rErr').textContent = '';
    const integrantes = [...cont.querySelectorAll('.integrantes-row')].map(r => ({
      nombre: r.querySelector('.i-nom').value.trim(), rut: r.querySelector('.i-rut').value.trim()
    })).filter(x => x.nombre && x.rut);
    try {
      const r = await api('/reservas', { method:'POST', body:{
        equipo_id: Number(id),
        asignatura_id: $('#rAsig') ? Number($('#rAsig').value) : null,
        fecha_inicio: new Date($('#rIni').value).toISOString(),
        fecha_fin: new Date($('#rFin').value).toISOString(),
        uso_academico: $('#rUso').checked,
        integrantes,
      }});
      closeModal(); toast(r.mensaje || 'Reserva creada'); viewCatalogo();
    } catch (e) { $('#rErr').textContent = e.message; }
  };
}

// ----- Mis reservas -----
async function viewReservas() {
  h(`<h2 class="page">Mis reservas</h2><div id="list"></div>`);
  const rs = await api('/mis-reservas');
  if (!rs.length) { $('#list').innerHTML = '<p class="muted">Sin reservas.</p>'; return; }
  $('#list').innerHTML = rs.map(r => {
    const [lab, cls] = ESTADO_RES[r.estado] || [r.estado,'info'];
    const cancel = ['pendiente','confirmada'].includes(r.estado)
      ? `<button class="btn sm ghost" data-c="${r.id}">Cancelar</button>` : '';
    return `<div class="row"><div class="ava">${icon(r.categoria)}</div>
      <div class="info"><b>${r.equipo}</b><small>${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)} · ${r.integrantes} integrante(s)${r.es_grupal?' · grupal':''}</small></div>
      <span class="pill ${cls}">${lab}</span>${cancel}</div>`;
  }).join('');
  $('#list').querySelectorAll('button[data-c]').forEach(b => b.onclick = async () => {
    await api(`/reservas/${b.dataset.c}/cancelar`, { method:'POST', body:{} }); toast('Reserva cancelada'); viewReservas();
  });
}

// ----- Pañolero: Agenda / Entregar -----
async function viewAgenda() {
  h(`<h2 class="page">Agenda de entregas</h2><div id="list"></div>`);
  const ag = await api('/agenda');
  if (!ag.length) { $('#list').innerHTML = '<p class="muted">Sin entregas pendientes.</p>'; return; }
  $('#list').innerHTML = ag.map(a => `<div class="row"><div class="ava">${icon(a.categoria)}</div>
    <div class="info"><b>${a.equipo}</b><small>${fmtDate(a.fecha_inicio)} · ${a.usuario} · ${a.codigo_qr}</small></div>
    <button class="btn sm" data-e="${a.id}" data-qr="${a.codigo_qr}">Entregar</button></div>`).join('');
  $('#list').querySelectorAll('button[data-e]').forEach(b => b.onclick = () => modalEntregar(b.dataset.e, b.dataset.qr));
}
function modalEntregar(reservaId, qr) {
  openModal(`<h3>Entregar equipo</h3>
    <p class="muted" style="margin-top:0">Verifica el QR del equipo (opcional).</p>
    <div class="field"><label>QR escaneado</label><input id="eQr" placeholder="${qr}"></div>
    <div class="err" id="eErr"></div>
    <button class="btn full" id="eOk">Confirmar entrega</button>`);
  $('#eOk').onclick = async () => {
    try {
      await api('/entregar', { method:'POST', body:{ reserva_id:Number(reservaId), qr:$('#eQr').value.trim()||null } });
      closeModal(); toast('Entrega registrada'); viewAgenda();
    } catch (e) { $('#eErr').textContent = e.message; }
  };
}

// ----- Pañolero: Recibir (naranja) -----
async function viewRecibir() {
  h(`<h2 class="page" style="color:var(--recibir)">Recibir devoluciones</h2><div id="list"></div>`);
  const pr = await api('/por-recibir');
  if (!pr.length) { $('#list').innerHTML = '<p class="muted">No hay equipos por recibir.</p>'; return; }
  $('#list').innerHTML = pr.map(p => `<div class="row"><div class="ava">${icon(p.categoria)}</div>
    <div class="info"><b>${p.equipo}</b><small>${p.usuario} · ${p.codigo_qr} · entregado ${fmtDate(p.fecha_salida)}</small></div>
    <button class="btn sm orange" data-p="${p.prestamo_id}">Recibir</button></div>`).join('');
  $('#list').querySelectorAll('button[data-p]').forEach(b => b.onclick = () => modalRecibir(b.dataset.p));
}
function modalRecibir(prestamoId) {
  openModal(`<h3 style="color:var(--recibir)">Recibir equipo</h3>
    <div class="field"><label>Condición a la devolución</label>
      <select id="cCond">
        <option value="optimo">Óptimo</option><option value="bueno" selected>Buen estado</option>
        <option value="con_danio">Con daño</option><option value="inoperativo">Inoperativo</option>
      </select></div>
    <div class="field"><label>Observación</label><input id="cObs" placeholder="Opcional"></div>
    <div class="aviso warn">Si el equipo presenta daño, se bloqueará por reposición y se aplicará sanción automática (RF-59).</div>
    <button class="btn full orange" id="cOk">Confirmar devolución</button>`);
  $('#cOk').onclick = async () => {
    const r = await api('/recibir', { method:'POST', body:{ prestamo_id:Number(prestamoId),
      condicion_retorno:$('#cCond').value, observacion:$('#cObs').value.trim()||null }});
    closeModal();
    toast(r.requiere_reposicion ? 'Devolución con daño: bloqueo por reposición aplicado' : 'Devolución registrada');
    viewRecibir();
  };
}

// ----- Admin: Panel estratégico -----
function escD(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function topChart(top){
  const rows = (top||[]).filter(t => t.total > 0);
  if (!rows.length) return '<p class="muted">Aún no hay reservas registradas.</p>';
  const max = Math.max(...rows.map(t => t.total), 1);
  return rows.map(t => `<div class="bar-row"><span class="nm" title="${escD(t.nombre)}">${escD(t.nombre)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${Math.round(t.total/max*100)}%"></span></span>
    <span class="vl">${t.total}</span></div>`).join('');
}

function invChart(inv){
  const COL = {disponible:'#1C7A46', prestado:'#0E8F86', reservado:'#B07209', mantencion:'#E8590C', baja:'#9AA7B4'};
  const LAB = {disponible:'Disponible', prestado:'Prestado', reservado:'Reservado', mantencion:'Mantención', baja:'De baja'};
  const total = (inv||[]).reduce((a,s) => a + s.n, 0);
  if (!total) return '<p class="muted">Sin equipos registrados aún.</p>';
  let acc = 0, segs = '';
  inv.forEach(s => { if (!s.n) return; const pct = s.n/total*100;
    segs += `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${COL[s.estado]||'#9AA7B4'}" stroke-width="5.5" stroke-dasharray="${pct.toFixed(2)} ${(100-pct).toFixed(2)}" stroke-dashoffset="${(25-acc).toFixed(2)}"/>`;
    acc += pct;
  });
  const legend = inv.filter(s => s.n).map(s => `<span><i style="background:${COL[s.estado]||'#9AA7B4'}"></i>${LAB[s.estado]||s.estado} · <b>${s.n}</b></span>`).join('');
  return `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
    <svg viewBox="0 0 42 42" style="width:118px;height:118px">
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF2F7" stroke-width="5.5"/>${segs}
      <text x="21" y="20.5" text-anchor="middle" font-size="7" font-weight="700" fill="#152230">${total}</text>
      <text x="21" y="26" text-anchor="middle" font-size="3.4" fill="#6B7785">equipos</text>
    </svg>
    <div class="legend" style="flex-direction:column;gap:7px">${legend}</div>
  </div>`;
}

function trendChart(tend){
  tend = tend || [];
  if (!tend.length) return '<p class="muted">Sin préstamos en el período.</p>';
  const W = 320, H = 130, n = tend.length;
  const max = Math.max(...tend.map(t => t.n), 1);
  const bw = Math.max(10, Math.min(34, (W-20)/n - 8));
  const gap = (W-20 - bw*n)/(n+1);
  let bars = '';
  tend.forEach((t,i) => { const bh = Math.round((t.n/max)*90); const x = 10 + gap*(i+1) + bw*i; const y = 100 - bh;
    bars += `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${bh}" rx="3" fill="url(#tg)"/>
      <text x="${(x+bw/2).toFixed(1)}" y="${y-3}" text-anchor="middle" font-size="8" font-weight="700" fill="#152230">${t.n}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="118" text-anchor="middle" font-size="7.5" fill="#6B7785">${escD(t.semana)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16b8a8"/><stop offset="1" stop-color="#0E8F86"/></linearGradient></defs>
    <line x1="10" y1="100" x2="${W-10}" y2="100" stroke="#E4E8ED"/>${bars}
  </svg>`;
}

function devList(dev){
  dev = dev || [];
  if (!dev.length) return '<p class="muted">Sin préstamos abiertos.</p>';
  return dev.map(x => {
    const f = x.fecha_salida ? new Date(x.fecha_salida) : null;
    const fecha = f ? f.toLocaleDateString('es-CL',{day:'2-digit',month:'short'}) : '—';
    return `<div class="row"><div class="ava">📦</div><div class="info"><b>${escD(x.equipo)}</b><small>${escD(x.usuario)}</small></div><span class="pill info">salió ${fecha}</span></div>`;
  }).join('');
}

async function viewKpis() {
  h(`<h2 class="page">Panel de control</h2>
     <p class="muted" style="margin:-8px 0 14px;font-size:13px">Visión general de todas las sedes. Selecciona una sede para profundizar en su detalle.</p>
     <div id="sedeSw" class="segbar"></div>
     <div id="dash" class="muted">Cargando…</div>`);
  let g;
  try { g = await api('/admin/dashboard/global'); }
  catch (e) { $('#sedeSw').innerHTML=''; return renderSedeDetalle(null); } // sin multisede → detalle de la sede activa
  const sedes = g.por_sede || [];
  const chips = [['', '🏛️ Todas las sedes'], ...sedes.map(s => [String(s.id), '🏫 ' + s.nombre])];
  const sw = $('#sedeSw');
  const initV = (PANEL_SEDE && sedes.some(s => String(s.id) === PANEL_SEDE)) ? PANEL_SEDE : '';
  sw.innerHTML = chips.map(([v, l]) => `<button class="seg-chip${v===initV?' active':''}" data-s="${v}">${escD(l)}</button>`).join('');
  const activar = (v) => {
    PANEL_SEDE = v;
    sw.querySelectorAll('.seg-chip').forEach(b => b.classList.toggle('active', b.dataset.s === v));
    const sel = $('#sedeSel');                 // sincronizar con el selector del encabezado
    if (v) {
      SEDE = Number(v);
      if (sel) sel.value = v;
      renderSedeDetalle(Number(v));
    } else {
      renderGlobal(g);                         // "Todas las sedes": panel agregado (el encabezado mantiene su sede)
    }
  };
  sw.querySelectorAll('.seg-chip').forEach(b => b.onclick = () => activar(b.dataset.s));
  if (initV) renderSedeDetalle(Number(initV)); else renderGlobal(g);
}

function renderGlobal(g) {
  const gl = g.global || {}, sedes = g.por_sede || [], inv = g.inventario || [], top = g.top_solicitados || [];
  const totalEq = gl.total_equipos || 0;
  const dispPct = totalEq ? Math.round((gl.equipos_disponibles / totalEq) * 100) : 0;
  const cards = [
    ['Sedes', gl.sedes || 0, 'en operación', 'brand'],
    ['Préstamos activos', gl.prestamos_activos || 0, gl.atrasados ? `${gl.atrasados} atrasados` : 'al día', gl.atrasados ? 'bad' : 'ok'],
    ['Reservas vigentes', gl.reservas_vigentes || 0, 'en curso', 'brand'],
    ['Solicitudes pend.', gl.solicitudes_pendientes || 0, gl.solicitudes_pendientes ? 'por aprobar' : 'al día', gl.solicitudes_pendientes ? 'warn' : 'ok'],
    ['Disponibilidad', dispPct + '%', `${gl.equipos_disponibles || 0} de ${totalEq} eq.`, dispPct >= 50 ? 'ok' : 'warn'],
    ['En mantención', gl.en_mantencion || 0, gl.en_mantencion ? 'fuera de servicio' : 'ninguno', gl.en_mantencion ? 'warn' : 'ok'],
  ];
  const kpisHtml = cards.map(([l, n, ctx, tone]) => `<div class="kpi ${tone}"><div class="n">${n}</div><div class="l">${l}</div><div class="ctx ${tone}">${ctx}</div></div>`).join('');
  const rows = sedes.map(s => {
    const dp = s.total_equipos ? Math.round((s.equipos_disponibles / s.total_equipos) * 100) : 0;
    return `<tr>
      <td><b>${escD(s.nombre)}</b></td>
      <td>${s.total_equipos}</td>
      <td>${s.equipos_disponibles} <span class="muted">(${dp}%)</span></td>
      <td>${s.prestamos_activos}${s.atrasados ? ` <span class="pill bad">${s.atrasados} atr.</span>` : ''}</td>
      <td>${s.reservas_vigentes}</td>
      <td>${s.solicitudes_pendientes ? `<span class="pill warn">${s.solicitudes_pendientes}</span>` : '0'}</td>
      <td>${s.en_mantencion || 0}</td>
      <td><button class="btn sm ghost" data-ver="${s.id}">Ver detalle →</button></td>
    </tr>`;
  }).join('');
  $('#dash').innerHTML = `
    <div class="kpis">${kpisHtml}</div>
    <div class="panel" style="margin-bottom:14px"><h3>Comparativa por sede</h3>
      <div style="overflow-x:auto"><table><thead><tr>
        <th>Sede</th><th>Equipos</th><th>Disponibles</th><th>Préstamos act.</th><th>Reservas</th><th>Solic.</th><th>Mant.</th><th></th>
      </tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">Sin sedes.</td></tr>'}</tbody></table></div>
    </div>
    <div class="dash-grid">
      <div class="panel"><h3>Equipos más solicitados <span class="sub">· todas las sedes</span></h3>${topChart(top)}</div>
      <div class="panel"><h3>Estado del inventario <span class="sub">· todas las sedes</span></h3>${invChart(inv)}</div>
    </div>`;
  $('#dash').querySelectorAll('button[data-ver]').forEach(b => b.onclick = () => {
    const chip = document.querySelector('#sedeSw .seg-chip[data-s="' + b.dataset.ver + '"]');
    if (chip) chip.click();                    // delega en el chip → sincroniza panel + encabezado
    else renderSedeDetalle(Number(b.dataset.ver));
  });
}

async function renderSedeDetalle(sedeId) {
  $('#dash').innerHTML = '<p class="muted">Cargando detalle…</p>';
  let d;
  try { d = await api('/admin/dashboard' + (sedeId ? '?sede=' + sedeId : '')); }
  catch (e) { $('#dash').innerHTML = '<div class="aviso bad">No se pudo cargar el detalle de la sede.</div>'; return; }
  const k = d.kpis || {}, inv = d.inventario || [], top = d.top_solicitados || [], dev = d.devoluciones_proximas || [], tend = d.tendencia || [];
  const totalEq = k.total_equipos || 0;
  const dispPct = totalEq ? Math.round((k.equipos_disponibles/totalEq)*100) : 0;

  const alerts = [];
  if (k.atrasados > 0) alerts.push(['bad','⚠',`${k.atrasados} préstamo(s) atrasado(s) requieren seguimiento`]);
  if (k.reposiciones > 0) alerts.push(['warn','🔁',`${k.reposiciones} equipo(s) bloqueado(s) por reposición`]);
  if (k.solicitudes_pendientes > 0) alerts.push(['warn','📝',`${k.solicitudes_pendientes} solicitud(es) especial(es) por aprobar`]);
  if (!alerts.length) alerts.push(['ok','✓','Todo al día: sin atrasos ni bloqueos pendientes']);
  const alertsHtml = alerts.map(([t,ic,msg]) => `<div class="alert ${t}"><span>${ic}</span>${msg}</div>`).join('');

  const cards = [
    ['Préstamos activos', k.prestamos_activos||0, k.atrasados ? `${k.atrasados} atrasados` : 'al día', k.atrasados?'bad':'ok','📦'],
    ['Reservas vigentes', k.reservas_vigentes||0, 'en curso','brand','📅'],
    ['Solicitudes pend.', k.solicitudes_pendientes||0, k.solicitudes_pendientes?'por aprobar':'al día', k.solicitudes_pendientes?'warn':'ok','📝'],
    ['Disponibilidad', dispPct+'%', `${k.equipos_disponibles||0} de ${totalEq} eq.`, dispPct>=50?'ok':'warn','✅'],
    ['En mantención', k.en_mantencion||0, k.en_mantencion?'fuera de servicio':'ninguno', k.en_mantencion?'warn':'ok','🔧'],
    ['Sanciones vigentes', k.sanciones_vigentes||0, k.sanciones_vigentes?'alumnos restringidos':'ninguna', k.sanciones_vigentes?'warn':'ok','⛔'],
  ];
  const kpisHtml = cards.map(([l,n,ctx,tone,ic]) => `<div class="kpi ${tone}"><span class="ic">${ic}</span><div class="n">${n}</div><div class="l">${l}</div><div class="ctx ${tone}">${ctx}</div></div>`).join('');

  $('#dash').innerHTML = `
    <div class="alerts">${alertsHtml}</div>
    <div class="kpis">${kpisHtml}</div>
    <div class="dash-grid">
      <div class="panel"><h3>Equipos más solicitados <span class="sub">por reservas</span></h3>${topChart(top)}</div>
      <div class="panel"><h3>Estado del inventario</h3>${invChart(inv)}</div>
    </div>
    <div class="dash-grid" style="margin-top:14px">
      <div class="panel"><h3>Tendencia de préstamos <span class="sub">últimas 8 semanas</span></h3>${trendChart(tend)}</div>
      <div class="panel"><h3>Próximas devoluciones y atrasos</h3><div class="dev-list">${devList(dev)}</div></div>
    </div>`;
}

// ----- Admin: Inventario -----
async function viewInventario() {
  h(`<h2 class="page">Inventario</h2>
     <button class="btn sm" id="addEq" style="margin-bottom:12px">+ Nuevo equipo</button>
     <div id="tbl"></div>`);
  const eq = await api('/equipos');
  $('#tbl').innerHTML = `<table><thead><tr><th>Equipo</th><th>Categoría</th><th>Tipo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${
    eq.map(e => {
      const [lab,cls] = ESTADO_EQ[e.estado]||[e.estado,'info'];
      return `<tr><td><b>${e.nombre}</b><br><small class="muted">${e.codigo_qr}</small></td><td>${e.categoria}</td>
        <td>${e.tipo==='recinto'?'Recinto':'Equipo'}</td><td><span class="pill ${cls}">${lab}</span></td>
        <td><select data-id="${e.id}" class="estSel">
          <option ${e.estado==='disponible'?'selected':''} value="disponible">Disponible</option>
          <option ${e.estado==='mantencion'?'selected':''} value="mantencion">Mantención</option>
          <option ${e.estado==='baja'?'selected':''} value="baja">De baja</option>
        </select></td></tr>`;
    }).join('')}</tbody></table>`;
  $('#tbl').querySelectorAll('.estSel').forEach(s => s.onchange = async () => {
    try { await api(`/admin/equipos/${s.dataset.id}/estado`, { method:'POST', body:{ estado:s.value }}); toast('Estado actualizado'); }
    catch(e){ toast(e.message); }
  });
  $('#addEq').onclick = modalNuevoEquipo;
}
async function modalNuevoEquipo() {
  openModal(`<h3>Nuevo equipo</h3>
    <div class="field"><label>Código QR</label><input id="nQr" placeholder="QR-CAM-010"></div>
    <div class="field"><label>Nombre</label><input id="nNom"></div>
    <div class="field"><label>Marca / modelo</label><input id="nMar"></div>
    <div class="field"><label>N° de serie</label><input id="nSerie" placeholder="SN-..."></div>
    <div class="field"><label>Categoría (id)</label><input id="nCat" type="number" placeholder="1=Cámaras … 6=Recintos"></div>
    <div class="field"><label>Tipo</label><select id="nTipo"><option value="equipo">Equipo</option><option value="recinto">Recinto</option></select></div>
    <div class="err" id="nErr"></div>
    <button class="btn full" id="nOk">Crear</button>`);
  $('#nOk').onclick = async () => {
    try {
      await api('/admin/equipos', { method:'POST', body:{
        codigo_qr:$('#nQr').value.trim(), nombre:$('#nNom').value.trim(), marca:$('#nMar').value.trim(),
        n_serie:$('#nSerie').value.trim(), categoria_id:Number($('#nCat').value), tipo:$('#nTipo').value }});
      closeModal(); toast('Equipo creado'); viewInventario();
    } catch (e) { $('#nErr').textContent = e.message; }
  };
}

// ----- Admin: Mantenciones -----
async function viewMantenciones() {
  h(`<h2 class="page">Mantenciones</h2>
     <button class="btn sm" id="addM" style="margin-bottom:12px">+ Registrar mantención</button>
     <div id="tbl"></div>`);
  const m = await api('/admin/mantenciones');
  $('#tbl').innerHTML = m.length ? `<table><thead><tr><th>Equipo</th><th>Tipo</th><th>Fecha</th><th>Detalle</th><th>Costo</th></tr></thead><tbody>${
    m.map(x => `<tr><td><b>${x.equipo}</b><br><small class="muted">${x.codigo_qr}</small></td><td>${x.tipo}</td>
      <td>${x.fecha}</td><td>${x.detalle||'—'}</td><td>${x.costo?('$'+Number(x.costo).toLocaleString('es-CL')):'—'}</td></tr>`).join('')
    }</tbody></table>` : '<p class="muted">Sin mantenciones registradas.</p>';
  $('#addM').onclick = modalMantencion;
}
async function modalMantencion() {
  const eq = await api('/equipos');
  openModal(`<h3>Registrar mantención</h3>
    <div class="field"><label>Equipo</label><select id="mEq">${eq.map(e=>`<option value="${e.id}">${e.nombre} · ${e.codigo_qr}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><select id="mTipo">
      <option value="preventiva">Preventiva</option><option value="correctiva">Correctiva</option>
      <option value="calibracion">Calibración</option><option value="reposicion">Reposición</option></select></div>
    <div class="field"><label>Detalle</label><input id="mDet" placeholder="Descripción del trabajo"></div>
    <div class="field"><label>Costo (opcional)</label><input id="mCosto" type="number" placeholder="0"></div>
    <div class="toggle"><input type="checkbox" id="mCerrar"><label for="mCerrar" style="margin:0">Marcar equipo como disponible al cerrar</label></div>
    <div class="err" id="mErr"></div>
    <button class="btn full" id="mOk">Registrar</button>`);
  $('#mOk').onclick = async () => {
    try {
      await api('/admin/mantenciones', { method:'POST', body:{
        equipo_id:Number($('#mEq').value), tipo:$('#mTipo').value, detalle:$('#mDet').value.trim(),
        costo:$('#mCosto').value?Number($('#mCosto').value):null, cerrar:$('#mCerrar').checked }});
      closeModal(); toast('Mantención registrada'); viewMantenciones();
    } catch (e) { $('#mErr').textContent = e.message; }
  };
}

// ----- Admin: Importar Excel (RF-11/44) -----
function viewImportar() {
  h(`<h2 class="page">Importar desde Excel</h2>
     <p class="muted">Carga masiva con validación por fila. Descarga la plantilla, complétala y súbela.</p>
     <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
       ${cardImport('equipos','Inventario de equipos','codigo_qr · nombre · modelo · marca · n_serie · categoria · tipo')}
       ${cardImport('nomina','Nómina de usuarios','rut · nombre · email · rol')}
     </div>
     <div id="impRes" style="margin-top:16px"></div>`);
  view().querySelectorAll('[data-tpl]').forEach(b => b.onclick = async () => {
    const r = await fetch('/api/admin/import/plantilla/'+b.dataset.tpl, { headers:{ Authorization:'Bearer '+TOKEN }});
    const blob = await r.blob(); const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = 'plantilla_'+b.dataset.tpl+'.xlsx'; a.click(); URL.revokeObjectURL(u);
  });
  view().querySelectorAll('[data-imp]').forEach(inp => inp.onchange = async () => {
    const tipo = inp.dataset.imp, file = inp.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('archivo', file);
    $('#impRes').innerHTML = '<p class="muted">Procesando…</p>';
    try {
      const r = await fetch('/api/admin/import/'+tipo, { method:'POST', headers:{ Authorization:'Bearer '+TOKEN }, body:fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error||'Error');
      renderImport(tipo, d);
    } catch (e) { $('#impRes').innerHTML = `<div class="aviso bad">${e.message}</div>`; }
    inp.value = '';
  });
}
function cardImport(tipo, titulo, cols) {
  return `<div class="card"><h3>${titulo}</h3><div class="cat">${cols}</div>
    <button class="btn sm ghost" data-tpl="${tipo}" style="margin:6px 8px 6px 0">Descargar plantilla</button>
    <label class="btn sm" style="display:inline-block">Subir archivo
      <input type="file" accept=".xlsx" data-imp="${tipo}" style="display:none"></label></div>`;
}
function renderImport(tipo, d) {
  const okMsg = tipo === 'nomina'
    ? `${d.insertados} nuevos · ${d.actualizados} actualizados`
    : `${d.insertados} insertados`;
  const errs = (d.errores||[]).length
    ? `<table style="margin-top:10px"><thead><tr><th>Fila</th><th>Error</th></tr></thead><tbody>${
        d.errores.map(e=>`<tr><td>${e.fila}</td><td>${e.error}</td></tr>`).join('')}</tbody></table>`
    : '<div class="aviso ok" style="margin-top:10px">Sin errores.</div>';
  $('#impRes').innerHTML = `<div class="aviso ok">Procesado: ${d.total} filas · ${okMsg} · ${(d.errores||[]).length} con error.</div>${errs}`;
  toast('Importación completada');
}

// ----- Admin: Autorizaciones -----
async function viewAutoriz() {
  h(`<h2 class="page">Autorizaciones de recintos</h2><div id="tbl"></div>`);
  const a = await api('/autorizaciones');
  if (!a.length) { $('#tbl').innerHTML = '<p class="muted">Sin autorizaciones pendientes.</p>'; return; }
  const niveles = { jefatura_carrera:'Jefatura de Carrera', direccion_academica:'Dirección Académica (DAO)' };
  $('#tbl').innerHTML = `<table><thead><tr><th>Recinto</th><th>Solicitante</th><th>Fecha</th><th>Nivel</th><th>Decisión</th></tr></thead><tbody>${
    a.map(x => `<tr><td>${x.recinto}</td><td>${x.solicitante}</td><td>${fmtDate(x.fecha_inicio)}</td>
      <td>${niveles[x.nivel]||x.nivel}</td>
      <td><button class="btn sm" data-ok="${x.id}">Aprobar</button> <button class="btn sm danger" data-no="${x.id}">Rechazar</button></td></tr>`).join('')
    }</tbody></table>`;
  const act = async (id, decision) => { await api(`/autorizaciones/${id}`, { method:'POST', body:{ decision }}); toast('Autorización '+decision); viewAutoriz(); };
  $('#tbl').querySelectorAll('button[data-ok]').forEach(b => b.onclick = () => act(b.dataset.ok,'aprobada'));
  $('#tbl').querySelectorAll('button[data-no]').forEach(b => b.onclick = () => act(b.dataset.no,'rechazada'));
}

// ----- Admin: Sanciones -----
async function viewSanciones() {
  h(`<h2 class="page">Sanciones</h2><div id="tbl"></div>`);
  const s = await api('/admin/sanciones');
  if (!s.length) { $('#tbl').innerHTML = '<p class="muted">Sin sanciones.</p>'; return; }
  $('#tbl').innerHTML = `<table><thead><tr><th>Usuario</th><th>Motivo</th><th>Tramo</th><th>Hasta</th><th>Estado</th><th></th></tr></thead><tbody>${
    s.map(x => `<tr><td>${x.nombre}<br><small class="muted">${x.usuario_rut}</small></td><td>${x.motivo}</td>
      <td>${x.tramo}${x.solidaria?' · solidaria':''}</td><td>${x.fecha_fin}</td>
      <td><span class="pill ${x.vigente?'bad':'info'}">${x.vigente?'Vigente':'Levantada'}</span></td>
      <td>${x.vigente?`<button class="btn sm ghost" data-l="${x.id}">Levantar</button>`:''}</td></tr>`).join('')
    }</tbody></table>`;
  $('#tbl').querySelectorAll('button[data-l]').forEach(b => b.onclick = async () => {
    await api(`/admin/sanciones/${b.dataset.l}/levantar`, { method:'POST', body:{} }); toast('Sanción levantada'); viewSanciones();
  });
}

// ----- Admin: Usuarios (gestión) -----
const ROL_LBL = {alumno:'Alumno',docente:'Docente',panolero:'Pañolero',admin:'Administrador'};
const EST_OPTS = ['activo','inactivo','suspendido'];

async function viewUsuarios() {
  h(`<h2 class="page">Usuarios</h2>
     <button class="btn sm" id="nu" style="margin-bottom:12px">+ Nuevo usuario</button>
     <div id="tbl">Cargando…</div>`);
  $('#nu').onclick = () => usuarioForm();
  const u = await api('/admin/usuarios');
  if (!u.length) { $('#tbl').innerHTML = '<p class="muted">Sin usuarios.</p>'; return; }
  const byRut = Object.fromEntries(u.map(x => [x.rut, x]));
  $('#tbl').innerHTML = `<table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${
    u.map(x => `<tr>
      <td><b>${escD(x.nombre)}</b><br><small class="muted">${escD(x.rut)}</small></td>
      <td>${escD(x.email||'—')}</td>
      <td><select class="rolSel" data-rut="${escD(x.rut)}">${Object.keys(ROL_LBL).map(r=>`<option value="${r}" ${x.rol===r?'selected':''}>${ROL_LBL[r]}</option>`).join('')}</select></td>
      <td><select class="estSelU" data-rut="${escD(x.rut)}">${EST_OPTS.map(e=>`<option value="${e}" ${x.estado===e?'selected':''}>${e}</option>`).join('')}</select></td>
      <td><button class="btn sm ghost ed" data-rut="${escD(x.rut)}">Editar</button>
          <button class="btn sm ghost cl" data-rut="${escD(x.rut)}">Clave</button></td>
    </tr>`).join('')}</tbody></table>`;
  $('#tbl').querySelectorAll('.rolSel').forEach(s => s.onchange = async () => {
    try { await api(`/admin/usuarios/${encodeURIComponent(s.dataset.rut)}`, { method:'PUT', body:{ rol:s.value }}); toast('Rol actualizado'); }
    catch(e){ toast(e.message||'Error'); }
  });
  $('#tbl').querySelectorAll('.estSelU').forEach(s => s.onchange = async () => {
    try { await api(`/admin/usuarios/${encodeURIComponent(s.dataset.rut)}/estado`, { method:'POST', body:{ estado:s.value }}); toast('Estado actualizado'); }
    catch(e){ toast(e.message||'Error'); }
  });
  $('#tbl').querySelectorAll('.ed').forEach(b => b.onclick = () => usuarioForm(byRut[b.dataset.rut]));
  $('#tbl').querySelectorAll('.cl').forEach(b => b.onclick = () => claveForm(b.dataset.rut));
}

function usuarioForm(u) {
  const edit = !!u;
  openModal(`<h3>${edit?'Editar usuario':'Nuevo usuario'}</h3>
    <div class="field"><label>RUT</label><input id="fRut" value="${edit?escD(u.rut):''}" ${edit?'disabled':''} placeholder="12.345.678-9"></div>
    <div class="field"><label>Nombre</label><input id="fNom" value="${edit?escD(u.nombre):''}"></div>
    <div class="field"><label>Correo</label><input id="fEmail" value="${edit?escD(u.email||''):''}" placeholder="correo@ust.cl"></div>
    <div class="field"><label>Rol</label><select id="fRol">${Object.keys(ROL_LBL).map(r=>`<option value="${r}" ${edit&&u.rol===r?'selected':''}>${ROL_LBL[r]}</option>`).join('')}</select></div>
    <div class="field"><label>Estado</label><select id="fEst">${EST_OPTS.map(e=>`<option value="${e}" ${edit&&u.estado===e?'selected':''}>${e}</option>`).join('')}</select></div>
    ${edit?'':'<div class="field"><label>Clave inicial (opcional)</label><input id="fPass" type="password" placeholder="mín. 6 caracteres"></div>'}
    <button class="btn full" id="fOk">${edit?'Guardar':'Crear'}</button>
    <div class="err" id="fErr"></div>`);
  $('#fOk').onclick = async () => {
    $('#fErr').textContent = '';
    const body = { nombre:$('#fNom').value.trim(), email:$('#fEmail').value.trim()||null, rol:$('#fRol').value, estado:$('#fEst').value };
    try {
      if (edit) {
        await api(`/admin/usuarios/${encodeURIComponent(u.rut)}`, { method:'PUT', body });
      } else {
        body.rut = $('#fRut').value.trim();
        const p = $('#fPass').value; if (p) body.password = p;
        if (!body.rut || !body.nombre) { $('#fErr').textContent = 'RUT y nombre son obligatorios'; return; }
        await api('/admin/usuarios', { method:'POST', body });
      }
      closeModal(); toast(edit?'Usuario actualizado':'Usuario creado'); viewUsuarios();
    } catch(e){ $('#fErr').textContent = e.message || 'Error'; }
  };
}

function claveForm(rut) {
  openModal(`<h3>Cambiar clave</h3><p class="muted" style="font-size:12.5px">Usuario ${escD(rut)}</p>
    <div class="field"><label>Nueva clave</label><input id="cPass" type="password" placeholder="mín. 6 caracteres"></div>
    <button class="btn full" id="cOk">Guardar clave</button><div class="err" id="cErr"></div>`);
  $('#cOk').onclick = async () => {
    const p = $('#cPass').value;
    if (!p || p.length < 6) { $('#cErr').textContent = 'La clave debe tener al menos 6 caracteres'; return; }
    try { await api(`/admin/usuarios/${encodeURIComponent(rut)}/clave`, { method:'POST', body:{ password:p }}); closeModal(); toast('Clave actualizada'); }
    catch(e){ $('#cErr').textContent = e.message || 'Error'; }
  };
}

// ----- Mi perfil (todos los roles) -----
async function viewPerfil() {
  const u = ME.user;
  h(`<h2 class="page">Mi perfil</h2>
     <div class="card" style="max-width:460px">
       <div class="field"><label>RUT</label><input value="${escD(u.rut)}" disabled></div>
       <div class="field"><label>Rol</label><input value="${({alumno:'Alumno',docente:'Docente',panolero:'Pañolero',admin:'Administrador'})[u.rol]||u.rol}" disabled></div>
       <div class="field"><label>Nombre</label><input id="pNom" value="${escD(u.nombre||'')}"></div>
       <div class="field"><label>Correo</label><input id="pEmail" value="${escD(u.email||'')}" placeholder="correo@ust.cl"></div>
       <button class="btn full" id="pGuardar">Guardar datos</button>
       <div class="err" id="pErr"></div>
       <div style="border-top:1px solid var(--line);margin:16px 0 12px"></div>
       <h3 style="font-size:15px;margin:0 0 8px">Cambiar clave</h3>
       <div class="field"><label>Nueva clave</label><input id="pPass" type="password" placeholder="mín. 6 caracteres"></div>
       <button class="btn full ghost" id="pClave">Actualizar clave</button>
       <div class="err" id="pErr2"></div>
     </div>`);
  $('#pGuardar').onclick = async () => {
    $('#pErr').textContent = '';
    const nombre = $('#pNom').value.trim(), email = $('#pEmail').value.trim();
    if (!nombre) { $('#pErr').textContent = 'El nombre no puede quedar vacío'; return; }
    try {
      await api('/perfil', { method:'PUT', body:{ nombre, email: email || null } });
      ME.user.nombre = nombre; ME.user.email = email;
      $('#whoName').textContent = nombre;
      toast('Datos actualizados');
    } catch(e){ $('#pErr').textContent = e.message || 'Error'; }
  };
  $('#pClave').onclick = async () => {
    $('#pErr2').textContent = '';
    const p = $('#pPass').value;
    if (!p || p.length < 6) { $('#pErr2').textContent = 'La clave debe tener al menos 6 caracteres'; return; }
    try { await api('/perfil', { method:'PUT', body:{ password:p } }); $('#pPass').value=''; toast('Clave actualizada'); }
    catch(e){ $('#pErr2').textContent = e.message || 'Error'; }
  };
}

// ----- Admin: Estructura académica -----
async function viewAcademico() {
  h(`<h2 class="page">Estructura académica</h2>
     <button class="btn sm" id="nc" style="margin-bottom:14px">+ Nueva carrera</button>
     <div id="aca">Cargando…</div>`);
  $('#nc').onclick = () => carreraForm();
  await renderAcademico();
}
async function renderAcademico() {
  const d = await api('/academico');
  const carreras = d.carreras || [], asigs = d.asignaturas || [];
  if (!carreras.length) { $('#aca').innerHTML = '<p class="muted">Sin carreras. Crea la primera con "+ Nueva carrera".</p>'; return; }
  const byCar = {};
  asigs.forEach(a => { (byCar[a.carrera_id] = byCar[a.carrera_id] || []).push(a); });
  $('#aca').innerHTML = carreras.map(c => `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <b style="font-size:15px;flex:1;min-width:140px">${escD(c.nombre)}</b>
        <button class="btn sm ghost ec" data-id="${c.id}" data-nom="${escD(c.nombre)}">Editar</button>
        <button class="btn sm ghost dc" data-id="${c.id}">Eliminar</button>
        <button class="btn sm na" data-id="${c.id}">+ Asignatura</button>
      </div>
      ${(byCar[c.id]||[]).length ? `<table><thead><tr><th>Asignatura</th><th>Sección</th><th>Acciones</th></tr></thead><tbody>${
        (byCar[c.id]||[]).map(a => `<tr>
          <td>${escD(a.nombre)}</td><td>${escD(a.seccion||'—')}</td>
          <td><button class="btn sm ghost ea" data-id="${a.id}" data-nom="${escD(a.nombre)}" data-sec="${escD(a.seccion||'')}">Editar</button>
              <button class="btn sm ghost ins" data-id="${a.id}" data-nom="${escD(a.nombre)}">Inscritos</button>
              <button class="btn sm ghost da" data-id="${a.id}">Eliminar</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted" style="font-size:12.5px">Sin asignaturas aún.</p>'}
    </div>`).join('');
  $('#aca').querySelectorAll('.ec').forEach(b => b.onclick = () => carreraForm({ id:b.dataset.id, nombre:b.dataset.nom }));
  $('#aca').querySelectorAll('.dc').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar la carrera y todas sus asignaturas?')) return;
    try { await api(`/admin/carreras/${b.dataset.id}`, { method:'DELETE' }); toast('Carrera eliminada'); renderAcademico(); } catch(e){ toast(e.message||'Error'); }
  });
  $('#aca').querySelectorAll('.na').forEach(b => b.onclick = () => asignaturaForm(b.dataset.id));
  $('#aca').querySelectorAll('.ea').forEach(b => b.onclick = () => asignaturaForm(null, { id:b.dataset.id, nombre:b.dataset.nom, seccion:b.dataset.sec }));
  $('#aca').querySelectorAll('.da').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar la asignatura?')) return;
    try { await api(`/admin/asignaturas/${b.dataset.id}`, { method:'DELETE' }); toast('Asignatura eliminada'); renderAcademico(); } catch(e){ toast(e.message||'Error'); }
  });
  $('#aca').querySelectorAll('.ins').forEach(b => b.onclick = () => inscritosModal(b.dataset.id, b.dataset.nom));
}
function carreraForm(c) {
  const edit = !!c;
  openModal(`<h3>${edit?'Editar carrera':'Nueva carrera'}</h3>
    <div class="field"><label>Nombre</label><input id="cN" value="${edit?escD(c.nombre):''}" placeholder="Ej. Comunicación Audiovisual Digital"></div>
    <button class="btn full" id="cOkk">${edit?'Guardar':'Crear'}</button><div class="err" id="cE"></div>`);
  $('#cOkk').onclick = async () => {
    const nombre = $('#cN').value.trim();
    if (!nombre) { $('#cE').textContent = 'El nombre es obligatorio'; return; }
    try {
      if (edit) await api(`/admin/carreras/${c.id}`, { method:'PUT', body:{ nombre } });
      else await api('/admin/carreras', { method:'POST', body:{ nombre } });
      closeModal(); toast(edit?'Carrera actualizada':'Carrera creada'); renderAcademico();
    } catch(e){ $('#cE').textContent = e.message || 'Error'; }
  };
}
function asignaturaForm(carreraId, a) {
  const edit = !!a;
  openModal(`<h3>${edit?'Editar asignatura':'Nueva asignatura'}</h3>
    <div class="field"><label>Nombre</label><input id="aN" value="${edit?escD(a.nombre):''}"></div>
    <div class="field"><label>Sección</label><input id="aS" value="${edit?escD(a.seccion||''):''}" placeholder="Ej. 01"></div>
    <button class="btn full" id="aOk">${edit?'Guardar':'Crear'}</button><div class="err" id="aE"></div>`);
  $('#aOk').onclick = async () => {
    const nombre = $('#aN').value.trim(), seccion = $('#aS').value.trim() || null;
    if (!nombre) { $('#aE').textContent = 'El nombre es obligatorio'; return; }
    try {
      if (edit) await api(`/admin/asignaturas/${a.id}`, { method:'PUT', body:{ nombre, seccion } });
      else await api('/admin/asignaturas', { method:'POST', body:{ nombre, seccion, carrera_id:Number(carreraId) } });
      closeModal(); toast(edit?'Asignatura actualizada':'Asignatura creada'); renderAcademico();
    } catch(e){ $('#aE').textContent = e.message || 'Error'; }
  };
}
async function inscritosModal(asigId, nom) {
  openModal(`<h3>Inscritos</h3><p class="muted" style="font-size:12.5px;margin:-4px 0 10px">${escD(nom)}</p>
    <div id="insList">Cargando…</div>
    <div style="border-top:1px solid var(--line);margin:12px 0 10px"></div>
    <div class="field"><label>Inscribir (RUT)</label><input id="iR" list="usrList" placeholder="12.345.678-9"></div>
    <div class="field"><label>Rol en la asignatura</label><select id="iRol"><option value="alumno">Alumno</option><option value="docente">Docente</option></select></div>
    <datalist id="usrList"></datalist>
    <button class="btn full" id="iOk">Inscribir</button><div class="err" id="iE"></div>`);
  try {
    const us = await api('/admin/usuarios');
    $('#usrList').innerHTML = us.map(u => `<option value="${escD(u.rut)}">${escD(u.nombre)}</option>`).join('');
  } catch(e){}
  async function pintarInscritos() {
    const list = await api(`/admin/asignaturas/${asigId}/inscritos`);
    $('#insList').innerHTML = list.length ? list.map(x => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(x.nombre)}</b><small>${escD(x.rut)} · ${x.rol_en_asig}</small></div><button class="btn sm ghost rm" data-rut="${escD(x.rut)}">Quitar</button></div>`).join('') : '<p class="muted" style="font-size:12.5px">Sin inscritos.</p>';
    $('#insList').querySelectorAll('.rm').forEach(b => b.onclick = async () => {
      try { await api(`/admin/asignaturas/${asigId}/inscritos/${encodeURIComponent(b.dataset.rut)}`, { method:'DELETE' }); pintarInscritos(); } catch(e){ toast(e.message||'Error'); }
    });
  }
  await pintarInscritos();
  $('#iOk').onclick = async () => {
    $('#iE').textContent = '';
    const rut = $('#iR').value.trim(); if (!rut) { $('#iE').textContent = 'Ingresa un RUT'; return; }
    try { await api(`/admin/asignaturas/${asigId}/inscritos`, { method:'POST', body:{ usuario_rut:rut, rol_en_asig:$('#iRol').value } }); $('#iR').value=''; pintarInscritos(); toast('Inscrito'); }
    catch(e){ $('#iE').textContent = e.message || 'Error'; }
  };
}

// ----- Tareas (docente / alumno) -----
function dtLocal(iso){ if(!iso) return ''; const d=new Date(iso); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

async function viewTareas() {
  const docente = ME.user.rol === 'docente' || ME.user.rol === 'admin';
  h(`<h2 class="page">Tareas</h2>
     ${docente ? '<button class="btn sm" id="nt" style="margin-bottom:14px">+ Nueva tarea</button>' : '<p class="muted" style="margin:-8px 0 14px;font-size:13px">Tareas vigentes de tus asignaturas. Entra para reservar los equipos habilitados.</p>'}
     <div id="tl">Cargando…</div>`);
  if (docente) $('#nt').onclick = () => tareaForm();
  const ts = await api('/tareas');
  if (!ts.length) { $('#tl').innerHTML = '<p class="muted">No hay tareas.</p>'; return; }
  $('#tl').innerHTML = ts.map(t => `
    <div class="row tareaItem" data-id="${t.id}" style="cursor:pointer">
      <div class="ava">📝</div>
      <div class="info"><b>${escD(t.titulo)}</b><small>${escD(t.asignatura)}${t.seccion?(' · '+escD(t.seccion)):''} · ${t.tipo} · ${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</small></div>
      ${docente ? `<span class="pill info">${t.reservas||0} reservas</span>` : '<span class="pill ok">ver</span>'}
    </div>`).join('');
  $('#tl').querySelectorAll('.tareaItem').forEach(el => el.onclick = () => tareaDetalle(el.dataset.id));
}

async function tareaDetalle(id) {
  const d = await api(`/tareas/${id}`);
  const t = d.tarea, docente = ME.user.rol==='docente'||ME.user.rol==='admin';
  const equiposHtml = d.equipos.length ? d.equipos.map(e => `<div class="row" style="margin-bottom:6px"><div class="ava">${icon(e.categoria)}</div><div class="info"><b>${escD(e.nombre)}</b><small>${escD(e.categoria||'')} · ${(ESTADO_EQ[e.estado]||[e.estado])[0]}</small></div>${!docente ? `<button class="btn sm rsv" data-eid="${e.id}" data-enom="${escD(e.nombre)}" ${e.estado!=='disponible'?'disabled':''}>Reservar</button>`:''}</div>`).join('') : '<p class="muted">Sin equipos habilitados.</p>';
  const resHtml = docente ? (d.reservas.length ? `<h3 style="font-size:15px;margin:14px 0 8px">Reservas de alumnos</h3>`+d.reservas.map(r=>`<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(r.alumno)}</b><small>${escD(r.equipo)} · ${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</small></div><span class="pill ${(ESTADO_RES[r.estado]||['','info'])[1]}">${(ESTADO_RES[r.estado]||[r.estado])[0]}</span></div>`).join('') : '<p class="muted" style="margin-top:14px">Aún sin reservas de alumnos.</p>') : '';
  openModal(`<h3>${escD(t.titulo)}</h3>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 8px">${escD(t.asignatura)}${t.seccion?(' · '+escD(t.seccion)):''} · ${t.tipo}<br>${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</p>
    ${t.descripcion?`<p style="font-size:13px">${escD(t.descripcion)}</p>`:''}
    <h3 style="font-size:15px;margin:12px 0 8px">Equipos habilitados</h3>
    <div id="teq">${equiposHtml}</div>
    ${resHtml}
    ${docente?`<button class="btn full ghost danger" id="delT" style="margin-top:14px">Eliminar tarea</button>`:''}`);
  if (!docente) {
    $('#teq').querySelectorAll('.rsv').forEach(b => b.onclick = () => reservarTareaForm(id, b.dataset.eid, b.dataset.enom, t));
  } else {
    $('#delT').onclick = async () => { if(!confirm('¿Eliminar la tarea?'))return; try{ await api(`/tareas/${id}`,{method:'DELETE'}); closeModal(); toast('Tarea eliminada'); viewTareas(); }catch(e){ toast(e.message||'Error'); } };
  }
}

function reservarTareaForm(tareaId, equipoId, equipoNom, t) {
  openModal(`<h3>Reservar: ${escD(equipoNom)}</h3>
    <p class="muted" style="font-size:12px;margin:-4px 0 8px">Dentro de la tarea · ${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</p>
    <div class="field"><label>Inicio</label><input id="rI" type="datetime-local" value="${dtLocal(t.fecha_inicio)}"></div>
    <div class="field"><label>Término</label><input id="rF" type="datetime-local" value="${dtLocal(t.fecha_fin)}"></div>
    <button class="btn full" id="rOk">Confirmar reserva</button><div class="err" id="rE"></div>`);
  $('#rOk').onclick = async () => {
    $('#rE').textContent='';
    const fi=$('#rI').value, ff=$('#rF').value;
    if(!fi||!ff){ $('#rE').textContent='Indica inicio y término'; return; }
    try { await api(`/tareas/${tareaId}/reservar`,{method:'POST',body:{equipo_id:Number(equipoId),fecha_inicio:fi,fecha_fin:ff}}); closeModal(); toast('Reserva confirmada'); }
    catch(e){ $('#rE').textContent=e.message||'Error'; }
  };
}

async function tareaForm() {
  const asigs = ME.asignaturas || [];
  if (!asigs.length) { openModal('<h3>Nueva tarea</h3><p class="muted">No tienes asignaturas a cargo. Pide al administrador que te inscriba como docente en una asignatura (menú Académico).</p>'); return; }
  const eqs = await api('/equipos');
  openModal(`<h3>Nueva tarea</h3>
    <div class="field"><label>Asignatura</label><select id="tAsig">${asigs.map(a=>`<option value="${a.id}">${escD(a.nombre)}${a.seccion?(' · '+escD(a.seccion)):''}</option>`).join('')}</select></div>
    <div class="field"><label>Título</label><input id="tTit"></div>
    <div class="field"><label>Descripción</label><input id="tDesc"></div>
    <div class="field"><label>Inicio</label><input id="tIni" type="datetime-local"></div>
    <div class="field"><label>Término</label><input id="tFin" type="datetime-local"></div>
    <div class="field"><label>Tipo</label><select id="tTipo"><option value="individual">Individual</option><option value="grupal">Grupal</option></select></div>
    <label style="font-size:12px;font-weight:600;color:var(--muted)">Equipos habilitados</label>
    <div style="max-height:160px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0 10px">
      ${eqs.length?eqs.map(e=>`<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:3px 0"><input type="checkbox" class="eqchk" value="${e.id}">${escD(e.nombre)} <span class="muted" style="font-size:11px">${escD(e.categoria||'')}</span></label>`).join(''):'<span class="muted" style="font-size:12.5px">No hay equipos registrados.</span>'}
    </div>
    <button class="btn full" id="tOk">Crear tarea</button><div class="err" id="tE"></div>`);
  $('#tOk').onclick = async () => {
    $('#tE').textContent='';
    const body = { asignatura_id:Number($('#tAsig').value), titulo:$('#tTit').value.trim(), descripcion:$('#tDesc').value.trim()||null,
      fecha_inicio:$('#tIni').value, fecha_fin:$('#tFin').value, tipo:$('#tTipo').value,
      equipos: Array.from(document.querySelectorAll('.eqchk:checked')).map(c=>Number(c.value)) };
    if(!body.titulo||!body.fecha_inicio||!body.fecha_fin){ $('#tE').textContent='Título y fechas son obligatorios'; return; }
    try { await api('/tareas',{method:'POST',body}); closeModal(); toast('Tarea creada'); viewTareas(); }
    catch(e){ $('#tE').textContent=e.message||'Error'; }
  };
}

// ----- Solicitudes especiales (alumno / docente) -----
async function viewSolicitudes() {
  if (ME.user.rol==='docente' || ME.user.rol==='admin') return viewSolicDocente();
  h(`<h2 class="page">Solicitudes especiales</h2>
     <button class="btn sm" id="ns" style="margin-bottom:14px">+ Nueva solicitud</button>
     <div id="sl">Cargando…</div>`);
  $('#ns').onclick = () => solicitudForm();
  const ss = await api('/solicitudes/mias');
  $('#sl').innerHTML = ss.length ? ss.map(s=>`<div class="card" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(s.asignatura||'Solicitud general')}</b><span class="pill ${s.estado==='aprobada'?'ok':s.estado==='rechazada'?'bad':'warn'}">${s.estado}</span></div>
    <p style="font-size:13px;margin:8px 0 4px">${escD(s.descripcion)}</p>
    ${(s.fecha_inicio||s.fecha_fin)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📅 ${s.fecha_inicio?fmtDate(s.fecha_inicio):''}${s.fecha_fin?' → '+fmtDate(s.fecha_fin):''}${s.duracion?' · '+escD(s.duracion):''}</p>`:''}
    ${(s.equipos&&s.equipos.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📷 ${s.equipos.map(escD).join(', ')}</p>`:''}
    ${s.respuesta?`<p class="muted" style="font-size:12.5px"><b>Respuesta:</b> ${escD(s.respuesta)}</p>`:''}
    <small class="muted">${fmtDate(s.created_at)}</small></div>`).join('') : '<p class="muted">No has enviado solicitudes.</p>';
}
function solicitudForm() {
  const asigs = ME.asignaturas || [];
  const solicitados = [];     // {id, nombre, categoria}
  let disponibles = [];       // equipos de la asignatura
  h(`<h2 class="page">Nueva solicitud especial</h2>
    <div class="dash-grid">
      <div class="panel"><h3>📘 Información</h3>
        <div class="field"><label>Asignatura</label><select id="sAsig"><option value="">——————</option>${asigs.map(a => `<option value="${a.id}">${escD(a.nombre)}${a.seccion ? (' · ' + escD(a.seccion)) : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Descripción</label><textarea id="sDesc" rows="4" style="padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit" placeholder="Motivo de la solicitud"></textarea></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Fecha inicio</label><input type="date" id="sFi"></div><div class="field" style="flex:1"><label>Hora inicio</label><input type="time" id="sHi"></div></div>
        <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Fecha fin</label><input type="date" id="sFf"></div><div class="field" style="flex:1"><label>Hora fin</label><input type="time" id="sHf"></div></div>
        <div class="field" style="max-width:180px"><label>Duración</label><input id="sDur" placeholder="(automática)" readonly></div>
        <div class="err" id="sE"></div>
        <div style="text-align:right"><button class="btn" id="sOk">Crear</button></div>
      </div>
      <div class="panel"><h3>📷 Equipos solicitados</h3><div id="sSel"></div></div>
    </div>
    <div class="panel" style="margin-top:14px"><h3>Equipos disponibles para la asignatura</h3><div id="sDisp"><p class="muted">Selecciona una asignatura para ver sus equipos.</p></div></div>`);

  const calcDur = () => {
    const fi = $('#sFi').value, hi = $('#sHi').value, ff = $('#sFf').value, hf = $('#sHf').value;
    if (fi && hi && ff && hf) {
      const d1 = new Date(fi + 'T' + hi), d2 = new Date(ff + 'T' + hf);
      const ms = d2 - d1;
      $('#sDur').value = ms > 0 ? (Math.round(ms / 3600000 * 10) / 10) + ' h' : '';
    } else $('#sDur').value = '';
  };
  ['sFi', 'sHi', 'sFf', 'sHf'].forEach(id => $('#' + id).addEventListener('change', calcDur));

  const renderSel = () => {
    $('#sSel').innerHTML = solicitados.length
      ? `<table><thead><tr><th>Foto</th><th>Nombre</th><th>Operación</th></tr></thead><tbody>${solicitados.map(e => `<tr>
          <td style="font-size:20px">${icon(e.categoria)}</td><td>${escD(e.nombre)}</td>
          <td><button class="btn sm ghost danger" data-q="${e.id}">Quitar</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aún no agregas equipos. Agrégalos desde la lista inferior.</p>';
    $('#sSel').querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const i = solicitados.findIndex(x => String(x.id) === b.dataset.q);
      if (i >= 0) solicitados.splice(i, 1); renderSel(); renderDisp();
    });
  };
  const renderDisp = () => {
    const libres = disponibles.filter(e => !solicitados.some(s => s.id === e.id));
    $('#sDisp').innerHTML = libres.length
      ? `<table><thead><tr><th>Foto</th><th>Nombre</th><th>Categoría</th><th>Operación</th></tr></thead><tbody>${libres.map(e => `<tr>
          <td style="font-size:20px">${icon(e.categoria)}</td><td>${escD(e.nombre)}</td><td>${escD(e.categoria || '')}</td>
          <td><button class="btn sm" data-a="${e.id}" ${e.estado !== 'disponible' ? 'disabled title="No disponible"' : ''}>Agregar</button></td></tr>`).join('')}</tbody></table>`
      : (disponibles.length ? '<p class="muted">Todos los equipos ya fueron agregados.</p>' : '<p class="muted">No hay equipos habilitados para esta asignatura.</p>');
    $('#sDisp').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const e = disponibles.find(x => String(x.id) === b.dataset.a);
      if (e && !solicitados.some(s => s.id === e.id)) solicitados.push({ id: e.id, nombre: e.nombre, categoria: e.categoria });
      renderSel(); renderDisp();
    });
  };
  renderSel(); renderDisp();

  $('#sAsig').onchange = async () => {
    const aid = $('#sAsig').value;
    if (!aid) { disponibles = []; renderDisp(); return; }
    $('#sDisp').innerHTML = '<p class="muted">Cargando equipos…</p>';
    try { disponibles = await api('/asignaturas/' + aid + '/equipos'); }
    catch (e) { disponibles = []; $('#sDisp').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
    renderDisp();
  };

  $('#sOk').onclick = async () => {
    $('#sE').textContent = '';
    const descripcion = $('#sDesc').value.trim();
    if (!descripcion) { $('#sE').textContent = 'Escribe la descripción'; return; }
    const asignatura_id = $('#sAsig').value ? Number($('#sAsig').value) : null;
    const fi = $('#sFi').value, hi = $('#sHi').value, ff = $('#sFf').value, hf = $('#sHf').value;
    const fecha_inicio = (fi && hi) ? new Date(fi + 'T' + hi).toISOString() : null;
    const fecha_fin = (ff && hf) ? new Date(ff + 'T' + hf).toISOString() : null;
    try {
      await api('/solicitudes', { method: 'POST', body: {
        asignatura_id, descripcion, fecha_inicio, fecha_fin,
        duracion: $('#sDur').value || null, equipos: solicitados.map(e => e.id),
      }});
      toast('Solicitud creada'); viewSolicitudes();
    } catch (e) { $('#sE').textContent = e.message || 'Error'; }
  };
}
async function viewSolicDocente() {
  h(`<h2 class="page">Solicitudes por responder</h2><div id="sl">Cargando…</div>`);
  const ss = await api('/solicitudes/pendientes');
  if (!ss.length) { $('#sl').innerHTML='<p class="muted">No hay solicitudes pendientes.</p>'; return; }
  $('#sl').innerHTML = ss.map(s=>`<div class="card" style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(s.alumno)}</b><small class="muted">${escD(s.asignatura||'')}</small></div>
    <p style="font-size:13px;margin:8px 0">${escD(s.descripcion)}</p>
    ${(s.fecha_inicio||s.fecha_fin)?`<p class="muted" style="font-size:12.5px;margin:2px 0">📅 ${s.fecha_inicio?fmtDate(s.fecha_inicio):''}${s.fecha_fin?' → '+fmtDate(s.fecha_fin):''}${s.duracion?' · '+escD(s.duracion):''}</p>`:''}
    ${(s.equipos&&s.equipos.length)?`<p class="muted" style="font-size:12.5px;margin:2px 0 8px">📷 ${s.equipos.map(escD).join(', ')}</p>`:''}
    <div style="display:flex;gap:8px"><button class="btn sm ap" data-id="${s.id}">Aprobar</button><button class="btn sm ghost danger rc" data-id="${s.id}">Rechazar</button></div>
  </div>`).join('');
  $('#sl').querySelectorAll('.ap').forEach(b=>b.onclick=()=>responderSolic(b.dataset.id,'aprobada'));
  $('#sl').querySelectorAll('.rc').forEach(b=>b.onclick=()=>responderSolic(b.dataset.id,'rechazada'));
}
function responderSolic(id, estado) {
  openModal(`<h3>${estado==='aprobada'?'Aprobar':'Rechazar'} solicitud</h3>
    <div class="field"><label>Comentario (opcional)</label><input id="rpT" placeholder="Mensaje para el alumno"></div>
    <button class="btn full ${estado==='rechazada'?'danger':''}" id="rpOk">${estado==='aprobada'?'Aprobar':'Rechazar'}</button><div class="err" id="rpE"></div>`);
  $('#rpOk').onclick = async () => {
    try { await api(`/solicitudes/${id}/responder`,{method:'POST',body:{estado,respuesta:$('#rpT').value.trim()||null}}); closeModal(); toast('Solicitud respondida'); viewSolicDocente(); }
    catch(e){ $('#rpE').textContent=e.message||'Error'; }
  };
}

// ===================== Calendario de disponibilidad =====================
async function viewDisponibilidad() {
  h(`<h2 class="page">Disponibilidad de equipos</h2>
    <p class="muted">Consulta los periodos ya ocupados de un equipo antes de reservar.</p>
    <div class="card" style="margin-bottom:14px">
      <div class="field"><label>Equipo</label><select id="dEq"><option value="">Cargando…</option></select></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Desde</label><input type="date" id="dDesde"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Hasta</label><input type="date" id="dHasta"></div>
      </div>
      <button class="btn full" id="dBtn">Ver disponibilidad</button>
    </div>
    <div id="dRes"></div>`);
  const hoy = new Date();
  const en3 = new Date(hoy.getTime() + 21 * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  $('#dDesde').value = iso(hoy); $('#dHasta').value = iso(en3);
  const eq = await api('/equipos');
  if (!eq.length) { $('#dEq').innerHTML = '<option value="">No hay equipos disponibles para ti</option>'; return; }
  $('#dEq').innerHTML = eq.map(e => `<option value="${e.id}">${escD(e.nombre)} · ${escD(e.codigo_qr)}</option>`).join('');
  const consultar = async () => {
    const id = $('#dEq').value; if (!id) return;
    $('#dRes').innerHTML = '<p class="muted">Consultando…</p>';
    const q = `?desde=${$('#dDesde').value}&hasta=${$('#dHasta').value}`;
    try {
      const data = await api(`/equipos/${id}/ocupacion${q}`);
      const estado = data.equipo ? (ESTADO_EQ[data.equipo.estado] || [data.equipo.estado, 'info']) : null;
      let html = `<div class="aviso ok" style="margin-bottom:12px">🕐 Horario de atención del pañol: <b>${escD(data.horario)}</b></div>`;
      if (estado) html += `<p style="margin:0 0 10px">Estado actual del equipo: <span class="pill ${estado[1]}">${estado[0]}</span></p>`;
      if (!data.reservas.length) {
        html += '<div class="aviso ok">✅ Sin reservas en el rango seleccionado: el equipo está libre.</div>';
      } else {
        html += '<p class="muted" style="margin:0 0 8px">Periodos ocupados (no disponibles para reservar):</p>';
        html += data.reservas.map(r => {
          const [lab, cls] = ESTADO_RES[r.estado] || [r.estado, 'info'];
          return `<div class="row"><div class="ava">📅</div><div class="info">
            <b>${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</b>
            <small>${escD(r.usuario)}</small></div><span class="pill ${cls}">${lab}</span></div>`;
        }).join('');
      }
      $('#dRes').innerHTML = html;
    } catch (e) { $('#dRes').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#dBtn').onclick = consultar;
  $('#dEq').onchange = consultar;
  consultar();
}

// ===================== Gestión completa de pedidos (admin/pañolero) =====================
const PEDIDO_ESTADOS = ['pendiente', 'confirmada', 'en_uso', 'completada', 'cancelada', 'expirada'];
async function viewPedidos() {
  h(`<h2 class="page">Gestión de pedidos</h2>
    <p class="muted">Todas las reservas de equipos, con filtro por estado y búsqueda.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
      <div class="field" style="margin:0"><label>Estado</label><select id="pEstado">
        <option value="">Todos</option>${PEDIDO_ESTADOS.map(e => `<option value="${e}">${(ESTADO_RES[e] || [e])[0]}</option>`).join('')}
      </select></div>
      <div class="field" style="margin:0;flex:1;min-width:160px"><label>Buscar (usuario, RUT o equipo)</label><input id="pQ" placeholder="Escribe y presiona Buscar"></div>
      <button class="btn" id="pBuscar">Buscar</button>
      <button class="btn ghost" id="pNuevo">+ Pedido presencial</button>
    </div>
    <div id="pList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const qs = [];
    if ($('#pEstado').value) qs.push('estado=' + encodeURIComponent($('#pEstado').value));
    if ($('#pQ').value.trim()) qs.push('q=' + encodeURIComponent($('#pQ').value.trim()));
    $('#pList').innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const rs = await api('/admin/pedidos' + (qs.length ? '?' + qs.join('&') : ''));
      if (!rs.length) { $('#pList').innerHTML = '<p class="muted">No hay pedidos con esos criterios.</p>'; return; }
      $('#pList').innerHTML = `<table><thead><tr><th>#</th><th>Usuario</th><th>Equipo</th><th>Periodo</th><th>Estado</th><th></th></tr></thead><tbody>${rs.map(r => {
        const [lab, cls] = ESTADO_RES[r.estado] || [r.estado, 'info'];
        return `<tr><td>${r.id}</td><td>${escD(r.usuario)}<br><small class="muted">${escD(r.rut)}</small></td>
          <td>${escD(r.equipo)}${r.tarea_id ? ' <span class="pill info">Tarea</span>' : ''}</td>
          <td style="font-size:12px">${fmtDate(r.fecha_inicio)}<br>${fmtDate(r.fecha_fin)}</td>
          <td><span class="pill ${cls}">${lab}</span></td>
          <td><button class="btn sm ghost" data-id="${r.id}">Ver</button></td></tr>`;
      }).join('')}</tbody></table>`;
      $('#pList').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => pedidoDetalle(b.dataset.id));
    } catch (e) { $('#pList').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#pBuscar').onclick = cargar;
  $('#pQ').addEventListener('keydown', e => { if (e.key === 'Enter') cargar(); });
  $('#pEstado').onchange = cargar;
  $('#pNuevo').onclick = pedidoPresencialForm;
  cargar();
}

async function pedidoDetalle(id) {
  const d = await api('/admin/pedidos/' + id);
  const r = d.reserva;
  const [lab, cls] = ESTADO_RES[r.estado] || [r.estado, 'info'];
  const ints = d.integrantes.length
    ? d.integrantes.map(i => `<li>${escD(i.nombre)} (${escD(i.rut)})${i.es_responsable ? ' · <b>responsable</b>' : ''}</li>`).join('')
    : '<li class="muted">Sin integrantes registrados</li>';
  const prest = d.prestamo
    ? `<p>Préstamo #${d.prestamo.id} · ${escD(d.prestamo.estado)}${d.prestamo.fecha_salida ? ' · salida ' + fmtDate(d.prestamo.fecha_salida) : ''}${d.prestamo.fecha_retorno ? ' · retorno ' + fmtDate(d.prestamo.fecha_retorno) : ''}</p>`
    : '<p class="muted">Sin préstamo asociado todavía.</p>';
  openModal(`<h3>Pedido #${r.id}</h3>
    <p style="margin:2px 0 10px"><span class="pill ${cls}">${lab}</span></p>
    <p><b>${escD(r.equipo)}</b> · ${escD(r.codigo_qr || '')}</p>
    <p>Solicitante: ${escD(r.usuario)} (${escD(r.rut)})</p>
    <p>Periodo: ${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</p>
    ${r.motivo ? `<p>Motivo: ${escD(r.motivo)}</p>` : ''}
    <p style="margin-bottom:2px"><b>Integrantes</b></p><ul style="margin:0 0 10px;padding-left:18px;font-size:13px">${ints}</ul>
    ${prest}
    <button class="btn full" id="pImp">🖨️ Imprimir comprobante</button>`);
  $('#pImp').onclick = () => imprimirComprobante(d);
}

function imprimirComprobante(d) {
  const r = d.reserva;
  const w = window.open('', '_blank');
  if (!w) { toast('Permite ventanas emergentes para imprimir'); return; }
  const ints = d.integrantes.map(i => `${escD(i.nombre)} (${escD(i.rut)})${i.es_responsable ? ' — responsable' : ''}`).join('<br>') || '—';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comprobante pedido #${r.id}</title>
    <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#152230;max-width:560px;margin:30px auto;padding:0 20px}
    h1{color:#0E8F86;font-size:20px;margin:0 0 2px}.s{color:#6B7785;font-size:12px;margin:0 0 18px}
    table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px 4px;border-bottom:1px solid #E4E8ED;vertical-align:top}
    td.k{color:#6B7785;width:34%}.ft{margin-top:26px;font-size:11px;color:#90a0b0;text-align:center}</style></head>
    <body><h1>Préstalo · Comprobante de pedido</h1><p class="s">Universidad Santo Tomás — Área de Comunicación Audiovisual</p>
    <table>
      <tr><td class="k">N° de pedido</td><td>#${r.id}</td></tr>
      <tr><td class="k">Estado</td><td>${(ESTADO_RES[r.estado] || [r.estado])[0]}</td></tr>
      <tr><td class="k">Equipo</td><td>${escD(r.equipo)} (${escD(r.codigo_qr || '')})</td></tr>
      <tr><td class="k">Solicitante</td><td>${escD(r.usuario)} — ${escD(r.rut)}</td></tr>
      <tr><td class="k">Periodo</td><td>${fmtDate(r.fecha_inicio)} → ${fmtDate(r.fecha_fin)}</td></tr>
      ${r.motivo ? `<tr><td class="k">Motivo</td><td>${escD(r.motivo)}</td></tr>` : ''}
      <tr><td class="k">Integrantes</td><td>${ints}</td></tr>
    </table>
    <p class="ft">Documento generado por Préstalo · ${new Date().toLocaleString('es-CL')}</p>
    </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

async function pedidoPresencialForm() {
  const eq = await api('/equipos');
  const disp = eq.filter(e => e.estado === 'disponible');
  openModal(`<h3>Pedido presencial</h3>
    <p class="muted" style="margin-top:0;font-size:13px">Registra un préstamo a nombre de un usuario presente en el pañol.</p>
    <div class="field"><label>RUT del usuario</label><input id="ppRut" placeholder="11.111.111-1"></div>
    <div class="field"><label>Equipo (solo disponibles)</label><select id="ppEq">
      ${disp.length ? disp.map(e => `<option value="${e.id}">${escD(e.nombre)} · ${escD(e.codigo_qr)}</option>`).join('') : '<option value="">No hay equipos disponibles</option>'}
    </select></div>
    <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Inicio</label><input type="datetime-local" id="ppIni"></div>
    <div class="field" style="flex:1"><label>Término</label><input type="datetime-local" id="ppFin"></div></div>
    <div class="field"><label>Motivo (opcional)</label><input id="ppMot" placeholder="Pedido presencial"></div>
    <div class="err" id="ppErr"></div>
    <button class="btn full" id="ppOk" ${disp.length ? '' : 'disabled'}>Registrar pedido</button>`);
  const now = new Date();
  $('#ppIni').value = dtLocal(new Date(now.getTime() + 5 * 60000).toISOString());
  $('#ppFin').value = dtLocal(new Date(now.getTime() + 3 * 3600000).toISOString());
  $('#ppOk').onclick = async () => {
    $('#ppErr').textContent = '';
    try {
      await api('/admin/pedidos', { method: 'POST', body: {
        usuario_rut: $('#ppRut').value.trim(),
        equipo_id: Number($('#ppEq').value),
        fecha_inicio: new Date($('#ppIni').value).toISOString(),
        fecha_fin: new Date($('#ppFin').value).toISOString(),
        motivo: $('#ppMot').value.trim() || null,
      }});
      closeModal(); toast('Pedido presencial registrado'); viewPedidos();
    } catch (e) { $('#ppErr').textContent = e.message; }
  };
}

// ===================== Categorías y Laboratorios (admin) =====================
async function viewCatalogos() {
  h(`<h2 class="page">Catálogos</h2>
    <p class="muted">Administra las categorías de equipos y los laboratorios/recintos.</p>
    <div class="dash-grid">
      <div class="panel"><h3>Categorías <button class="btn sm ghost" id="catNew" style="float:right">+ Nueva</button></h3><div id="catList" class="muted">Cargando…</div></div>
      <div class="panel"><h3>Laboratorios <button class="btn sm ghost" id="labNew" style="float:right">+ Nuevo</button></h3><div id="labList" class="muted">Cargando…</div></div>
    </div>`);
  const cargar = async () => {
    const [cats, labs] = await Promise.all([api('/categorias'), api('/laboratorios')]);
    $('#catList').innerHTML = cats.length ? cats.map(c => `<div class="row"><div class="ava">${escD(c.simbolo || '📦')}</div>
      <div class="info"><b>${escD(c.nombre)}</b></div>
      <button class="btn sm ghost" data-ed="${c.id}" data-n="${escD(c.nombre)}" data-s="${escD(c.simbolo || '')}">Editar</button>
      <button class="btn sm ghost danger" data-del="${c.id}">×</button></div>`).join('') : '<p class="muted">Sin categorías.</p>';
    $('#labList').innerHTML = labs.length ? labs.map(l => `<div class="row"><div class="ava">🏢</div>
      <div class="info"><b>${escD(l.nombre)}</b><small>${escD(l.ubicacion || '')}</small></div>
      <button class="btn sm ghost" data-led="${l.id}" data-n="${escD(l.nombre)}" data-u="${escD(l.ubicacion || '')}">Editar</button>
      <button class="btn sm ghost danger" data-ldel="${l.id}">×</button></div>`).join('') : '<p class="muted">Sin laboratorios.</p>';
    $('#catList').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => catForm(b.dataset.ed, b.dataset.n, b.dataset.s));
    $('#catList').querySelectorAll('[data-del]').forEach(b => b.onclick = () => delCatalogo('categorias', b.dataset.del, '¿Eliminar esta categoría?', cargar));
    $('#labList').querySelectorAll('[data-led]').forEach(b => b.onclick = () => labForm(b.dataset.led, b.dataset.n, b.dataset.u));
    $('#labList').querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => delCatalogo('laboratorios', b.dataset.ldel, '¿Eliminar este laboratorio?', cargar));
  };
  function catForm(id, nombre, simbolo) {
    openModal(`<h3>${id ? 'Editar' : 'Nueva'} categoría</h3>
      <div class="field"><label>Nombre</label><input id="cN" value="${id ? escD(nombre) : ''}"></div>
      <div class="field"><label>Símbolo / emoji (opcional)</label><input id="cS" value="${id ? escD(simbolo) : ''}" placeholder="📷"></div>
      <div class="err" id="cE"></div><button class="btn full" id="cOk">Guardar</button>`);
    $('#cOk').onclick = async () => {
      $('#cE').textContent = '';
      try {
        await api('/admin/categorias' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { nombre: $('#cN').value.trim(), simbolo: $('#cS').value.trim() || null } });
        closeModal(); toast('Categoría guardada'); cargar();
      } catch (e) { $('#cE').textContent = e.message; }
    };
  }
  function labForm(id, nombre, ubicacion) {
    openModal(`<h3>${id ? 'Editar' : 'Nuevo'} laboratorio</h3>
      <div class="field"><label>Nombre</label><input id="lN" value="${id ? escD(nombre) : ''}"></div>
      <div class="field"><label>Ubicación (opcional)</label><input id="lU" value="${id ? escD(ubicacion) : ''}" placeholder="Piso 2, Sala 210"></div>
      <div class="err" id="lE"></div><button class="btn full" id="lOk">Guardar</button>`);
    $('#lOk').onclick = async () => {
      $('#lE').textContent = '';
      try {
        await api('/admin/laboratorios' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { nombre: $('#lN').value.trim(), ubicacion: $('#lU').value.trim() || null } });
        closeModal(); toast('Laboratorio guardado'); cargar();
      } catch (e) { $('#lE').textContent = e.message; }
    };
  }
  $('#catNew').onclick = () => catForm(null);
  $('#labNew').onclick = () => labForm(null);
  cargar();
}
async function delCatalogo(tipo, id, msg, cb) {
  openModal(`<h3>Confirmar</h3><p>${msg}</p><div class="err" id="dcE"></div>
    <div style="display:flex;gap:8px"><button class="btn ghost" id="dcNo" style="flex:1">Cancelar</button><button class="btn danger" id="dcYes" style="flex:1">Eliminar</button></div>`);
  $('#dcNo').onclick = closeModal;
  $('#dcYes').onclick = async () => {
    try { await api('/admin/' + tipo + '/' + id, { method: 'DELETE' }); closeModal(); toast('Eliminado'); cb(); }
    catch (e) { $('#dcE').textContent = e.message; }
  };
}

// ===================== Anuncios (tablón) =====================
async function viewAnuncios() {
  const esAdmin = ME.user.rol === 'admin';
  h(`<h2 class="page">Anuncios</h2>
    <p class="muted">Avisos del pañol para tu sede.</p>
    ${esAdmin ? '<button class="btn" id="anNew" style="margin-bottom:14px">+ Nuevo anuncio</button>' : ''}
    <div id="anList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const rows = await api('/anuncios');
    marcarAnunciosLeidos(rows); updateAnunciosBadge();   // al abrir, quedan leídos
    if (!rows.length) { $('#anList').innerHTML = '<p class="muted">No hay anuncios por ahora.</p>'; return; }
    $('#anList').innerHTML = rows.map(a => `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:start"><b style="flex:1;font-size:15px">${escD(a.titulo)}</b>
        ${esAdmin ? `<button class="btn sm ghost danger" data-del="${a.id}">Eliminar</button>` : ''}</div>
      <p style="font-size:13.5px;margin:8px 0;white-space:pre-wrap">${escD(a.cuerpo)}</p>
      <small class="muted">${escD(a.autor || 'Pañol')} · ${fmtDate(a.created_at)}</small></div>`).join('');
    if (esAdmin) $('#anList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      try { await api('/admin/anuncios/' + b.dataset.del, { method: 'DELETE' }); toast('Anuncio eliminado'); cargar(); }
      catch (e) { toast(e.message); }
    });
  };
  if (esAdmin) $('#anNew').onclick = () => {
    openModal(`<h3>Nuevo anuncio</h3>
      <div class="field"><label>Título</label><input id="anT" placeholder="Ej: Cierre del pañol el viernes"></div>
      <div class="field"><label>Contenido</label><textarea id="anC" rows="4" style="padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;font-family:inherit"></textarea></div>
      <div class="err" id="anErr"></div><button class="btn full" id="anOk">Publicar</button>`);
    $('#anOk').onclick = async () => {
      $('#anErr').textContent = '';
      try { await api('/admin/anuncios', { method: 'POST', body: { titulo: $('#anT').value.trim(), cuerpo: $('#anC').value.trim() } }); closeModal(); toast('Anuncio publicado'); cargar(); }
      catch (e) { $('#anErr').textContent = e.message; }
    };
  };
  cargar();
}

// ===================== Mis asignaturas (alumno/docente) =====================
async function viewAsignaturas() {
  h(`<h2 class="page">Mis asignaturas</h2>
    <p class="muted">Entra a una asignatura para ver sus tareas y sus compañeros.</p>
    <div id="asList"><p class="muted">Cargando…</p></div>`);
  let rows;
  try { rows = await api('/mis-asignaturas'); }
  catch (e) { $('#asList').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; return; }
  if (!rows.length) { $('#asList').innerHTML = '<p class="muted">No estás inscrito en asignaturas. Contacta al administrador o al pañol.</p>'; return; }
  $('#asList').innerHTML = rows.map((a, i) => {
    const cats = (a.categorias || []).length
      ? a.categorias.map(c => `<span class="pill info" style="margin:2px 4px 2px 0;display:inline-block">${escD(c)}</span>`).join('')
      : '<span class="muted" style="font-size:12.5px">Sin categorías habilitadas aún</span>';
    const rol = a.rol_en_asig === 'docente' ? 'Docente' : 'Alumno';
    return `<div class="card asItem" data-i="${i}" style="margin-bottom:12px;cursor:pointer">
      <div style="display:flex;gap:8px;align-items:start">
        <div style="flex:1"><b style="font-size:15px">${escD(a.nombre)}</b>
          <div class="muted" style="font-size:12.5px">${escD(a.carrera || '')}${a.seccion ? ' · Sección ' + escD(a.seccion) : ''}</div></div>
        <span class="pill ${a.rol_en_asig === 'docente' ? 'warn' : 'ok'}">${rol}</span>
      </div>
      <div style="margin-top:10px"><span class="muted" style="font-size:12px;font-weight:600">Equipos habilitados:</span><br>${cats}</div>
      <div style="margin-top:10px;text-align:right"><span class="pill ok">Ver tareas y compañeros →</span></div>
    </div>`;
  }).join('');
  $('#asList').querySelectorAll('.asItem').forEach(el => el.onclick = () => asignaturaDetalle(rows[el.dataset.i]));
}

async function asignaturaDetalle(a) {
  h(`<button class="btn sm ghost" id="asBack" style="margin-bottom:12px">← Mis asignaturas</button>
    <h2 class="page" style="margin-top:4px">${escD(a.nombre)}</h2>
    <p class="muted" style="margin:-8px 0 8px">${escD(a.carrera || '')}${a.seccion ? ' · Sección ' + escD(a.seccion) : ''}</p>
    <div style="margin-bottom:16px">${(a.categorias || []).map(c => `<span class="pill info" style="margin:2px 4px 2px 0;display:inline-block">${escD(c)}</span>`).join('')}</div>
    <div class="dash-grid">
      <div class="panel"><h3>📝 Tareas de la asignatura</h3><div id="asTar" class="muted">Cargando…</div></div>
      <div class="panel"><h3>🧑‍🤝‍🧑 Compañeros</h3><div id="asComp" class="muted">Cargando…</div></div>
    </div>`);
  $('#asBack').onclick = () => viewAsignaturas();
  try {
    const ts = await api('/asignaturas/' + a.id + '/tareas');
    $('#asTar').innerHTML = ts.length
      ? ts.map(t => `<div class="row tItem" data-id="${t.id}" style="margin-bottom:6px;cursor:pointer"><div class="ava">📝</div>
          <div class="info"><b>${escD(t.titulo)}</b><small>${escD(t.tipo)} · ${fmtDate(t.fecha_inicio)} → ${fmtDate(t.fecha_fin)}</small></div>
          <span class="pill ok">ver</span></div>`).join('')
      : '<p class="muted">Sin tareas vigentes en esta asignatura.</p>';
    $('#asTar').querySelectorAll('.tItem').forEach(el => el.onclick = () => tareaDetalle(el.dataset.id));
  } catch (e) { $('#asTar').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  try {
    const cs = await api('/asignaturas/' + a.id + '/companeros');
    $('#asComp').innerHTML = cs.length
      ? cs.map(c => `<div class="row" style="margin-bottom:6px"><div class="ava">${c.rol_en_asig === 'docente' ? '🧑‍🏫' : '🎓'}</div>
          <div class="info"><b>${escD(c.nombre)}</b><small>${c.rol_en_asig === 'docente' ? 'Docente' : 'Alumno'}</small></div></div>`).join('')
      : '<p class="muted">No hay otros inscritos en esta asignatura.</p>';
  } catch (e) { $('#asComp').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
}

// ===================== Compañeros inscritos (alumno/docente) =====================
async function viewCompaneros() {
  h(`<h2 class="page">Compañeros inscritos</h2>
    <p class="muted">Personas inscritas en tus mismas asignaturas.</p>
    <div id="coList"><p class="muted">Cargando…</p></div>`);
  const rows = await api('/companeros');
  if (!rows.length) { $('#coList').innerHTML = '<p class="muted">No hay compañeros en tus asignaturas.</p>'; return; }
  const porAsig = {};
  rows.forEach(r => { const k = r.asignatura + (r.seccion ? ' · ' + r.seccion : ''); (porAsig[k] = porAsig[k] || []).push(r); });
  $('#coList').innerHTML = Object.entries(porAsig).map(([asig, gente]) => `<div class="panel" style="margin-bottom:12px">
    <h3>${escD(asig)} <span class="muted" style="font-weight:400">(${gente.length})</span></h3>
    ${gente.map(g => `<div class="row" style="margin-bottom:6px"><div class="ava">${g.rol === 'docente' ? '🧑‍🏫' : '🎓'}</div>
      <div class="info"><b>${escD(g.nombre)}</b><small>${g.rol === 'docente' ? 'Docente' : 'Alumno'}</small></div></div>`).join('')}
  </div>`).join('');
}

// ===================== Multisede: gestión de sedes (admin) =====================
async function viewSedes() {
  h(`<h2 class="page">Sedes</h2>
    <p class="muted">Administra las sedes (instituciones/campus). Cambia la sede activa desde el selector de la barra superior para gestionar sus datos.</p>
    <button class="btn" id="seNew" style="margin-bottom:14px">+ Nueva sede</button>
    <div id="seList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const s = await api('/sedes');
    const sedes = s.sedes || [];
    $('#seList').innerHTML = sedes.map(x => `<div class="row"><div class="ava">🏫</div>
      <div class="info"><b>${escD(x.nombre)}</b><small>Pañol: ${escD(x.bodega_label || 'Pañol')}${x.activo === false ? ' · inactiva' : ''}${x.id === SEDE ? ' · <b>activa</b>' : ''}</small></div>
      <button class="btn sm ghost" data-ed="${x.id}" data-n="${escD(x.nombre)}" data-b="${escD(x.bodega_label || '')}" data-a="${x.activo !== false}">Editar</button></div>`).join('');
    $('#seList').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(b.dataset.ed, b.dataset.n, b.dataset.b, b.dataset.a === 'true'));
  };
  function form(id, nombre, bodega, activo) {
    openModal(`<h3>${id ? 'Editar' : 'Nueva'} sede</h3>
      <div class="field"><label>Nombre</label><input id="seN" value="${id ? escD(nombre) : ''}" placeholder="UST Santiago Centro"></div>
      <div class="field"><label>Cómo se llama el pañol/bodega</label><input id="seB" value="${id ? escD(bodega) : 'Pañol'}" placeholder="Pañol"></div>
      ${id ? `<div class="toggle"><input type="checkbox" id="seA" ${activo ? 'checked' : ''}><label for="seA" style="margin:0">Sede activa</label></div>` : ''}
      <div class="err" id="seErr"></div><button class="btn full" id="seOk">Guardar</button>`);
    $('#seOk').onclick = async () => {
      $('#seErr').textContent = '';
      const body = { nombre: $('#seN').value.trim(), bodega_label: $('#seB').value.trim() };
      if (id) body.activo = $('#seA').checked;
      try {
        await api('/admin/sedes' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
        closeModal(); toast('Sede guardada'); await buildSedeSelector(); cargar();
      } catch (e) { $('#seErr').textContent = e.message; }
    };
  }
  $('#seNew').onclick = () => form(null);
  cargar();
}

// ===================== Respaldos (admin) =====================
async function viewRespaldos() {
  h(`<h2 class="page">Respaldos</h2>
    <p class="muted">Descarga un respaldo de los datos de tu sede activa en un archivo Excel (equipos, usuarios y reservas).</p>
    <div class="card" style="max-width:460px">
      <p style="margin-top:0;font-size:13.5px">El archivo incluye una hoja por cada conjunto de datos. Guárdalo en un lugar seguro.</p>
      <div class="aviso info">Supabase mantiene además respaldos automáticos de la base completa. Este export es para uso operativo y auditoría.</div>
      <button class="btn full" id="rsBtn">⬇ Descargar respaldo (.xlsx)</button>
      <div class="err" id="rsErr"></div>
    </div>`);
  $('#rsBtn').onclick = async () => {
    $('#rsErr').textContent = '';
    try {
      const res = await fetch('/api/admin/respaldo', { headers: { ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(SEDE ? { 'X-Sede-Id': String(SEDE) } : {}) } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error al generar respaldo'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `respaldo_prestalo_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('Respaldo descargado');
    } catch (e) { $('#rsErr').textContent = e.message; }
  };
}

// ===================== Manuales / Ayuda (estático) =====================
function viewManuales() {
  const rol = ME.user.rol;
  const secciones = [
    ['🔑 Ingreso', 'Puedes iniciar sesión con tu RUT o tu correo institucional. El sistema te lleva automáticamente al menú de tu perfil (alumno, docente, pañolero o administrador).'],
    ['📅 Reservar un equipo', 'En Catálogo elige el equipo y pulsa Reservar. Declara el uso académico, elige fecha de inicio y término, y agrega integrantes si es grupal. Los recintos requieren 72 h de anticipación y autorización.'],
    ['🗓️ Disponibilidad', 'Antes de reservar, revisa en Disponibilidad los periodos ya ocupados del equipo y el horario de atención del pañol.'],
    ['⏰ Devoluciones y sanciones', 'Devuelve dentro del plazo. La devolución tardía o el no-show generan sanciones que bloquean nuevas reservas hasta su término.'],
    ['🙋 Solicitudes especiales', 'Si necesitas algo fuera de lo habilitado para tu asignatura, envía una Solicitud al docente desde el menú Solicitudes.'],
  ];
  const adminExtra = [
    ['🏫 Multisede', 'Como administrador puedes cambiar la sede activa desde el selector de la barra superior. Todo lo que gestiones (equipos, usuarios, reservas) corresponde a la sede seleccionada.'],
    ['📈 Reportes y respaldos', 'En Reportes generas y exportas datos a Excel/PDF. En Respaldos descargas un respaldo operativo de tu sede.'],
    ['📢 Anuncios', 'Publica avisos para los usuarios de la sede desde el menú Anuncios.'],
  ];
  const lista = rol === 'admin' ? secciones.concat(adminExtra) : secciones;
  h(`<h2 class="page">Ayuda y manuales</h2>
    <p class="muted">Guía rápida de uso de Préstalo.</p>
    <div style="display:flex;flex-direction:column;gap:10px;max-width:720px">
      ${lista.map(([t, d]) => `<div class="card"><h3 style="margin:0 0 6px">${t}</h3><p style="margin:0;font-size:13.5px;line-height:1.5">${d}</p></div>`).join('')}
    </div>
    <p class="muted" style="margin-top:16px;font-size:12.5px">¿Dudas que no están aquí? Acércate al pañol o contacta al administrador del sistema.</p>`);
}

// ===================== Ficha completa del equipo =====================
async function fichaEquipo(id) {
  openModal('<h3>Ficha del equipo</h3><p class="muted">Cargando…</p>');
  try {
    const e = await api('/equipos/' + id);
    const [lab, cls] = ESTADO_EQ[e.estado] || [e.estado, 'info'];
    const row = (k, v) => v ? `<tr><td class="k" style="color:var(--muted);width:40%">${k}</td><td>${escD(v)}</td></tr>` : '';
    let html = `<h3>${escD(e.nombre)}</h3>
      <p style="margin:2px 0 10px"><span class="pill ${cls}">${lab}</span>${e.requiere_autorizacion ? ' <span class="pill warn">Requiere autorización</span>' : ''}</p>
      <table style="box-shadow:none"><tbody>
        ${row('Código QR', e.codigo_qr)}${row('Categoría', e.categoria)}${row('Marca', e.marca)}${row('Modelo', e.modelo)}
        ${row('N° de serie', e.n_serie)}${row('Tipo', e.tipo)}${row('Condición', e.condicion)}
        ${row('Laboratorio', e.laboratorio)}${row('Accesorios', e.accesorios)}
      </tbody></table>`;
    if (ME.user.rol === 'admin' || ME.user.rol === 'panolero') {
      html += '<div id="fHist" class="muted" style="margin-top:12px">Cargando historial…</div>';
    }
    $('#modalRoot .modal').innerHTML = `<button class="close">×</button>${html}`;
    $('#modalRoot .close').onclick = closeModal;
    if (ME.user.rol === 'admin' || ME.user.rol === 'panolero') {
      const hist = await api('/equipos/' + id + '/historial');
      const pr = hist.prestamos.length
        ? hist.prestamos.map(p => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(p.usuario || '—')}</b><small>${p.fecha_salida ? fmtDate(p.fecha_salida) : ''}${p.fecha_retorno ? ' → ' + fmtDate(p.fecha_retorno) : ''} · ${escD(p.estado)}</small></div></div>`).join('')
        : '<p class="muted">Sin préstamos registrados.</p>';
      const mt = hist.mantenciones.length
        ? hist.mantenciones.map(m => `<div class="row" style="margin-bottom:6px"><div class="info"><b>${escD(m.tipo)}</b><small>${m.fecha ? fmtDate(m.fecha) : ''}${m.detalle ? ' · ' + escD(m.detalle) : ''}</small></div></div>`).join('')
        : '<p class="muted">Sin mantenciones registradas.</p>';
      $('#fHist').innerHTML = `<h4 style="margin:4px 0 6px;font-size:13px">Últimos préstamos</h4>${pr}
        <h4 style="margin:12px 0 6px;font-size:13px">Mantenciones</h4>${mt}`;
    }
  } catch (e) { $('#modalRoot .modal').innerHTML = `<button class="close" onclick="closeModal()">×</button><div class="aviso bad">${escD(e.message)}</div>`; $('#modalRoot .close').onclick = closeModal; }
}

// ===================== Bloqueo de horarios (admin/pañolero) =====================
async function viewBloqueos() {
  h(`<h2 class="page">Bloqueo de horarios</h2>
    <p class="muted">Define periodos en que un equipo (o todos) no puede reservarse: mantención, feriados, eventos.</p>
    <button class="btn" id="blNew" style="margin-bottom:14px">+ Nuevo bloqueo</button>
    <div id="blList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const data = await api('/admin/bloqueos');
    if (data && data._pendiente_migracion) { $('#blList').innerHTML = '<div class="aviso warn">Falta correr la migración <b>05</b> en Supabase para activar los bloqueos.</div>'; return; }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) { $('#blList').innerHTML = '<p class="muted">No hay bloqueos vigentes.</p>'; return; }
    $('#blList').innerHTML = rows.map(b => `<div class="row"><div class="ava">🚫</div>
      <div class="info"><b>${escD(b.equipo || 'Todos los equipos')}</b><small>${fmtDate(b.fecha_inicio)} → ${fmtDate(b.fecha_fin)} · ${escD(b.motivo)}</small></div>
      <button class="btn sm ghost danger" data-del="${b.id}">Quitar</button></div>`).join('');
    $('#blList').querySelectorAll('[data-del]').forEach(x => x.onclick = async () => {
      try { await api('/admin/bloqueos/' + x.dataset.del, { method: 'DELETE' }); toast('Bloqueo eliminado'); cargar(); }
      catch (e) { toast(e.message); }
    });
  };
  $('#blNew').onclick = async () => {
    const eq = await api('/equipos');
    openModal(`<h3>Nuevo bloqueo</h3>
      <div class="field"><label>Equipo</label><select id="blEq"><option value="">— Todos los equipos —</option>
        ${eq.map(e => `<option value="${e.id}">${escD(e.nombre)} · ${escD(e.codigo_qr)}</option>`).join('')}</select></div>
      <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>Desde</label><input type="datetime-local" id="blIni"></div>
      <div class="field" style="flex:1"><label>Hasta</label><input type="datetime-local" id="blFin"></div></div>
      <div class="field"><label>Motivo</label><input id="blMot" placeholder="Mantención programada"></div>
      <div class="err" id="blErr"></div><button class="btn full" id="blOk">Crear bloqueo</button>`);
    const now = new Date();
    $('#blIni').value = dtLocal(now.toISOString());
    $('#blFin').value = dtLocal(new Date(now.getTime() + 3 * 3600000).toISOString());
    $('#blOk').onclick = async () => {
      $('#blErr').textContent = '';
      try {
        await api('/admin/bloqueos', { method: 'POST', body: {
          equipo_id: $('#blEq').value ? Number($('#blEq').value) : null,
          fecha_inicio: new Date($('#blIni').value).toISOString(),
          fecha_fin: new Date($('#blFin').value).toISOString(),
          motivo: $('#blMot').value.trim(),
        }});
        closeModal(); toast('Bloqueo creado'); cargar();
      } catch (e) { $('#blErr').textContent = e.message; }
    };
  };
  cargar();
}

// ===================== Aprobación de grupos (docente/admin) =====================
async function viewGrupos() {
  h(`<h2 class="page">Aprobación de grupos</h2>
    <p class="muted">Reservas grupales pendientes de validar la composición del grupo.</p>
    <div id="grList"><p class="muted">Cargando…</p></div>`);
  const cargar = async () => {
    const rows = await api('/grupos/pendientes');
    if (!rows.length) { $('#grList').innerHTML = '<p class="muted">No hay grupos pendientes de aprobación.</p>'; return; }
    $('#grList').innerHTML = rows.map(g => `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${escD(g.equipo)}</b><small class="muted">${fmtDate(g.fecha_inicio)} → ${fmtDate(g.fecha_fin)}</small></div>
      <p style="font-size:13px;margin:6px 0 4px">Solicitante: ${escD(g.solicitante)} (${escD(g.rut)})</p>
      <p style="font-size:12px;margin:0 0 8px" class="muted">Integrantes: ${g.integrantes.map(i => escD(i.nombre) + (i.es_responsable ? ' (resp.)' : '')).join(', ') || '—'}</p>
      <div style="display:flex;gap:8px"><button class="btn sm ap" data-id="${g.id}">Aprobar grupo</button><button class="btn sm ghost danger rc" data-id="${g.id}">Rechazar</button></div>
    </div>`).join('');
    const resolver = async (id, estado) => {
      try { await api('/grupos/' + id + '/aprobar', { method: 'POST', body: { estado } }); toast(estado === 'aprobado' ? 'Grupo aprobado' : 'Grupo rechazado'); cargar(); }
      catch (e) { toast(e.message); }
    };
    $('#grList').querySelectorAll('.ap').forEach(b => b.onclick = () => resolver(b.dataset.id, 'aprobado'));
    $('#grList').querySelectorAll('.rc').forEach(b => b.onclick = () => resolver(b.dataset.id, 'rechazado'));
  };
  cargar();
}

// ===================== Reportes (admin): Excel / PDF =====================
const REPORTES = { reservas: 'Reservas por periodo', equipos: 'Equipos más solicitados', inventario: 'Inventario de equipos' };
async function viewReportes() {
  h(`<h2 class="page">Reportes</h2>
    <p class="muted">Genera reportes de gestión y expórtalos a Excel o PDF.</p>
    <div class="card" style="margin-bottom:14px">
      <div class="field"><label>Tipo de reporte</label><select id="rpTipo">${Object.entries(REPORTES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap" id="rpFechas">
        <div class="field" style="flex:1;min-width:140px"><label>Desde</label><input type="date" id="rpDesde"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Hasta</label><input type="date" id="rpHasta"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="rpVer" style="flex:1">Ver</button>
        <button class="btn ghost" id="rpXlsx">⬇ Excel</button>
        <button class="btn ghost" id="rpPdf">⬇ PDF</button>
      </div>
    </div>
    <div id="rpRes"></div>`);
  const hoy = new Date(), hace30 = new Date(hoy.getTime() - 30 * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  $('#rpDesde').value = iso(hace30); $('#rpHasta').value = iso(hoy);
  const qs = () => `?tipo=${$('#rpTipo').value}&desde=${$('#rpDesde').value}&hasta=${$('#rpHasta').value}`;
  const toggleFechas = () => { $('#rpFechas').style.display = $('#rpTipo').value === 'inventario' ? 'none' : 'flex'; };
  $('#rpTipo').onchange = toggleFechas; toggleFechas();
  let ultimo = null;
  const ver = async () => {
    $('#rpRes').innerHTML = '<p class="muted">Generando…</p>';
    try {
      const d = await api('/admin/reportes' + qs());
      ultimo = d;
      if (!d.filas.length) { $('#rpRes').innerHTML = `<h3>${escD(d.titulo)}</h3><p class="muted">Sin datos para el periodo.</p>`; return; }
      $('#rpRes').innerHTML = `<h3 style="margin-bottom:8px">${escD(d.titulo)} <span class="muted" style="font-size:13px;font-weight:400">(${d.filas.length})</span></h3>
        <table><thead><tr>${d.columnas.map(c => `<th>${escD(c)}</th>`).join('')}</tr></thead>
        <tbody>${d.filas.map(f => `<tr>${f.map(v => `<td>${escD(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } catch (e) { $('#rpRes').innerHTML = `<div class="aviso bad">${escD(e.message)}</div>`; }
  };
  $('#rpVer').onclick = ver;
  $('#rpTipo').addEventListener('change', ver);
  $('#rpXlsx').onclick = async () => {
    try {
      const res = await fetch('/api/admin/reportes/xlsx' + qs(), { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Error al exportar'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `reporte_${$('#rpTipo').value}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast(e.message); }
  };
  $('#rpPdf').onclick = async () => {
    if (!ultimo) await ver();
    if (!ultimo || !ultimo.filas.length) { toast('Primero genera un reporte con datos'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Permite ventanas emergentes para exportar PDF'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escD(ultimo.titulo)}</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#152230;margin:28px}
      h1{color:#0E8F86;font-size:18px;margin:0 0 2px}.s{color:#6B7785;font-size:11px;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E4E8ED}
      th{background:#EFF2F7}</style></head><body>
      <h1>Préstalo · ${escD(ultimo.titulo)}</h1><p class="s">Universidad Santo Tomás — ${new Date().toLocaleString('es-CL')}</p>
      <table><thead><tr>${ultimo.columnas.map(c => `<th>${escD(c)}</th>`).join('')}</tr></thead>
      <tbody>${ultimo.filas.map(f => `<tr>${f.map(v => `<td>${escD(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  ver();
}

// ---------- Modal utils ----------
function openModal(html) {
  $('#modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><button class="close">×</button>${html}</div></div>`;
  $('#modalRoot .close').onclick = closeModal;
  $('#modalRoot .modal-bg').onclick = e => { if (e.target.classList.contains('modal-bg')) closeModal(); };
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

// ---------- Arranque ----------
if (TOKEN) boot().catch(() => { TOKEN = null; localStorage.removeItem('prestalo_token'); });
