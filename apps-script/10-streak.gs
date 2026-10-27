/* ------------------------------------------------------------
 *  RACHA (estilo Duolingo)
 *  - Solo cuentan los días hábiles (lunes a viernes, sin feriados); sábado y domingo no suman ni rompen.
 *  - Plan "3 veces por semana": se mantiene si va 3 días hábiles por semana (los que quiera).
 *  - Mensual / Trimestral / otros: tiene que ir todos los días hábiles.
 *  - Se cuenta desde la primera visita registrada con el QR de la puerta.
 *  - Penitencia: la restaura el administrador desde su panel hasta 3 días hábiles después de perderla; máximo 1 por semana.
 * ------------------------------------------------------------ */
const HOJA_RACHAS = 'Rachas';
const FERIADOS_DEFECTO = ['2026-11-02', '2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'];
const RACHA_PLAZO_HABILES = 3;

function rcAdd_(iso, n) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10); }
function rcDow_(iso) { return (new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay() + 6) % 7; }   // 0 = lunes
function rcLunes_(iso) { return rcAdd_(iso, -rcDow_(iso)); }
function rcHabil_(iso, fer) { return rcDow_(iso) < 5 && !fer[iso]; }
function rcSumarHabiles_(iso, n, fer) { let d = iso, c = 0; while (c < n) { d = rcAdd_(d, 1); if (rcHabil_(d, fer)) c++; } return d; }

function feriados_() {
  const set = {};
  String(leerConfig_().FERIADOS || '').split(/[,\s;]+/).forEach((x) => { if (/^\d{4}-\d{2}-\d{2}$/.test(x)) set[x] = true; });
  if (!Object.keys(set).length) FERIADOS_DEFECTO.forEach((x) => { set[x] = true; });
  return set;
}

// Núcleo puro (sin hojas): o = { modo: 'diario'|'3x', visitas: {iso:true}, restauraciones: [{desde, hasta, creada}], hoy, fer }
function calcularRacha_(o) {
  const fer = o.fer, hoy = o.hoy;
  const vis = {};
  Object.keys(o.visitas).forEach((f) => { if (f <= hoy && rcHabil_(f, fer)) vis[f] = true; });
  const dias = Object.keys(vis).sort();
  const lunHoy = rcLunes_(hoy);
  const L = ['L', 'M', 'Mi', 'J', 'V'];
  const semDias = L.map((l, k) => {
    const d = rcAdd_(lunHoy, k);
    return { l: l, e: fer[d] ? 'feriado' : vis[d] ? 'ok' : d === hoy ? 'hoy' : d > hoy ? 'futuro' : 'falta' };
  });
  const res = { modo: o.modo, racha: 0, record: 0, estado: 'nueva', inicio: dias[0] || '', perdida: null, restaurable: null, bloqueada: false,
    semana: { visitas: 0, necesita: o.modo === '3x' ? 3 : 0, faltan: 0, hoyToca: false, dias: semDias } };
  if (!dias.length) return res;

  const cubierto = (d) => o.restauraciones.some((r) => r.desde <= d && d <= r.hasta);
  const cubiertaSem = (lun) => o.restauraciones.some((r) => r.desde <= rcAdd_(lun, 6) && r.hasta >= lun);
  const inicio = dias[0];
  let run = 0, record = 0;
  const quiebres = [];
  const anotar = () => { if (run > record) record = run; };

  if (o.modo === 'diario') {
    for (let d = inicio; d < hoy; d = rcAdd_(d, 1)) {
      if (!rcHabil_(d, fer)) continue;
      if (vis[d]) { run++; anotar(); }
      else if (!cubierto(d) && run > 0) { quiebres.push({ fecha: d, prev: run }); run = 0; }
    }
    if (vis[hoy]) { run++; anotar(); }
    let v = 0; semDias.forEach((x) => { if (x.e === 'ok') v++; });
    res.semana.visitas = v;
    res.semana.hoyToca = rcHabil_(hoy, fer) && !vis[hoy];
  } else {
    for (let lun = rcLunes_(inicio); lun <= hoy; lun = rcAdd_(lun, 7)) {
      const ds = [];
      for (let k = 0; k < 5; k++) { const d = rcAdd_(lun, k); if (d >= inicio && rcHabil_(d, fer)) ds.push(d); }
      if (!ds.length) continue;
      const need = Math.min(3, ds.length);
      const actual = lun === lunHoy;
      let v = 0, quiebre = null;
      ds.forEach((d, i) => {
        if (d > hoy) return;
        if (vis[d]) v++;
        if (quiebre) return;
        const abierto = (d === hoy && !vis[d]) ? 1 : 0;
        if (v + abierto + (ds.length - 1 - i) < need) quiebre = d;
      });
      if (actual) {
        res.semana.visitas = v; res.semana.necesita = need; res.semana.faltan = Math.max(0, need - v);
        const restantes = ds.filter((d) => d >= hoy && !(d === hoy && vis[d])).length;
        res.semana.hoyToca = rcHabil_(hoy, fer) && !vis[hoy] && v < need && (need - v) >= restantes;
        if (quiebre && !cubiertaSem(lun)) { if (run > 0) quiebres.push({ fecha: quiebre, prev: run }); run = 0; }
        else { run += v; anotar(); }
      } else if (v >= need || cubiertaSem(lun)) { run += v; anotar(); }
      else { if (run > 0) quiebres.push({ fecha: quiebre || ds[ds.length - 1], prev: run }); run = 0; }
    }
  }

  res.racha = run; res.record = record;
  const q = quiebres.length ? quiebres[quiebres.length - 1] : null;
  if (q) {
    res.perdida = { dias: q.prev, fecha: q.fecha };
    const limite = rcSumarHabiles_(q.fecha, RACHA_PLAZO_HABILES, fer);
    res.limite = limite;
    if (hoy <= limite) {
      const usada = o.restauraciones.some((r) => r.creada >= lunHoy && r.creada <= rcAdd_(lunHoy, 6));
      if (usada) res.bloqueada = true; else res.restaurable = { desde: q.fecha, limite: limite, prev: q.prev };
    }
  }
  if (run === 0) res.estado = q ? 'perdida' : 'nueva';
  else if (res.semana.hoyToca && (o.modo === 'diario' ? true : res.semana.faltan > 0)) res.estado = 'riesgo';
  else res.estado = 'activa';
  return res;
}

function modoRacha_(plan) { return /3\s*(veces|x)/i.test(String(plan || '')) ? '3x' : 'diario'; }

function asegurarHojaRachas_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_RACHAS);
  if (h) return h;
  h = ss.insertSheet(HOJA_RACHAS);
  h.getRange(1, 1, 1, 7).setValues([['ID', 'Nombre', 'Desde', 'Hasta', 'Restaurada el', 'Racha restaurada (días)', 'Nota']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:G').setNumberFormat('@');
  [110, 200, 100, 100, 110, 160, 260].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Rachas restauradas: las escribe el panel').setWarningOnly(true);
  return h;
}

function leerRestauraciones_(id) {
  const h = asegurarHojaRachas_();
  const ult = h.getLastRow(), out = [];
  (ult >= 2 ? h.getRange(2, 1, ult - 1, 5).getValues() : []).forEach((r) => {
    if (normalizarId_(r[0]) !== id) return;
    const f = (v) => fechaTxt_(v);
    out.push({ desde: f(r[2]), hasta: f(r[3]), creada: f(r[4]) });
  });
  return out;
}

function visitasDe_(id) {
  const hoja = asegurarHojaAsistencia_();
  const ult = hoja.getLastRow(), set = {};
  if (ult >= 2) hoja.getRange(2, 1, ult - 1, 3).getValues().forEach((r) => {
    if (normalizarId_(r[2]) === id) { const f = fechaTxt_(r[0]); if (/^\d{4}-\d{2}-\d{2}$/.test(f)) set[f] = true; }
  });
  return set;
}

function rachaDeAlumno_(id, plan) {
  try {
    return calcularRacha_({ modo: modoRacha_(plan), visitas: visitasDe_(id), restauraciones: leerRestauraciones_(id), hoy: isoHoy_(), fer: feriados_() });
  } catch (e) { return null; }
}

// El administrador restaura la racha después de que el alumno cumple su penitencia
function panelRestaurarRacha(idEntrada, nota) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  if (!/^KAL-[A-Z0-9]{6}$/.test(id)) return { ok: false, error: 'alumno' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(hoja);
    const fila = hoja.getRange(celda.getRow(), 1, 1, hoja.getLastColumn()).getValues()[0];
    const nombre = String(fila[col['Nombre']] || '').trim(), plan = String(fila[col['Plan']] || '');
    const hoy = isoHoy_();
    const r = calcularRacha_({ modo: modoRacha_(plan), visitas: visitasDe_(id), restauraciones: leerRestauraciones_(id), hoy: hoy, fer: feriados_() });
    if (!r.restaurable) return { ok: false, error: r.bloqueada ? 'semana' : (r.perdida ? 'plazo' : 'sinperdida') };
    const h = asegurarHojaRachas_();
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);
    h.getRange(h.getLastRow() + 1, 1, 1, 7).setNumberFormat('@')
      .setValues([[id, seguro(nombre), r.restaurable.desde, hoy, hoy, r.restaurable.prev, seguro(limpiarTexto_(nota || 'Penitencia cumplida', 200))]]);
    try { CacheService.getScriptCache().remove('al:' + id); } catch (e) {}
    return { ok: true, racha: rachaDeAlumno_(id, plan) };
  } finally { lock.releaseLock(); }
}
