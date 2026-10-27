/* ------------------------------------------------------------
 *  PANEL PRIVADO (solo el dueño del script)
 *  Doble candado: la implementación "Solo yo" de Google + esta verificación en cada acción.
 *  Hoja "Renovaciones": ID | Nombre | Teléfono | Fecha | Fecha de inicio | Fecha fin | Plan | Monto pagado (Bs)
 * ---------------------------------------------------------- */
function verificarDueno_() {
  const activo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const dueno = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!activo || !dueno || activo !== dueno) throw new Error('No autorizado');
}

// Toda función pública (sin "_") se puede invocar desde el navegador con google.script.run.
// Las de administración exigen que quien llama sea el dueño del script.
function soloDueno_() { verificarDueno_(); }

// Los envíos masivos solo corren desde un disparador horario real (trae e.triggerUid) o si los lanza el dueño a mano.
function soloDuenoOAlarma_(e) {
  if (e && e.triggerUid) return;
  verificarDueno_();
}

function esDueno_() {
  try { verificarDueno_(); return true; } catch (e) { return false; }
}

function normTexto_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function isoHoy_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
}

// Mediodía de Bolivia en ese día: la fecha se guarda correcta en cualquier zona horaria
function fechaDia_(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
}

// 1 mes menos 1 día: 10/09 → 09/10 · 20/12 → 19/01 · si el mes siguiente no tiene ese día (31/01) → último día del mes (28/02)
function finDePlan_(y, m, d, meses) {
  const n = meses || 1;
  let ny = y + Math.floor((m - 1 + n) / 12), nm = ((m - 1 + n) % 12) + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  if (d > ultimo) return { y: ny, m: nm, d: ultimo };
  const t = new Date(Date.UTC(ny, nm - 1, d - 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function panelBuscar(q) {
  verificarDueno_();
  const texto = normTexto_(q);
  const dig = String(q || '').replace(/\D/g, '');
  if (texto.length < 2 && dig.length < 3) return [];

  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const hoy = isoHoy_();
  const out = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    const tel = telNormal_(r[col['Teléfono']]);
    const coincide = (texto.length >= 2 && normTexto_(nombre).indexOf(texto) > -1) ||
                     (dig.length >= 3 && tel.indexOf(dig) > -1);
    if (!coincide || out.length >= 8) return;
    const fin = r[col['Fecha fin']];
    const est = calcularEstado_(r[col['Fecha inicio']], fin);
    let sugerido = hoy;                                             // vencido o sin fecha → hoy
    if (fin instanceof Date) {
      const f = Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd');
      if (f >= hoy) {                                               // a tiempo → día siguiente al vencimiento
        const t = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + 1));
        sugerido = Utilities.formatDate(t, 'UTC', 'yyyy-MM-dd');
      }
    }
    out.push({
      id: id, nombre: nombre, tel: tel, plan: String(r[col['Plan']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias, fin: fmtFecha_(fin), sugerido: sugerido, bono: sugerido !== hoy,
      precio: precios_().antiguo[String(r[col['Plan']] || '').trim()] || ''
    });
  });
  return out;
}

/**
 * CONTROL DE INSCRIPCIONES
 * 1) Renuevan esta semana (lunes a domingo, hora de Bolivia)
 * 2) No renovaron: venció en los últimos 10 días (y no está en la lista 1)
 * 3) Activos que no vienen: 5 o más días hábiles (lun–vie) sin escanear la puerta
 */
function panelControl() {
  verificarDueno_();
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MIN_HABILES = 5, VENTANA_DIAS = 10;
  const num = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;   // día entero
  const dow = (n) => new Date(n * 86400000).getUTCDay();
  const fmt = (n) => Utilities.formatDate(new Date(n * 86400000), 'UTC', 'dd/MM');
  const etiqueta = (n) => DIAS[dow(n)] + ' ' + fmt(n);

  const hoyIso = isoHoy_();
  const hoy = num(hoyIso);
  const lunes = hoy - ((dow(hoy) + 6) % 7);
  const domingo = lunes + 6;
  const desdeQr = num(CFG.ASISTENCIA_DESDE);

  // Última visita de cada alumno según el QR de la puerta
  const ultima = {};
  const hAs = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ASISTENCIA);
  if (hAs && hAs.getLastRow() >= 2) {
    hAs.getRange(2, 1, hAs.getLastRow() - 1, 3).getValues().forEach((r) => {
      const f = fechaTxt_(r[0]), id = normalizarId_(r[2]);
      if (id && /^\d{4}-\d{2}-\d{2}$/.test(f) && (!ultima[id] || f > ultima[id])) ultima[id] = f;
    });
  }

  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const l1 = [], l2 = [], l3 = [];

  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    const fin = r[col['Fecha fin']], ini = r[col['Fecha inicio']];
    if (!id || !nombre || !(fin instanceof Date) || esPrueba_(r[col['Notas internas']])) return;
    const finN = num(Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd'));
    const base = { id: id, nombre: nombre, plan: String(r[col['Plan']] || '').trim(), tel: telNormal_(r[col['Teléfono']]) };

    if (finN >= lunes && finN <= domingo) {
      const venc = finN < hoy;
      l1.push(Object.assign({ orden: finN, rojo: venc,
        detalle: venc ? 'Venció ' + etiqueta(finN) : (finN === hoy ? 'Vence hoy' : 'Vence ' + etiqueta(finN)) }, base));
    } else if (finN < lunes && hoy - finN <= VENTANA_DIAS) {
      const hace = hoy - finN;
      const uv = ultima[id] ? ' · última visita ' + fmt(num(ultima[id])) : '';
      l2.push(Object.assign({ orden: -finN, rojo: true,
        detalle: 'Venció hace ' + hace + (hace === 1 ? ' día' : ' días') + ' (' + fmt(finN) + ')' + uv }, base));
    }

    // Activo: plan vigente hoy
    const iniN = ini instanceof Date ? num(Utilities.formatDate(ini, CFG.TZ, 'yyyy-MM-dd')) : null;
    if (finN >= hoy && (iniN === null || iniN <= hoy)) {
      const baseN = ultima[id] ? num(ultima[id]) : Math.max(iniN === null ? desdeQr : iniN, desdeQr);
      let habiles = 0;
      for (let d = baseN + 1; d < hoy; d++) { const w = dow(d); if (w !== 0 && w !== 6) habiles++; }
      if (habiles >= MIN_HABILES) {
        l3.push(Object.assign({ orden: -habiles, rojo: false,
          detalle: habiles + ' días hábiles sin venir · ' + (ultima[id] ? 'última visita ' + etiqueta(num(ultima[id])) : 'sin visitas registradas') }, base));
      }
    }
  });

  const ordenar = (l) => l.sort((a, b) => a.orden - b.orden).map((x) => { delete x.orden; return x; });
  return { hoy: fmt(hoy), semana: fmt(lunes) + ' – ' + fmt(domingo), l1: ordenar(l1), l2: ordenar(l2), l3: ordenar(l3) };
}

// Alumnos de prueba / instructores: su nota interna EMPIEZA con "PRUEBA" y no cuentan en ninguna cifra
function esStaff_(notas) {
  return /^\s*staff\b/i.test(String(notas || ''));       // equipo de Kalos: tiene tarjeta pero no cuenta en ninguna cifra
}
function esPrueba_(notas) {
  if (esStaff_(notas)) return true;                        // STAFF se excluye de las cifras igual que PRUEBA
  return /^\s*prueba\b/i.test(String(notas || ''));      // solo si la nota EMPIEZA con PRUEBA ("clase de prueba" no cuenta)
}

// Precios de la pestaña Config (con valores por defecto si faltan)
function precios_() {
  const c = leerConfig_();
  const n = (k, d) => { const v = Number(String(c[k] || '').replace(',', '.')); return v > 0 ? v : d; };
  return {
    nuevo: { 'Mensual': n('PRECIO_NUEVO_MENSUAL', 100), '3 veces por semana': n('PRECIO_NUEVO_3X', 80) },
    antiguo: { 'Mensual': n('PRECIO_ANTIGUO_MENSUAL', 90), '3 veces por semana': n('PRECIO_ANTIGUO_3X', 70) }
  };
}

/**
 * NÚMEROS DEL MES
 * mesIso: 'yyyy-MM' (vacío = mes actual). Gracia de renovación: 10 días (igual que Control).
 */
function panelNumeros(mesIso) {
  verificarDueno_();
  const GRACIA = 10;
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const num = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  const isoDe = (d) => Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
  const nDate = (d) => (d instanceof Date ? num(isoDe(d)) : null);
  const fmt = (n) => Utilities.formatDate(new Date(n * 86400000), 'UTC', 'dd/MM');
  const hoyIso = isoHoy_(), hoy = num(hoyIso), mesActual = hoyIso.slice(0, 7);
  let mes = /^\d{4}-\d{2}$/.test(String(mesIso || '')) ? String(mesIso) : mesActual;
  if (mes > mesActual) mes = mesActual;
  const rango = (m) => {
    const y = +m.slice(0, 4), mo = +m.slice(5, 7);
    return { ini: Date.UTC(y, mo - 1, 1) / 86400000, fin: Date.UTC(y, mo, 0) / 86400000, nombre: MESES[mo - 1] + ' ' + y };
  };
  const mover = (m, k) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; const t = new Date(Date.UTC(y, mo, 1)); return Utilities.formatDate(t, 'UTC', 'yyyy-MM'); };
  const R = rango(mes), anterior = mover(mes, -1), RA = rango(anterior);
  const ref = (rg) => Math.min(rg.fin, hoy);                     // día de referencia: hoy o cierre del mes

  // ---- Alumnos (sin PRUEBA)
  const ss = SpreadsheetApp.getActive();
  const hA = ss.getSheetByName(CFG.HOJA_ALUMNOS);
  const col = mapaColumnas_(hA);
  const ultA = hA.getLastRow();
  const alumnos = {}, prueba = {};
  (ultA >= 2 ? hA.getRange(2, 1, ultA - 1, hA.getLastColumn()).getValues() : []).forEach((r) => {
    const id = normalizarId_(r[col['ID']]), nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (esPrueba_(r[col['Notas internas']])) { prueba[id] = true; return; }
    alumnos[id] = {
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]), plan: String(r[col['Plan']] || '').trim(),
      horario: String(r[col['Horario']] || '').trim() || 'Sin horario', instructor: String(r[col['Instructor']] || '').trim() || 'Sin instructor',
      ini: nDate(r[col['Fecha inicio']]), fin: nDate(r[col['Fecha fin']])
    };
  });

  // ---- Pagos y periodos (Renovaciones + periodo actual de Alumnos)
  const pagos = [];
  const periodos = {};                                            // id -> [{ini, fin}]
  const agregarPeriodo = (id, ini, fin) => {
    if (ini === null || fin === null) return;
    const l = periodos[id] = periodos[id] || [];
    if (!l.some((p) => p.ini === ini && p.fin === fin)) l.push({ ini: ini, fin: fin });
  };
  const hR = ss.getSheetByName(CFG.HOJA_RENOVACIONES);
  if (hR && hR.getLastRow() >= 2) {
    hR.getRange(2, 1, hR.getLastRow() - 1, 9).getValues().forEach((p) => {
      const id = normalizarId_(p[0]);
      if (!id || prueba[id]) return;
      const f = nDate(p[3]);
      if (f === null) return;
      pagos.push({ id: id, fecha: f, plan: String(p[6] || '').trim() || 'Sin plan', monto: Number(p[7]) || 0, tipo: String(p[8] || '').trim() === 'Inscripción' ? 'alta' : 'renov' });
      agregarPeriodo(id, nDate(p[4]), nDate(p[5]));
    });
  }
  Object.keys(alumnos).forEach((id) => agregarPeriodo(id, alumnos[id].ini, alumnos[id].fin));

  const enMes = (n, rg) => n >= rg.ini && n <= rg.fin;
  const resumenPagos = (rg) => {
    const out = { ingresos: 0, altas: 0, renov: 0, porPlan: {} };
    pagos.forEach((p) => {
      if (!enMes(p.fecha, rg)) return;
      out.ingresos += p.monto;
      if (p.tipo === 'alta') out.altas++; else out.renov++;
      out.porPlan[p.plan] = (out.porPlan[p.plan] || 0) + p.monto;
    });
    out.ingresos = Math.round(out.ingresos * 100) / 100;
    return out;
  };
  const activosEn = (dia) => {
    const ids = Object.keys(periodos).concat(Object.keys(alumnos).filter((id) => !periodos[id]));
    return ids.filter((id) => (periodos[id] || []).some((p) => p.ini <= dia && dia <= p.fin) ||
      (dia === hoy && alumnos[id] && alumnos[id].fin !== null && alumnos[id].fin >= hoy));
  };

  const act = resumenPagos(R), ant = resumenPagos(RA);
  const coachMes = repartoMesIan_(mes);
  const activosHoy = activosEn(ref(R)), activosAnt = activosEn(ref(RA));

  // ---- Tasa de renovación: periodos que terminaron en el mes
  let vencieron = 0, renovaron = 0, enPlazo = 0;
  const noVolvieron = [];
  Object.keys(periodos).forEach((id) => {
    const l = periodos[id];
    l.forEach((p) => {
      if (!enMes(p.fin, R) || p.fin >= hoy) return;               // aún no vence
      const siguio = l.some((q) => q !== p && q.ini > p.ini && q.ini <= p.fin + 1 + GRACIA);
      if (siguio) { vencieron++; renovaron++; return; }
      if (hoy <= p.fin + GRACIA) { enPlazo++; return; }           // todavía puede renovar
      vencieron++;
      const a = alumnos[id];
      const despues = l.filter((q) => q.ini > p.fin + 1 + GRACIA).sort((x, y) => x.ini - y.ini)[0];
      noVolvieron.push({ id: id, nombre: a ? a.nombre : id, tel: a ? a.tel : '', fin: fmt(p.fin), volvio: despues ? fmt(despues.ini) : '' });
    });
  });

  // ---- Asistencia (QR de la puerta)
  const visitas = {}, porDia = [0, 0, 0, 0, 0, 0, 0], porHora = {};
  const hAs = ss.getSheetByName(CFG.HOJA_ASISTENCIA);
  if (hAs && hAs.getLastRow() >= 2) {
    hAs.getRange(2, 1, hAs.getLastRow() - 1, 3).getValues().forEach((r) => {
      const f = fechaTxt_(r[0]), id = normalizarId_(r[2]);
      if (!id || prueba[id] || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
      const n = num(f);
      if (!enMes(n, R)) return;
      const k = id + '|' + f;
      if (visitas[k]) return;
      visitas[k] = true;
      porDia[(new Date(n * 86400000).getUTCDay() + 6) % 7]++;   // 0 = lunes
      const hTxt = r[1] instanceof Date ? Utilities.formatDate(r[1], CFG.TZ, 'HH') : String(r[1] || '').slice(0, 2);
      if (/^\d{2}$/.test(hTxt)) porHora[hTxt] = (porHora[hTxt] || 0) + 1;
    });
  }
  const totalVisitas = Object.keys(visitas).length;

  // ---- Ocupación (alumnos activos por horario e instructor)
  const porHorario = {}, porInstructor = {};
  activosHoy.forEach((id) => {
    const a = alumnos[id];
    if (!a) return;
    porHorario[a.horario] = (porHorario[a.horario] || 0) + 1;
    porInstructor[a.instructor] = (porInstructor[a.instructor] || 0) + 1;
  });

  // ---- Tendencia: últimos 6 meses
  const tendencia = [];
  for (let k = 5; k >= 0; k--) {
    const m = mover(mes, -k), rg = rango(m);
    tendencia.push({ mes: MESES[+m.slice(5, 7) - 1].slice(0, 3), ingresos: resumenPagos(rg).ingresos });
  }

  const lista = (o) => Object.keys(o).map((k) => ({ k: k, v: o[k] })).sort((a, b) => b.v - a.v);
  let primerMes = mesActual;
  pagos.forEach((p) => { const m = Utilities.formatDate(new Date(p.fecha * 86400000), 'UTC', 'yyyy-MM'); if (m < primerMes) primerMes = m; });

  return {
    mes: mes, nombre: R.nombre, anterior: RA.nombre, esActual: mes === mesActual,
    hayAnterior: mes > primerMes, haySiguiente: mes < mesActual,
    previo: anterior, siguiente: mover(mes, 1),
    ingresos: act.ingresos, ingresosAnt: ant.ingresos,
    altas: act.altas, altasAnt: ant.altas,
    renov: act.renov, renovAnt: ant.renov,
    activos: activosHoy.length, activosAnt: activosAnt.length,
    tasa: { vencieron: vencieron, renovaron: renovaron, enPlazo: enPlazo, noVolvieron: noVolvieron },
    porPlan: lista(act.porPlan), tendencia: tendencia,
    asistencia: { visitas: totalVisitas, promedio: activosHoy.length ? Math.round(totalVisitas / activosHoy.length * 10) / 10 : 0, porDia: porDia,
      porHora: Object.keys(porHora).sort().map((h) => ({ k: h + ':00', v: porHora[h] })) },
    porHorario: lista(porHorario), porInstructor: lista(porInstructor),
    coach: coachMes,
    kalos: {
      ingresos: act.ingresos,
      otros: r2_(act.ingresos - coachMes.cobrado),
      deCoach: coachMes.kalos,
      partner: coachMes.partner,
      coach: coachMes.coach,
      total: r2_(act.ingresos - coachMes.partner - coachMes.coach),
      pct: coachMes.pct
    },
    fisio: fisioMes_(mes),
    avisos: resumenAvisos_()
  };
}

/**
 * ALUMNOS: lista liviana de todos los inscritos (la ficha completa se pide aparte)
 */
function panelAlumnos() {
  verificarDueno_();
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const lista = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    const fin = r[col['Fecha fin']];
    const est = calcularEstado_(r[col['Fecha inicio']], fin);
    const grupo = esStaff_(r[col['Notas internas']]) ? 'staff'
      : esPrueba_(r[col['Notas internas']]) ? 'prueba'
      : est.estado === 'ACTIVO' ? 'activo'
      : (est.estado === 'POR VENCER' || est.estado === 'VENCE HOY') ? 'porvencer'
      : est.estado === 'VENCIDO' ? 'vencido' : 'otro';
    lista.push({
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]),
      plan: String(r[col['Plan']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias, grupo: grupo, fin: fmtFecha_(fin), prueba: grupo === 'prueba' || grupo === 'staff'
    });
  });
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return { alumnos: lista };
}

/**
 * Ficha completa de un alumno: datos, asistencia, pagos, logros y notas
 */
function panelFicha(idEntrada) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  if (!/^KAL-[A-Z0-9]{6}$/.test(id)) return { ok: false, error: 'alumno' };
  const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
  const col = mapaColumnas_(alumnos);
  const r = alumnos.getRange(celda.getRow(), 1, 1, alumnos.getLastColumn()).getValues()[0];
  const txt = (n) => String(r[col[n]] || '').trim();
  const fin = r[col['Fecha fin']], ini = r[col['Fecha inicio']];
  const est = calcularEstado_(ini, fin);
  const hoy = isoHoy_();

  let sugerido = hoy;
  if (fin instanceof Date) {
    const f = Utilities.formatDate(fin, CFG.TZ, 'yyyy-MM-dd');
    if (f >= hoy) sugerido = Utilities.formatDate(new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + 1)), 'UTC', 'yyyy-MM-dd');
  }

  // Asistencia
  const as = resumenAsistencia_(id);
  const ultimaVisita = as.dias.length ? as.dias[as.dias.length - 1] : '';

  // Pagos (hoja Renovaciones)
  const pagos = [];
  let totalPagado = 0;
  const hRen = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_RENOVACIONES);
  if (hRen && hRen.getLastRow() >= 2) {
    hRen.getRange(2, 1, hRen.getLastRow() - 1, 9).getValues().forEach((p) => {
      if (normalizarId_(p[0]) !== id) return;
      const monto = Number(p[7]) || 0;
      totalPagado += monto;
      pagos.push({ fecha: fmtFecha_(p[3]), inicio: fmtFecha_(p[4]), fin: fmtFecha_(p[5]), plan: String(p[6] || '').trim(), monto: monto, tipo: String(p[8] || '').trim() });
    });
    pagos.reverse();
  }

  // Logros
  let logros = { actual: 0, total: 0, metas: [] };
  const hLog = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_LOGROS);
  if (hLog) {
    const e = estadoLogros_(leerLogros_(hLog, id));
    const ultima = e.rondas.length ? e.rondas[e.rondas.length - 1] : null;
    logros = { actual: e.actual, total: e.total, metas: ultima ? ultima.metas.map((m) => ({ texto: m.texto, hecho: m.hecho })) : [] };
  }

  // Rutinas cargadas por el instructor (solo alumnos de instructores con panel)
  let rutina = { aplica: false, dias: [0, 0, 0, 0, 0], fechas: ['', '', '', '', ''] };
  if (COACHES[instructorDe_(txt('Instructor'))]) {
    const hRut = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_RUTINAS);
    const rd = hRut ? diasDe_(leerRutinas_(hRut), id) : { dias: [[], [], [], [], []], fechas: ['', '', '', '', ''] };
    rutina = { aplica: true, dias: rd.dias.map((x) => x.length), fechas: rd.fechas };
  }

  // Enlace a la tarjeta (la misma que ve el alumno)
  let tarjeta = '';
  try {
    const u = urlVerificacion_(leerConfig_(), id);
    if (/^https:\/\//.test(u)) tarjeta = u;
  } catch (e) { tarjeta = ''; }

  return {
    ok: true,
    id: id,
    nombre: txt('Nombre'),
    tel: telNormal_(r[col['Teléfono']]),
    plan: txt('Plan'),
    horario: txt('Horario'),
    instructor: txt('Instructor'),
    inicio: fmtFecha_(ini),
    fin: fmtFecha_(fin),
    estado: est.estado,
    textoDias: est.textoDias,
    progreso: est.progreso,
    sugerido: sugerido, bono: sugerido !== hoy,
    precio: precios_().antiguo[txt('Plan')] || '',
    notas: txt('Notas internas'),
    asistencia: { anio: as.anio, hoy: as.hoy, dias: as.dias, mes: as.mes, total: as.total, racha: as.racha, ultima: ultimaVisita },
    pagos: pagos,
    totalPagado: totalPagado,
    logros: logros,
    rutina: rutina,
    racha: rachaDeAlumno_(id, txt('Plan')),
    tarjeta: tarjeta
  };
}

// Guarda las notas internas del alumno (siempre como texto, nunca como fórmula)
function panelNotas(idEntrada, texto) {
  verificarDueno_();
  const id = normalizarId_(idEntrada);
  const limpio = String(texto == null ? '' : texto).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (limpio.length > 1000) return { ok: false, error: 'largo' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(alumnos);
    alumnos.getRange(celda.getRow(), col['Notas internas'] + 1).setNumberFormat('@').setValue(limpio);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * NUEVO ALUMNO: opciones para el formulario (horarios e instructores que ya usas)
 */
function panelNuevoOpciones() {
  verificarDueno_();
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja.getLastRow();
  const col = mapaColumnas_(hoja);
  const vals = ult >= 2 ? hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues() : [];
  const uniq = (nombre) => {
    const vistos = {}, out = [];
    vals.forEach((r) => {
      const t = String(r[col[nombre]] || '').trim();
      const k = normTexto_(t);
      if (t && !vistos[k]) { vistos[k] = true; out.push(t); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'es'));
  };
  return { hoy: isoHoy_(), horarios: uniq('Horario'), instructores: uniq('Instructor'), precios: precios_().nuevo };
}

// Nombres "parecidos": iguales, o todas las palabras del más corto están en el más largo (mín. 2 palabras)
function nombresParecidos_(a, b) {
  const ta = normTexto_(a).split(/\s+/).filter(String), tb = normTexto_(b).split(/\s+/).filter(String);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return corto.length >= 2 && corto.every((w) => largo.indexOf(w) > -1);
}

function limpiarTexto_(t, max) {
  return String(t == null ? '' : t).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim().slice(0, max);
}

/**
 * Inscribe a un alumno nuevo: fila en Alumnos + primer pago en Renovaciones (Tipo = Inscripción) + tarjeta PDF
 */
function panelNuevo(d) {
  verificarDueno_();
  d = d || {};
  const nombre = limpiarTexto_(d.nombre, 80);
  const esStaffNuevo = esStaff_(limpiarTexto_(d.notas, 1000));                 // equipo de Kalos: nombre corto, 0 Bs, sin vencimiento
  const esPruebaNuevo = d.prueba === true && !esStaffNuevo;                    // usuario de prueba: sin pago, dura N días
  let motivo = '', diasPrueba = 0;
  if (esPruebaNuevo) {
    motivo = limpiarTexto_(d.motivo, 40);
    if (motivo.length < 2) return { ok: false, error: 'motivo' };
    diasPrueba = Math.floor(Number(d.dias));
    if (!(diasPrueba >= 1 && diasPrueba <= 365)) return { ok: false, error: 'dias' };
  }
  if (nombre.length < 3 || (!esStaffNuevo && !esPruebaNuevo && nombre.split(' ').length < 2)) return { ok: false, error: 'nombre' };
  const tel = telNormal_(d.tel);
  if (!/^\d{8}$/.test(tel)) return { ok: false, error: 'tel' };

  const PLANES = { 'Mensual': 1, '3 veces por semana': 1 };
  let plan, meses = 1, finManual = null;
  if (d.plan === 'Otro') {
    plan = limpiarTexto_(d.planOtro, 40);
    if (plan.length < 2) return { ok: false, error: 'plan' };
    const mf = esPruebaNuevo ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.inicio || '')) : /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.fin || ''));      // plan especial: la fecha fin la pones tú
    if (!mf) return { ok: false, error: 'finfecha' };
    const cf = new Date(Date.UTC(+mf[1], +mf[2] - 1, +mf[3]));
    if (cf.getUTCFullYear() !== +mf[1] || cf.getUTCMonth() !== +mf[2] - 1 || cf.getUTCDate() !== +mf[3]) return { ok: false, error: 'finfecha' };
    finManual = { y: +mf[1], m: +mf[2], d: +mf[3], t: cf.getTime() };
  } else if (PLANES[d.plan]) {
    plan = d.plan; meses = 1;
  } else {
    return { ok: false, error: 'plan' };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.inicio || ''));
  if (!m) return { ok: false, error: 'fecha' };
  const y = +m[1], mo = +m[2], da = +m[3];
  const chk = new Date(Date.UTC(y, mo - 1, da));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return { ok: false, error: 'fecha' };
  const h = isoHoy_();
  const hoyMs = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
  if (Math.abs(chk.getTime() - hoyMs) > 366 * 86400000) return { ok: false, error: 'fecha' };
  if (finManual && (finManual.t < chk.getTime() || finManual.t - chk.getTime() > 3 * 366 * 86400000)) return { ok: false, error: 'finrango' };
  const monto = esPruebaNuevo ? 0 : Math.round(Number(d.monto) * 100) / 100;
  if (!isFinite(monto) || monto < 0 || (monto === 0 && !esStaffNuevo && !esPruebaNuevo) || monto > 100000) return { ok: false, error: 'monto' };

  const horario = limpiarTexto_(d.horario, 40), instructor = limpiarTexto_(d.instructor, 40);
  const notasLibres = limpiarTexto_(d.notas, 1000);
  const notas = esPruebaNuevo ? ('PRUEBA · ' + motivo + (notasLibres ? ' — ' + notasLibres : '')) : notasLibres;   // la marca PRUEBA excluye de cifras

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  let id, fila, dInicio, dFin;
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const col = mapaColumnas_(alumnos);
    const max = alumnos.getMaxRows();
    const n = Math.max(1, max - 1);
    const ids = alumnos.getRange(2, col['ID'] + 1, n, 1).getValues();
    const nombres = alumnos.getRange(2, col['Nombre'] + 1, n, 1).getValues();
    const tels = alumnos.getRange(2, col['Teléfono'] + 1, n, 1).getValues();

    // 1) Celular repetido: la puerta identifica por celular, no puede haber dos iguales
    for (let i = 0; i < n; i++) {
      if (nombres[i][0] && telNormal_(tels[i][0]) === tel) return { ok: false, error: 'telrepetido', nombre: String(nombres[i][0]).trim() };
    }
    // 2) Nombre parecido: probablemente es un exalumno que vuelve
    if (d.forzar !== true) {
      for (let i = 0; i < n; i++) {
        if (nombres[i][0] && nombresParecidos_(nombres[i][0], nombre)) {
          return { ok: false, error: 'parecido', nombre: String(nombres[i][0]).trim(), id: normalizarId_(ids[i][0]) };
        }
      }
    }

    // Primera fila libre (no usamos getLastRow: las fórmulas de Estado llegan hasta el final de la hoja)
    fila = 0;
    for (let i = 0; i < n; i++) { if (!ids[i][0] && !nombres[i][0]) { fila = i + 2; break; } }
    if (!fila) { alumnos.insertRowAfter(max); fila = max + 1; }

    const existentes = new Set(ids.map((x) => normalizarId_(x[0])));
    do {
      id = CFG.PREFIJO_ID;
      for (let i = 0; i < CFG.LARGO_ID; i++) id += CFG.ALFABETO_ID.charAt(Math.floor(Math.random() * CFG.ALFABETO_ID.length));
    } while (existentes.has(id));

    let f = esStaffNuevo ? { y: 2099, m: 12, d: 31 } : finManual ? { y: finManual.y, m: finManual.m, d: finManual.d } : finDePlan_(y, mo, da, meses);
    if (esPruebaNuevo) { const t = new Date(Date.UTC(y, mo - 1, da + diasPrueba - 1)); f = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }   // N días contando el de inicio
    dInicio = fechaDia_(y, mo, da); dFin = fechaDia_(f.y, f.m, f.d);
    const dHoy = fechaDia_(+h.slice(0, 4), +h.slice(5, 7), +h.slice(8, 10));

    // 3) Alumnos (solo las columnas de datos: Estado y Días restantes se calculan solos)
    const reg = (nombreCol, valor, fmt) => {
      const c = alumnos.getRange(fila, col[nombreCol] + 1);
      if (fmt) c.setNumberFormat(fmt);
      c.setValue(valor);
    };
    reg('ID', id, '@'); reg('Nombre', nombre, '@'); reg('Teléfono', tel, '@'); reg('Plan', plan, '@');
    reg('Fecha inicio', dInicio, 'dd/mm/yyyy'); reg('Fecha fin', dFin, 'dd/mm/yyyy');
    reg('Horario', horario, '@'); reg('Instructor', instructor, '@'); reg('Notas internas', notas, '@');

    // 4) Primer pago en Renovaciones (un usuario de prueba no paga: no se registra nada)
    if (!esPruebaNuevo) {
      const hRen = asegurarHojaRenovaciones_();
      const nueva = hRen.getLastRow() + 1;
      hRen.getRange(nueva, 1, 1, 10)
        .setNumberFormats([['@', '@', '@', 'dd/mm/yyyy', 'dd/mm/yyyy', 'dd/mm/yyyy', '@', '#,##0.00', '@', '@']])
        .setValues([[id, nombre, tel, dHoy, dInicio, dFin, plan, monto, 'Inscripción', instructor]]);
    }
  } finally {
    lock.releaseLock();
  }

  // 5) Tarjeta PDF (puede tardar ~10 s; si falla, el alumno ya quedó inscrito)
  const conf = leerConfig_();
  let pdf = '', pdfError = '';
  try {
    if (!conf.PLANTILLA_ID || !conf.CARPETA_PDF_ID) throw new Error('Falta PLANTILLA_ID o CARPETA_PDF_ID en la hoja Config');
    pdf = crearPdf_(conf, id, nombre, plan);
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const col = mapaColumnas_(alumnos);
    alumnos.getRange(fila, col['Tarjeta PDF'] + 1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Ver PDF').setLinkUrl(pdf).build());
  } catch (err) {
    pdf = ''; pdfError = String(err && err.message ? err.message : err).slice(0, 200);
  }

  let tarjeta = '';
  try { const u = urlVerificacion_(conf, id); if (/^https:\/\//.test(u)) tarjeta = u; } catch (e) { tarjeta = ''; }

  const fmt = (x) => Utilities.formatDate(x, CFG.TZ, 'dd/MM/yyyy');
  return { ok: true, id: id, nombre: nombre, tel: tel, plan: plan, inicio: fmt(dInicio), fin: fmt(dFin), monto: monto, tarjeta: tarjeta, pdf: pdf, pdfError: pdfError, prueba: esPruebaNuevo, dias: diasPrueba, motivo: motivo };
}

// Convierte un usuario de prueba en alumno regular: quita la marca PRUEBA y registra su primer pago (Inscripción)
function panelConvertirPrueba(d) {
  verificarDueno_();
  const id = normalizarId_(d && d.id);
  if (!id) return { ok: false, error: 'datos' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const col = mapaColumnas_(alumnos), fila = celda.getRow();
    const notas = String(alumnos.getRange(fila, col['Notas internas'] + 1).getValue() || '');
    if (!/^\s*prueba\b/i.test(notas) || esStaff_(notas)) return { ok: false, error: 'noprueba' };
    const i = notas.indexOf(' — ');
    alumnos.getRange(fila, col['Notas internas'] + 1).setNumberFormat('@').setValue(i >= 0 ? notas.slice(i + 3) : '');   // deja solo sus notas libres
    CacheService.getScriptCache().remove('al:' + id);
  } finally { lock.releaseLock(); }
  const r = panelRenovar({ id: id, inicio: d.inicio, monto: d.monto, bono: false, forzar: true });
  if (!r || !r.ok) {                                   // si el pago falla, vuelve a quedar como prueba
    try {
      const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
      const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
      const col = mapaColumnas_(alumnos);
      alumnos.getRange(celda.getRow(), col['Notas internas'] + 1).setNumberFormat('@').setValue('PRUEBA · convertir pendiente');
    } catch (e) {}
    return r;
  }
  try {                                               // su primer pago es una inscripción, no una renovación
    const h = asegurarHojaRenovaciones_(), ult = h.getLastRow();
    if (String(h.getRange(ult, 1).getValue()) === id) h.getRange(ult, 9).setValue('Inscripción');
  } catch (e) {}
  return r;
}

function panelRenovar(d) {
  verificarDueno_();
  const id = normalizarId_(d && d.id);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((d && d.inicio) || ''));
  if (!id || !m) return { ok: false, error: 'datos' };
  const y = +m[1], mo = +m[2], da = +m[3];
  const chk = new Date(Date.UTC(y, mo - 1, da));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return { ok: false, error: 'fecha' };
  const h = isoHoy_();
  const hoyMs = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
  if (Math.abs(chk.getTime() - hoyMs) > 366 * 86400000) return { ok: false, error: 'fecha' };
  const monto = Math.round(Number(d.monto) * 100) / 100;
  if (!isFinite(monto) || monto <= 0 || monto > 100000) return { ok: false, error: 'monto' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
    const celda = alumnos.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
    if (!celda || celda.getRow() === 1) return { ok: false, error: 'alumno' };
    const fila = celda.getRow();
    const col = mapaColumnas_(alumnos);
    const reg = alumnos.getRange(fila, 1, 1, alumnos.getLastColumn()).getValues()[0];
    const nombre = String(reg[col['Nombre']] || '').trim();
    const tel = telNormal_(reg[col['Teléfono']]);
    const plan = String(reg[col['Plan']] || '').trim();

    const hoja = asegurarHojaRenovaciones_();

    // Aviso de posible doble registro (últimos 3 días)
    if (d.forzar !== true) {
      const ult = hoja.getLastRow();
      if (ult >= 2) {
        const filas = hoja.getRange(Math.max(2, ult - 299), 1, ult - Math.max(2, ult - 299) + 1, 4).getValues();
        for (let i = filas.length - 1; i >= 0; i--) {
          if (normalizarId_(filas[i][0]) !== id || !(filas[i][3] instanceof Date)) continue;
          const f = Utilities.formatDate(filas[i][3], CFG.TZ, 'yyyy-MM-dd');
          const dias = (hoyMs - Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10))) / 86400000;
          if (dias >= 0 && dias < 3) return { ok: false, error: 'duplicado', fecha: Utilities.formatDate(filas[i][3], CFG.TZ, 'dd/MM/yyyy') };
          break;
        }
      }
    }

    let f = finDePlan_(y, mo, da);
    const bono = d.bono === true;                                  // renovó a tiempo: días extra de regalo
    if (bono) { const t = new Date(Date.UTC(f.y, f.m - 1, f.d + BONO_DIAS)); f = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
    const dInicio = fechaDia_(y, mo, da), dFin = fechaDia_(f.y, f.m, f.d);
    const dHoy = fechaDia_(+h.slice(0, 4), +h.slice(5, 7), +h.slice(8, 10));
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);

    // 1) Historial
    const nueva = hoja.getLastRow() + 1;
    hoja.getRange(nueva, 1, 1, 10)
      .setNumberFormats([['@', '@', '@', 'dd/mm/yyyy', 'dd/mm/yyyy', 'dd/mm/yyyy', '@', '#,##0.00', '@', '@']])
      .setValues([[id, seguro(nombre), tel, dHoy, dInicio, dFin, seguro(plan), monto, 'Renovación', seguro(String(reg[col['Instructor']] || '').trim())]]);

    // 2) Alumnos: nuevas fechas (Estado y Días restantes se recalculan solos)
    alumnos.getRange(fila, col['Fecha inicio'] + 1).setValue(dInicio);
    alumnos.getRange(fila, col['Fecha fin'] + 1).setValue(dFin);

    // 3) La tarjeta del alumno debe mostrar lo nuevo ya
    CacheService.getScriptCache().remove('al:' + id);

    const fmt = (x) => Utilities.formatDate(x, CFG.TZ, 'dd/MM/yyyy');
    return { ok: true, nombre: nombre, tel: tel, plan: plan, inicio: fmt(dInicio), fin: fmt(dFin), monto: monto, bono: bono ? BONO_DIAS : 0 };
  } finally {
    lock.releaseLock();
  }
}

function asegurarHojaRenovaciones_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_RENOVACIONES);
  if (h) {
    if (!h.getRange('I1').getValue()) {              // hojas creadas antes de existir la columna Tipo
      h.getRange('I1').setValue('Tipo').setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
      h.getRange('I2:I').setNumberFormat('@');
      h.setColumnWidth(9, 110);
    }
    if (!h.getRange('J1').getValue()) {              // columna Instructor: quién entrenaba al alumno cuando pagó
      h.getRange('J1').setValue('Instructor').setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
      h.getRange('J2:J').setNumberFormat('@');
      h.setColumnWidth(10, 110);
    }
    return h;
  }
  h = ss.insertSheet(CFG.HOJA_RENOVACIONES);
  h.getRange(1, 1, 1, 10).setValues([['ID', 'Nombre', 'Teléfono', 'Fecha', 'Fecha de inicio', 'Fecha fin', 'Plan', 'Monto pagado (Bs)', 'Tipo', 'Instructor']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.getRange('I2:J').setNumberFormat('@');
  h.setFrozenRows(1);
  h.getRange('A2:C').setNumberFormat('@');
  h.getRange('D2:F').setNumberFormat('dd/mm/yyyy');
  h.getRange('G2:G').setNumberFormat('@');
  h.getRange('H2:H').setNumberFormat('#,##0.00');
  [110, 200, 100, 100, 110, 100, 170, 130, 110, 110].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Renovaciones: las escribe el panel, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

/**
 * Consulta pública con protección anti-spam:
 * 1) rechaza códigos con formato inválido sin tocar el Sheet
 * 2) recuerda cada respuesta unos segundos (caché)
 * 3) limita las consultas nuevas por minuto
 */
function consultar_(id) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id)) return { ok: false };

  const cache = CacheService.getScriptCache();
  const guardado = cache.get('al:' + id);
  if (guardado) return JSON.parse(guardado);

  const clave = 'rl:' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > CFG.LIMITE_POR_MINUTO * 5) return { ok: false, ocupado: true };         // tope global generoso

  const alumno = buscarAlumno_(id);
  // Los códigos que no existen tienen un cupo aparte: quien prueba códigos al azar no bloquea a los alumnos reales
  if (!alumno && !limiteMin_('rlmiss', CFG.LIMITE_POR_MINUTO / 2)) return { ok: false, ocupado: true };
  const res = alumno ? { ok: true, alumno: alumno } : { ok: false };
  cache.put('al:' + id, JSON.stringify(res), CFG.CACHE_SEGUNDOS);
  return res;
}

function buscarAlumno_(id) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  if (!hoja) return null;
  const celda = hoja.getRange('A:A').createTextFinder(id).matchCase(false).matchEntireCell(true).findNext();
  if (!celda || celda.getRow() === 1) return null;

  const col = mapaColumnas_(hoja);
  const fila = hoja.getRange(celda.getRow(), 1, 1, hoja.getLastColumn()).getValues()[0];
  const v = (nombre) => fila[col[nombre]];

  const inicio = v('Fecha inicio');
  const fin = v('Fecha fin');
  const est = calcularEstado_(inicio, fin);

  // Datos visibles al escanear: nombre completo, horario, plan, fechas. Nunca teléfono ni notas
  return {
    id: id,
    nombre: String(v('Nombre') || '').trim(),
    plan: String(v('Plan') || '').trim(),
    horario: String(v('Horario') || '').trim(),
    instructor: String(v('Instructor') || '').trim(),
    inicio: fmtFecha_(inicio),
    fin: fmtFecha_(fin),
    estado: est.estado,
    clase: est.clase,
    textoDias: est.textoDias,
    progreso: est.progreso,
    staff: esStaff_(v('Notas internas')),
    racha: rachaDeAlumno_(id, String(v('Plan') || ''))
  };
}

function calcularEstado_(inicio, fin) {
  if (!(fin instanceof Date)) {
    return { estado: 'SIN FECHA', clase: 'neutral', textoDias: 'Consulta en recepción', progreso: 0 };
  }
  if (fin.getFullYear() >= 2090) {                                   // fecha 2099 = equipo de Kalos: sin vencimiento
    return { estado: 'ACTIVO', clase: 'ok', textoDias: 'STAFF · Kalos', progreso: 0 };
  }
  const hoy = diaLocal_(new Date());
  const dFin = diaLocal_(fin);
  const dIni = inicio instanceof Date ? diaLocal_(inicio) : null;
  const DIA = 86400000;
  const dias = Math.round((dFin - hoy) / DIA);

  let progreso = 100;
  if (dIni !== null && dFin > dIni) {
    progreso = Math.round(Math.min(1, Math.max(0, (hoy - dIni) / (dFin - dIni))) * 100);
  }

  // Ya no existe "POR INICIAR": una renovación anticipada mueve Fecha inicio al futuro
  // y el alumno sigue activo hasta su Fecha fin. El estado depende solo de la fecha fin.
  if (dias < 0) {
    const hace = Math.abs(dias);
    return { estado: 'VENCIDO', clase: 'bad', textoDias: 'Venció hace ' + hace + (hace === 1 ? ' día' : ' días'), progreso: 100 };
  }
  if (dias === 0) {
    return { estado: 'VENCE HOY', clase: 'warn', textoDias: 'Último día de tu plan', progreso: 100 };
  }
  if (dias <= CFG.DIAS_AVISO) {
    return { estado: 'POR VENCER', clase: 'warn', textoDias: 'Quedan ' + dias + (dias === 1 ? ' día' : ' días'), progreso: progreso };
  }
  return { estado: 'ACTIVO', clase: 'ok', textoDias: 'Quedan ' + dias + ' días', progreso: progreso };
}
