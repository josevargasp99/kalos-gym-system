/* ------------------------------------------------------------
 *  PAGOS DE COACH
 *  De cada pago: el socio del espacio recibe X %, el resto es del gimnasio; de ese resto el coach recibe Y %
 *  y el gimnasio el resto. Porcentajes editables en la hoja Config: PCT_PARTNER, PCT_COACH (valores de ejemplo: 40 y 80).
 *  Se le paga cada lunes lo cobrado de lunes a domingo de la semana anterior (según la fecha de registro del pago).
 * ------------------------------------------------------------ */
const HOJA_PAGOS_COACH = 'Pagos Coach';

function r2_(x) { return Math.round(x * 100) / 100; }

function pctPagos_() {
  const c = leerConfig_();
  const leer = (k, def) => { const v = Number(String(c[k] || '').replace(',', '.')); return (c[k] !== undefined && c[k] !== '' && isFinite(v) && v >= 0 && v <= 100) ? v : def; };
  const b = leer('PCT_PARTNER', 40), i = leer('PCT_COACH', 80);
  return { partner: b, coach: i, coachPago: r2_((100 - b) * i / 100), kalosPago: r2_((100 - b) * (100 - i) / 100) };
}

function repartoPago_(monto, p) {
  const kal = r2_(monto * (100 - p.partner) / 100);
  const coach = r2_(kal * p.coach / 100);
  return { partner: r2_(monto - kal), coach: coach, kalos: r2_(kal - coach) };
}

function sumarDias_(iso, n) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return Utilities.formatDate(new Date(t), 'UTC', 'yyyy-MM-dd');
}
function lunesDe_(iso) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return sumarDias_(iso, -((new Date(t).getUTCDay() + 6) % 7));
}
function ddmm_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function ddmmyyyy_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
function esLunesIso_(x) { return /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) && lunesDe_(String(x)) === String(x); }

// Pagos de los alumnos de un instructor (sin PRUEBA/STAFF ni pagos de 0 Bs)
function pagosDeCoach_(coachNombre) {
  const ss = SpreadsheetApp.getActive();
  const hA = ss.getSheetByName(CFG.HOJA_ALUMNOS);
  const col = mapaColumnas_(hA);
  const alum = {};
  const ultA = hA.getLastRow();
  (ultA >= 2 ? hA.getRange(2, 1, ultA - 1, hA.getLastColumn()).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    if (id) alum[id] = { instr: instructorDe_(r[col['Instructor']]), excl: esPrueba_(r[col['Notas internas']]) };
  });
  const hR = asegurarHojaRenovaciones_();
  const ultR = hR.getLastRow();
  const quien = instructorDe_(coachNombre), pct = pctPagos_(), out = [];
  (ultR >= 2 ? hR.getRange(2, 1, ultR - 1, 10).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[0]);
    if (!id || !alum[id] || alum[id].excl || !(r[3] instanceof Date)) return;
    const monto = Number(r[7]) || 0;
    if (monto <= 0) return;
    const instr = String(r[9] || '').trim() ? instructorDe_(r[9]) : alum[id].instr;
    if (instr !== quien) return;
    const fecha = Utilities.formatDate(r[3], CFG.TZ, 'yyyy-MM-dd');
    out.push({ id: id, nombre: String(r[1] || '').trim(), plan: String(r[6] || '').trim(), monto: monto, fecha: fecha, semana: lunesDe_(fecha), rep: repartoPago_(monto, pct) });
  });
  out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return out;
}

function asegurarHojaPagosIan_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_PAGOS_COACH);
  if (h) return h;
  h = ss.insertSheet(HOJA_PAGOS_COACH);
  h.getRange(1, 1, 1, 4).setValues([['Semana (lunes)', 'Monto liquidado (Bs)', 'Pagado el', 'Nota']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:A').setNumberFormat('@');
  h.getRange('B2:B').setNumberFormat('#,##0.00');
  h.getRange('C2:D').setNumberFormat('@');
  [130, 160, 110, 260].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Pagos a Coach: los escribe el panel').setWarningOnly(true);
  return h;
}

function leerLiquidaciones_() {
  const h = asegurarHojaPagosIan_();
  const ult = h.getLastRow(), out = {};
  (ult >= 2 ? h.getRange(2, 1, ult - 1, 3).getValues() : []).forEach((r, i) => {
    const sem = fechaTxt_(r[0]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sem)) out[sem] = { monto: Number(r[1]) || 0, fecha: r[2] instanceof Date ? Utilities.formatDate(r[2], CFG.TZ, 'dd/MM/yyyy') : String(r[2] || '').trim(), fila: i + 2 };
  });
  return out;
}

function resumenSemanaIan_(pagos, liq, semana) {
  const items = pagos.filter((p) => p.semana === semana);
  let total = 0, cobrado = 0;
  items.forEach((p) => { total += p.rep.coach; cobrado += p.monto; });
  total = r2_(total); cobrado = r2_(cobrado);
  const l = liq[semana] || null;
  let estado = 'vacio', dif = 0;
  if (l) { if (l.monto + 0.005 >= total) estado = 'pagado'; else { estado = 'parcial'; dif = r2_(total - l.monto); } }
  else if (items.length) estado = 'pendiente';
  return {
    semana: semana, desde: ddmm_(semana), hasta: ddmm_(sumarDias_(semana, 6)), total: total, cobrado: cobrado, n: items.length,
    estado: estado, diferencia: dif, liquidado: l ? { monto: l.monto, fecha: l.fecha } : null,
    items: items.map((p) => ({ id: p.id, nombre: p.nombre, fecha: ddmm_(p.fecha), plan: p.plan, monto: p.monto, coach: p.rep.coach }))
  };
}

// Panel de Coach: una semana (lunes a domingo). Por defecto, la semana pasada (la que se le paga hoy).
function coachPagos_(coach, semanaIn) {
  const hoy = isoHoy_(), semActual = lunesDe_(hoy), semPasada = sumarDias_(semActual, -7);
  let sem = esLunesIso_(semanaIn) ? String(semanaIn) : semPasada;
  if (sem > semActual) sem = semActual;
  const pagos = pagosDeCoach_(coach.nombre), liq = leerLiquidaciones_();
  let primera = semActual;
  pagos.forEach((p) => { if (p.semana < primera) primera = p.semana; });
  const r = resumenSemanaIan_(pagos, liq, sem);
  r.items = r.items.map((x) => ({ nombre: x.nombre, fecha: x.fecha, plan: x.plan, monto: x.monto, coach: x.coach }));
  const act = resumenSemanaIan_(pagos, liq, semActual);
  let pendiente = 0;
  const semanas = {}; pagos.forEach((p) => { semanas[p.semana] = true; });
  Object.keys(semanas).forEach((w) => {
    if (w >= semActual) return;
    const x = resumenSemanaIan_(pagos, liq, w);
    if (x.estado === 'pendiente') pendiente += x.total; else if (x.estado === 'parcial') pendiente += x.diferencia;
  });
  return {
    ok: true, coach: coach.nombre, semana: r, esActual: sem === semActual, esPasada: sem === semPasada,
    actual: { desde: act.desde, hasta: act.hasta, total: act.total, n: act.n },
    previa: sumarDias_(sem, -7), siguiente: sumarDias_(sem, 7), hayAnterior: sem > primera, haySiguiente: sem < semActual,
    pendiente: r2_(pendiente)
  };
}

// Panel del dueño: todas las semanas con pagos de Coach
function panelPagosCoach() {
  verificarDueno_();
  const hoy = isoHoy_(), semActual = lunesDe_(hoy);
  const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_();
  const set = {}; pagos.forEach((p) => { set[p.semana] = true; }); Object.keys(liq).forEach((w) => { set[w] = true; });
  const lista = Object.keys(set).sort().reverse().slice(0, 30).map((w) => {
    const r = resumenSemanaIan_(pagos, liq, w);
    r.abierta = w >= semActual;
    return r;
  });
  let pendiente = 0;
  lista.forEach((r) => { if (r.abierta) return; if (r.estado === 'pendiente') pendiente += r.total; else if (r.estado === 'parcial') pendiente += r.diferencia; });
  const pct = pctPagos_();
  return { ok: true, semanas: lista, pendiente: r2_(pendiente), pct: { partner: pct.partner, coach: pct.coachPago, kalos: pct.kalosPago } };
}

function panelPagarCoach(semana) {
  verificarDueno_();
  if (!esLunesIso_(semana)) return { ok: false, error: 'semana' };
  const hoy = isoHoy_();
  if (String(semana) >= lunesDe_(hoy)) return { ok: false, error: 'abierta' };       // la semana aún no terminó
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_();
    const r = resumenSemanaIan_(pagos, liq, String(semana));
    if (r.total <= 0) return { ok: false, error: 'vacio' };
    const h = asegurarHojaPagosIan_();
    const fila = liq[semana] ? liq[semana].fila : h.getLastRow() + 1;
    h.getRange(fila, 1, 1, 4).setNumberFormats([['@', '#,##0.00', '@', '@']])
      .setValues([[String(semana), r.total, ddmmyyyy_(hoy), 'Marcado en el panel']]);
    return { ok: true, semana: resumenSemanaIan_(pagos, leerLiquidaciones_(), String(semana)) };
  } finally { lock.releaseLock(); }
}

function panelDeshacerPagoCoach(semana) {
  verificarDueno_();
  if (!esLunesIso_(semana)) return { ok: false, error: 'semana' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const liq = leerLiquidaciones_();
    if (!liq[semana]) return { ok: false, error: 'nopagado' };
    asegurarHojaPagosIan_().deleteRow(liq[semana].fila);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Resumen del mes para "Números": reparto de lo cobrado a alumnos de Coach
function repartoMesIan_(mes) {
  const pagos = pagosDeCoach_('Coach'), liq = leerLiquidaciones_(), pct = pctPagos_();
  const estSem = {};
  const o = { n: 0, cobrado: 0, partner: 0, coach: 0, kalos: 0, liquidado: 0, pendiente: 0, pct: { partner: pct.partner, coach: pct.coachPago, kalos: pct.kalosPago } };
  pagos.forEach((p) => {
    if (p.fecha.slice(0, 7) !== mes) return;
    if (!estSem[p.semana]) estSem[p.semana] = resumenSemanaIan_(pagos, liq, p.semana).estado;
    o.n++; o.cobrado += p.monto; o.partner += p.rep.partner; o.coach += p.rep.coach; o.kalos += p.rep.kalos;
    if (estSem[p.semana] === 'pagado') o.liquidado += p.rep.coach; else o.pendiente += p.rep.coach;
  });
  ['cobrado', 'partner', 'coach', 'kalos', 'liquidado', 'pendiente'].forEach((k) => { o[k] = r2_(o[k]); });
  return o;
}
