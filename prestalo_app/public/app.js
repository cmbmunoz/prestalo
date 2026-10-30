// ===================== Préstalo — Frontend SPA =====================
let TOKEN = localStorage.getItem('prestalo_token') || null;
let ME = null;                 // {user, asignaturas}
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
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
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
  alumno:   [['catalogo','📚','Catálogo'],['reservas','📅','Mis reservas'],['whatsapp','💬','Consultas'],['perfil','👤','Mi perfil']],
  docente:  [['catalogo','📚','Catálogo'],['reservas','📅','Mis reservas'],['whatsapp','💬','Consultas'],['perfil','👤','Mi perfil']],
  panolero: [['agenda','📋','Agenda / Entregas'],['recibir','📥','Recibir'],['whatsapp','💬','Consultas'],['perfil','👤','Mi perfil']],
  admin:    [['kpis','📊','Panel'],['inventario','🧰','Inventario'],['mantenciones','🔧','Mantenciones'],
             ['importar','📥','Importar Excel'],['autoriz','✅','Autorizaciones'],
             ['sanciones','⛔','Sanciones'],['usuarios','👥','Usuarios'],['academico','🎓','Académico'],['perfil','👤','Mi perfil']],
};
function buildNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  MENUS[ME.user.rol].forEach(([k, ic, label], i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="ic">${ic}</span>${label}`;
    b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); render(k); };
    if (i === 0) b.classList.add('active');
    nav.appendChild(b);
  });
}

// ---------- Boot ----------
async function boot() {
  ME = await api('/me');
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoName').textContent = ME.user.nombre;
  $('#whoRole').textContent = ({alumno:'Alumno',docente:'Docente',panolero:'Pañolero',admin:'Administrador'})[ME.user.rol];
  buildNav();
  render(MENUS[ME.user.rol][0][0]);
}

// ===================== Vistas =====================
const view = () => $('#view');
function h(html) { view().innerHTML = html; }

async function render(key) {
  try {
    if (key === 'catalogo')   return viewCatalogo();
    if (key === 'reservas')   return viewReservas();
    if (key === 'whatsapp')   return viewWhatsapp();
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
      <button class="btn sm full" ${e.estado !== 'disponible' ? 'disabled style="opacity:.5"' : ''} data-id="${e.id}">Reservar</button>
    </div>`;
  }).join('');
  $('#cat').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => modalReserva(b.dataset.id));
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

// ----- WhatsApp -----
function viewWhatsapp() {
  h(`<h2 class="page">Consultas por WhatsApp</h2>
     <p class="muted">Canal de autoatención. El chatbot responde con los datos de Préstalo y la normativa; si no resuelve, deriva a una persona.</p>
     <div class="card" style="max-width:520px">
       <div id="chat" style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto;margin-bottom:10px"></div>
       <div style="display:flex;gap:8px">
         <input id="waMsg" placeholder="Escribe tu consulta…" style="flex:1;padding:11px;border:1px solid var(--line);border-radius:10px;font-family:inherit">
         <button class="btn" id="waSend">Enviar</button>
       </div>
       <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
         ${['¿Qué equipos hay disponibles?','Estado de mis reservas','¿Tengo sanciones?','¿Cómo reservo un recinto?']
           .map(q=>`<button class="btn sm ghost waq">${q}</button>`).join('')}
       </div>
     </div>`);
  const chat = $('#chat');
  const bubble = (txt, mine, estado) => {
    const d = document.createElement('div');
    d.style.cssText = `max-width:80%;padding:9px 12px;border-radius:12px;font-size:13px;white-space:pre-line;${
      mine ? 'align-self:flex-end;background:var(--brand);color:#fff' : 'align-self:flex-start;background:var(--chip);color:var(--ink)'}`;
    d.textContent = txt;
    if (!mine && estado === 'derivada') { d.style.background = '#FFF7E6'; d.style.color = 'var(--warn)'; }
    chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
  };
  const send = async (consulta) => {
    if (!consulta) return; bubble(consulta, true); $('#waMsg').value = '';
    try { const r = await api('/whatsapp', { method:'POST', body:{ consulta } }); bubble(r.respuesta, false, r.estado); }
    catch (e) { bubble('Error: ' + e.message, false, 'derivada'); }
  };
  $('#waSend').onclick = () => send($('#waMsg').value.trim());
  $('#waMsg').addEventListener('keydown', e => { if (e.key === 'Enter') send($('#waMsg').value.trim()); });
  view().querySelectorAll('.waq').forEach(b => b.onclick = () => send(b.textContent));
  bubble('Hola 👋 Soy el asistente de Préstalo. Pregúntame por disponibilidad, tus reservas, sanciones, cómo reservar, recintos u horarios.', false);
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
  h(`<h2 class="page">Panel estratégico</h2>
     <p class="muted" style="margin:-8px 0 14px;font-size:13px">Visión general de préstamos, inventario y alertas para decidir rápido.</p>
     <div id="dash" class="muted">Cargando…</div>`);
  let d;
  try { d = await api('/admin/dashboard'); }
  catch (e) { $('#dash').innerHTML = '<div class="aviso bad">No se pudo cargar el panel.</div>'; return; }
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

// ---------- Modal utils ----------
function openModal(html) {
  $('#modalRoot').innerHTML = `<div class="modal-bg"><div class="modal"><button class="close">×</button>${html}</div></div>`;
  $('#modalRoot .close').onclick = closeModal;
  $('#modalRoot .modal-bg').onclick = e => { if (e.target.classList.contains('modal-bg')) closeModal(); };
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

// ---------- Arranque ----------
if (TOKEN) boot().catch(() => { TOKEN = null; localStorage.removeItem('prestalo_token'); });
