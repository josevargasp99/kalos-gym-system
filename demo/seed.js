/*
 * Synthetic demo data. Every name, phone number and amount below is invented.
 * Dates are generated relative to "today", so the demo always looks current.
 * Runs on top of the REAL server code (apps-script/*.gs) and the emulator in gas-emulator.js.
 */
function seedDemo() {
  'use strict';
  var DAY = 86400000;
  var rnd = (function (s) { return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })(20261026);
  var hoyIso = isoHoy_();
  var T = Date.UTC(+hoyIso.slice(0, 4), +hoyIso.slice(5, 7) - 1, +hoyIso.slice(8, 10));
  var isoDe = function (off) { return Utilities.formatDate(new Date(T + off * DAY), 'UTC', 'yyyy-MM-dd'); };
  var dateDe = function (off) { return new Date(T + off * DAY + 12 * 3600000); };
  var dow = function (off) { return (new Date(T + off * DAY).getUTCDay() + 6) % 7; };   // 0 = Monday

  // ---- project setup (creates the sheets exactly like the real setup() does) ----
  // (the real setup() also touches Drive/Slides, which the demo does not have, so its sheet steps are repeated here)
  var ss0 = SpreadsheetApp.getActive();
  var hojaA = ss0.insertSheet(CFG.HOJA_ALUMNOS, 0); prepararHojaAlumnos_(hojaA);
  var hojaC = ss0.insertSheet(CFG.HOJA_CONFIG);
  hojaC.getRange(1, 1, 4, 3).setValues([['Clave', 'Valor', 'Qué es'], ['PLANTILLA_ID', '', ''], ['CARPETA_PDF_ID', '', ''], ['WEBAPP_URL', '', '']]);
  asegurarHojaSugerencias_(); asegurarHojaLogros_(); asegurarHojaAsistencia_(); asegurarColumnasAsistencia_(); asegurarHojaRenovaciones_();
  escribirConfig_('PAGINA_URL', (typeof location !== 'undefined' ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://demo.example/') + 'card/');
  escribirConfig_('COACH_CLAVE', 'DEMOCOACHKEY0123456789ABC');
  escribirConfig_('PCT_PARTNER', '40');
  escribirConfig_('PCT_COACH', '80');
  PropertiesService.getScriptProperties().setProperty('PUERTA_SECRETO', 'demo-only-door-secret-not-a-real-one');

  var alumnos = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  var col = mapaColumnas_(alumnos);
  var ALF = CFG.ALFABETO_ID, usados = {};
  function nuevoId() { var id; do { id = CFG.PREFIJO_ID; for (var i = 0; i < CFG.LARGO_ID; i++) id += ALF.charAt(Math.floor(rnd() * ALF.length)); } while (usados[id]); usados[id] = 1; return id; }

  // name, plan, days since the current period started, attendance probability, instructor, schedule, previous periods
  var specs = [
    ['Alex Rivera',        'Mensual',            12, 0.95, 'Coach', 'Lun–Vie 19:00', 2],
    ['Camila Torres',      '3 veces por semana', 20, 0.80, '',      'Lun–Vie 07:00', 2],
    ['Mateo Salinas',      'Mensual',            27, 0.85, '',      'Lun–Vie 18:00', 1],
    ['Valeria Quiroga',    'Trimestral',         40, 0.90, 'Coach', 'Lun–Vie 06:30', 0],
    ['Diego Paredes',      'Mensual',            29, 0.75, '',      'Lun–Vie 20:00', 3],
    ['Lucía Mendoza',      'Mensual',            30, 0.70, 'Coach', 'Lun–Vie 19:00', 1],
    ['Sofía Aguilar',      '3 veces por semana', 32, 0.75, '',      'Lun–Vie 07:00', 2],
    ['Andrés Rojas',       'Mensual',            42, 0.55, '',      'Lun–Vie 21:00', 1],
    ['Valentina Cruz',     'Trimestral',         70, 0.60, '',      'Lun–Vie 08:00', 0],
    ['Joaquín Vega',       'Mensual',             5, 1.00, '',      'Lun–Vie 18:00', 0],
    ['Renata Flores',      '3 veces por semana', 15, 0.85, 'Coach', 'Lun–Vie 19:00', 1],
    ['Bruno Castro',       'Mensual',            25, 0.90, 'Coach', 'Lun–Vie 06:30', 4],
    ['Isabela Montes',     'Mensual',             3, 1.00, '',      'Lun–Vie 07:00', 0],
    ['Tomás Gutiérrez',    '3 veces por semana', 23, 0.80, '',      'Lun–Vie 20:00', 2],
    ['Demo Staff',         'Mensual',             0, 0.50, 'Coach', 'Libre',         0],
    ['Demo Trial User',    'Mensual',             2, 0.50, '',      'Libre',         0]
  ];
  var precio = { 'Mensual': 100, '3 veces por semana': 80, 'Trimestral': 270 };
  var diasPlan = { 'Mensual': 30, '3 veces por semana': 30, 'Trimestral': 90 };

  var rowsA = [], rowsR = [], asis = [], feriados = feriados_();
  specs.forEach(function (sp, i) {
    var id = nuevoId(), nombre = sp[0], plan = sp[1], ini = -sp[2], fin = ini + diasPlan[plan] - 1;
    var tel = '7000' + ('0000' + (i + 1)).slice(-4);
    var staff = nombre === 'Demo Staff', prueba = nombre === 'Demo Trial User';
    var fila = []; for (var c = 0; c < alumnos.getLastColumn(); c++) fila.push('');
    fila[col['ID']] = id; fila[col['Nombre']] = nombre; fila[col['Teléfono']] = tel; fila[col['Plan']] = plan;
    fila[col['Fecha inicio']] = dateDe(ini); fila[col['Fecha fin']] = staff ? new Date(Date.UTC(2099, 11, 31, 12)) : dateDe(fin);
    fila[col['Horario']] = sp[5]; fila[col['Instructor']] = sp[4];
    fila[col['Notas internas']] = staff ? 'STAFF' : (prueba ? 'PRUEBA · demo trial — 3-day pass' : '');
    rowsA.push({ fila: fila, id: id });
    sp.id = id; sp.tel = tel;

    // payments: previous periods + current one (none for staff / trial users)
    if (!staff && !prueba) {
      for (var k = sp[6]; k >= 0; k--) {
        var pIni = ini - k * diasPlan[plan], pFin = pIni + diasPlan[plan] - 1;
        var esPrimero = (k === sp[6]);
        var tipo = esPrimero ? 'Inscripción' : 'Renovación';
        rowsR.push([id, nombre, tel, dateDe(pIni), dateDe(pIni), dateDe(pFin), plan, precio[plan], tipo, sp[4]]);
      }
    }
    // attendance
    var desde = Math.max(ini - (sp[6] * diasPlan[plan]), -75);
    for (var off = desde; off <= 0; off++) {
      var iso = isoDe(off), d = dow(off);
      if (d > 4 || feriados[iso]) continue;
      var vigente = false;
      for (var kk = sp[6]; kk >= 0; kk--) { var a0 = ini - kk * diasPlan[plan], a1 = a0 + diasPlan[plan] - 1; if (off >= a0 && off <= a1) vigente = true; }
      if (!vigente && !staff) continue;
      var p = sp[3];
      if (plan === '3 veces por semana') p = 0.6;
      if (rnd() < p) {
        var h = 6 + Math.floor(rnd() * 15);
        asis.push([iso, ('0' + h).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2), id, nombre, iso.slice(0, 7)]);
      }
    }
  });

  rowsA.forEach(function (r, i) { alumnos.getRange(i + 2, 1, 1, r.fila.length).setValues([r.fila]); });
  var hR = asegurarHojaRenovaciones_();
  rowsR.forEach(function (r, i) { hR.getRange(i + 2, 1, 1, 10).setValues([r]); });
  var hAs = asegurarHojaAsistencia_();
  asis.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  asis.forEach(function (r, i) { hAs.getRange(i + 2, 1, 1, 5).setNumberFormat('@').setValues([r]); });

  // last visit per student (like the live system keeps it)
  var ult = {}; asis.forEach(function (r) { ult[r[2]] = r[0]; });
  var cU = col[CFG.COL_ULTIMA_VISITA];
  if (cU !== undefined) rowsA.forEach(function (r, i) { if (ult[r.id]) alumnos.getRange(i + 2, cU + 1).setValue(ult[r.id].slice(8, 10) + '/' + ult[r.id].slice(5, 7) + '/' + ult[r.id].slice(0, 4)); });

  // goals + training log for the first student, through the real handlers
  var alex = specs[0].id;
  try {
    manejarLogros_(alex, { accion: 'logros_crear', metas: ['10 strict pull-ups', 'Hold a 30 s handstand', 'First muscle-up'] });
    manejarApuntes_(alex, { accion: 'apuntes_crear', fecha: hoyIso, ejercicio: 'Pull-ups', intensidad: 'Weighted +5 kg', reps: '5x6', notas: 'Felt strong, add 2.5 kg next week' });
  } catch (e) { /* optional */ }

  return { students: specs.map(function (s) { return { id: s.id, nombre: s[0], tel: s.tel, plan: s[1] }; }) };
}
