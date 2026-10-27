/* ------------------------------------------------------------
 *  ASISTENCIA: QR en la puerta + calendario anual por alumno
 *  Hoja "Asistencia": Fecha (yyyy-MM-dd) | Hora | ID | Nombre | Mes (yyyy-MM)
 *  El alumno se identifica con su celular (columna Teléfono de Alumnos).
 *  El celular NUNCA se devuelve ni se guarda en Asistencia.
 * ---------------------------------------------------------- */
function telNormal_(x) {
  let t = String(x === undefined || x === null ? '' : x).replace(/\D/g, '').replace(/^00/, '');
  if (t.length > 8 && t.indexOf('591') === 0) t = t.slice(3);
  return t;
}

function fechaTxt_(v) {
  return v instanceof Date ? Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd') : String(v || '').trim();
}

function buscarPorTelefono_(tel) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja ? hoja.getLastRow() : 0;
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (telNormal_(r[col['Teléfono']]) !== tel) return;
    const est = calcularEstado_(r[col['Fecha inicio']], r[col['Fecha fin']]);
    out.push({ id: id, nombre: nombre, fila: i + 2, estado: est.estado, textoDias: est.textoDias });
  });
  return out;
}

function fallaTel_(cache, error) {
  const k = 'asf:' + Math.floor(Date.now() / 60000);
  cache.put(k, String(Number(cache.get(k) || 0) + 1), 120);
  return { ok: false, error: error };
}

/* ------------------------------------------------------------
 *  PRUEBA DE PRESENCIA
 *  Una pantalla fija en la puerta muestra un QR que cambia cada minuto (Door.html, solo dueño).
 *  Las acciones que identifican al alumno por celular exigen ese código: una foto del QR deja de servir en pocos minutos.
 *  El secreto vive en Propiedades del script (PUERTA_SECRETO) y se crea solo la primera vez.
 * ------------------------------------------------------------ */
const PUERTA_PASO_S = 60;           // el código cambia cada 60 s
const PUERTA_VENTANAS = 3;          // se aceptan el actual y los 2 anteriores (~3 min)

function secretoPuerta_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('PUERTA_SECRETO');
  if (!s) {
    s = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now()));
    p.setProperty('PUERTA_SECRETO', s);
  }
  return s;
}

function firmaCorta_(texto, largo) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secretoPuerta_())).replace(/[=]/g, '').slice(0, largo);
}

function tokenPuerta_(ventana) { return firmaCorta_('door|' + ventana, 10); }

function puertaValida_(t) {
  t = String(t || '');
  if (!/^[A-Za-z0-9_-]{10}$/.test(t)) return false;
  const v = Math.floor(Date.now() / (PUERTA_PASO_S * 1000));
  let ok = false;
  for (let i = 0; i < PUERTA_VENTANAS; i++) if (igualConstante_(t, tokenPuerta_(v - i))) ok = true;
  return ok;
}

// Recibo del día: lo entrega el servidor tras un registro válido, para ver el calendario sin repetir el QR
function sesionPuerta_(id) { return firmaCorta_('ses|' + id + '|' + isoHoy_(), 16); }
function sesionValida_(id, ses) { return /^[A-Za-z0-9_-]{16}$/.test(String(ses || '')) && igualConstante_(String(ses), sesionPuerta_(id)); }

// Lo llama la pantalla de la puerta (Door.html); solo el dueño
function puertaTokenActual() {
  verificarDueno_();
  const v = Math.floor(Date.now() / (PUERTA_PASO_S * 1000));
  const base = String(leerConfig_().PAGINA_URL || '').replace(/\/+$/, '');
  return { token: tokenPuerta_(v), url: base ? base + '/?puerta=' + tokenPuerta_(v) : '', resta: PUERTA_PASO_S - (Math.floor(Date.now() / 1000) % PUERTA_PASO_S) };
}

function hashCorto_(t) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t))).slice(0, 16);
}

function manejarAsistencia_(d) {
  const accion = String(d.accion || '');
  if (accion !== 'asistencia_ver' && accion !== 'asistencia_registrar' && accion !== 'asistencia_tarjeta') return { ok: false, error: 'accion' };

  const cache = CacheService.getScriptCache();
  const min = Math.floor(Date.now() / 60000);
  const n = Number(cache.get('asm:' + min) || 0) + 1;
  cache.put('asm:' + min, String(n), 120);
  if (n > CFG.ASISTENCIA_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  const idTarjeta = normalizarId_(d.id || '');
  let alumno = null;

  if (idTarjeta) {
    // Calendario desde la tarjeta: se identifica con el código de la tarjeta (solo lectura)
    if (accion !== 'asistencia_ver') return { ok: false, error: 'invalido' };   // (tarjeta/registrar no aceptan código)
    if (!formato.test(idTarjeta) || !idExiste_(idTarjeta)) return { ok: false, error: 'invalido' };
    alumno = { id: idTarjeta, nombre: '' };
  } else {
    // Puerta: se identifica con el celular + prueba de presencia (QR rotativo). El calendario también acepta el recibo del día.
    const presente = puertaValida_(d.pt);
    if (!presente && !(accion === 'asistencia_ver' && d.ses)) return { ok: false, error: 'presencia' };
    if (Number(cache.get('asf:' + min) || 0) >= CFG.ASISTENCIA_FALLOS_POR_MINUTO) return { ok: false, error: 'ocupado' };
    const tel = telNormal_(d.tel);
    if (tel.length !== 8) return fallaTel_(cache, 'telefono');
    if (!limiteMin_('tel:' + hashCorto_(tel), 8)) return { ok: false, error: 'ocupado' };   // límite por persona
    const m = buscarPorTelefono_(tel);
    if (!m.length) return fallaTel_(cache, 'no_encontrado');
    if (m.length === 1) alumno = m[0];
    else {
      const sel = d.sel === undefined || d.sel === null || d.sel === '' ? -1 : Number(d.sel);
      if (!(sel >= 0 && sel < m.length && sel % 1 === 0)) {
        return { ok: true, eleccion: m.map((x) => x.nombre) };      // celular compartido: que elija su nombre
      }
      alumno = m[sel];
    }
  }

  if (!idTarjeta && accion === 'asistencia_ver' && !puertaValida_(d.pt) && !sesionValida_(alumno.id, d.ses)) return { ok: false, error: 'presencia' };

  if (accion === 'asistencia_tarjeta') {
    // App: con el celular devuelve solo el código de la tarjeta y el nombre (nunca el celular)
    return { ok: true, id: alumno.id, nombre: alumno.nombre };
  }

  if (accion === 'asistencia_ver') {
    const res = resumenAsistencia_(alumno.id);
    res.ok = true;
    res.nombre = alumno.nombre;
    return res;
  }

  // Registrar: un solo escritor a la vez, una asistencia por día
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaAsistencia_();
    const ahora = new Date();
    const fecha = Utilities.formatDate(ahora, CFG.TZ, 'yyyy-MM-dd');
    const hora = Utilities.formatDate(ahora, CFG.TZ, 'HH:mm');

    let ya = false;
    const ult = hoja.getLastRow();
    if (ult >= 2) {
      const desde = Math.max(2, ult - 799);
      ya = hoja.getRange(desde, 1, ult - desde + 1, 3).getValues()
        .some((r) => fechaTxt_(r[0]) === fecha && normalizarId_(r[2]) === alumno.id);
    }
    if (!ya) {
      let nombre = alumno.nombre;
      if (/^[=+\-@]/.test(nombre)) nombre = "'" + nombre;
      const fila = ult + 1;
      hoja.getRange(fila, 1, 1, 5).setNumberFormat('@')
        .setValues([[fecha, hora, alumno.id, nombre, fecha.slice(0, 7)]]);
      marcarUltimaVisita_(alumno.fila, Utilities.formatDate(ahora, CFG.TZ, 'dd/MM/yyyy'));
      try { cache.remove('al:' + alumno.id); } catch (e) {}                    // la racha de la tarjeta se actualiza al instante
    }
    const res = resumenAsistencia_(alumno.id);
    res.ok = true;
    res.ya = ya;
    res.nombre = alumno.nombre;
    res.fecha = Utilities.formatDate(ahora, CFG.TZ, 'dd/MM/yyyy');
    res.hora = hora;
    res.estado = alumno.estado;
    res.textoDias = alumno.textoDias;
    res.id = alumno.id;                          // quien está en la puerta puede vincular su tarjeta
    res.ses = sesionPuerta_(alumno.id);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function marcarUltimaVisita_(fila, texto) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map((x) => String(x).trim());
  const c = enc.indexOf(CFG.COL_ULTIMA_VISITA);
  if (c < 0 || !fila) return;
  hoja.getRange(fila, c + 1).setNumberFormat('@').setValue(texto);
}

// Calendario del año en curso (1 ene – 31 dic) + contadores + racha de semanas seguidas
function resumenAsistencia_(id) {
  const hoja = asegurarHojaAsistencia_();
  const ult = hoja.getLastRow();
  const hoy = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
  const anio = hoy.slice(0, 4), mes = hoy.slice(0, 7);

  const set = {};
  if (ult >= 2) {
    hoja.getRange(2, 1, ult - 1, 3).getValues().forEach((r) => {
      if (normalizarId_(r[2]) === id) set[fechaTxt_(r[0])] = true;
    });
  }
  const todos = Object.keys(set).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const delAnio = todos.filter((f) => f.slice(0, 4) === anio);

  const semana = (f) => Math.floor((Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 86400000 + 3) / 7);
  const semanas = {};
  todos.forEach((f) => { semanas[semana(f)] = true; });
  let w = semana(hoy);
  if (!semanas[w]) w--;                      // si aún no vino esta semana, cuenta desde la anterior
  let racha = 0;
  while (semanas[w]) { racha++; w--; }

  return {
    anio: Number(anio),
    hoy: hoy,
    dias: delAnio,
    mes: delAnio.filter((f) => f.slice(0, 7) === mes).length,
    total: delAnio.length,
    racha: racha
  };
}

function asegurarHojaAsistencia_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_ASISTENCIA);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_ASISTENCIA);
  h.getRange('A2:E').setNumberFormat('@');                    // todo texto: nada se vuelve fecha ni fórmula
  h.getRange(1, 1, 1, 5).setValues([['Fecha', 'Hora', 'ID', 'Nombre', 'Mes']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  [100, 70, 110, 220, 80].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Asistencia: la escribe el sistema, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

// Alumnos: "Última visita" (la escribe el sistema) y "Visitas este mes" (fórmula)
function asegurarColumnasAsistencia_() {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map((x) => String(x).trim());
  let c = enc.length;
  const estilo = (celda) => celda.setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  if (enc.indexOf(CFG.COL_ULTIMA_VISITA) < 0) { c++; estilo(hoja.getRange(1, c)).setValue(CFG.COL_ULTIMA_VISITA); hoja.setColumnWidth(c, 110); }
  if (enc.indexOf('Visitas este mes') < 0) {
    c++;
    estilo(hoja.getRange(1, c)).setValue('Visitas este mes');
    hoja.getRange(2, c).setFormula(
      '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Asistencia!C:C,A2:A,Asistencia!E:E,TEXT(TODAY(),"yyyy-MM"))))'
    );
    hoja.setColumnWidth(c, 120);
  }
}
