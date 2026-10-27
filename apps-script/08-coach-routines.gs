/* ------------------------------------------------------------
 *  RUTINAS DEL INSTRUCTOR
 *  Hoja "Rutinas": ID | Nombre | Día (1=lun … 5=vie) | Orden (1–3) | Archivo ID | Actualizada | Subida por
 *  Las imágenes viven en una carpeta privada de Drive; solo el servidor las entrega.
 * ---------------------------------------------------------- */
const DIAS_RUTINA_ = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

function limiteMin_(clave, max) {
  const cache = CacheService.getScriptCache();
  const k = clave + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 120);
  return n <= max;
}

function igualConstante_(a, b) {
  a = String(a); b = String(b);
  let r = a.length === b.length ? 0 : 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

// Devuelve { coach } si la clave es válida; si no, { error }
function coachAuth_(d) {
  const cache = CacheService.getScriptCache();
  const min = Math.floor(Date.now() / 60000);
  if (Number(cache.get('cof:' + min) || 0) >= CFG.COACH_FALLOS_POR_MINUTO) return { error: 'ocupado' };
  if (!limiteMin_('coa', CFG.COACH_ACCIONES_POR_MINUTO)) return { error: 'ocupado' };
  const clave = String(d.clave || '');
  const conf = leerConfig_();
  let coach = null;
  Object.keys(COACHES).forEach((k) => {
    const esp = conf[COACHES[k].claveConfig];
    if (esp && esp.length >= 20 && clave && igualConstante_(clave, esp)) coach = COACHES[k];
  });
  if (!coach) {
    cache.put('cof:' + min, String(Number(cache.get('cof:' + min) || 0) + 1), 120);
    return { error: 'clave' };
  }
  return { coach: coach };
}

function instructorDe_(txt) { return String(txt || '').trim().toLowerCase(); }

function alumnosDeCoach_(coach) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(CFG.HOJA_ALUMNOS);
  const ult = hoja ? hoja.getLastRow() : 0;
  if (ult < 2) return [];
  const col = mapaColumnas_(hoja);
  const vals = hoja.getRange(2, 1, ult - 1, hoja.getLastColumn()).getValues();
  const out = [];
  vals.forEach((r) => {
    const id = normalizarId_(r[col['ID']]);
    const nombre = String(r[col['Nombre']] || '').trim();
    if (!id || !nombre) return;
    if (instructorDe_(r[col['Instructor']]) !== instructorDe_(coach.nombre)) return;
    const est = calcularEstado_(r[col['Fecha inicio']], r[col['Fecha fin']]);
    out.push({
      id: id, nombre: nombre, tel: telNormal_(r[col['Teléfono']]),
      plan: String(r[col['Plan']] || '').trim(), horario: String(r[col['Horario']] || '').trim(),
      estado: est.estado, textoDias: est.textoDias,
      prueba: /^\s*prueba\b/i.test(String(r[col['Notas internas']] || ''))
    });
  });
  return out;
}

function asegurarHojaRutinas_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJA_RUTINAS);
  if (h) return h;
  h = ss.insertSheet(CFG.HOJA_RUTINAS);
  h.getRange('A:G').setNumberFormat('@');
  h.getRange(1, 1, 1, 7).setValues([['ID', 'Nombre', 'Día', 'Orden', 'Archivo ID', 'Actualizada', 'Subida por']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.setColumnWidth(1, 100).setColumnWidth(2, 180).setColumnWidth(5, 260).setColumnWidth(6, 110);
  h.protect().setDescription('Rutinas: las escribe el sistema, corregir solo si hace falta').setWarningOnly(true);
  return h;
}

function carpetaRutinas_() {
  const conf = leerConfig_();
  if (conf.CARPETA_RUTINAS_ID) {
    try { return DriveApp.getFolderById(conf.CARPETA_RUTINAS_ID); } catch (e) { /* se vuelve a crear */ }
  }
  const padres = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  const base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName(CFG.NOMBRE_CARPETA_RUTINAS);
  const carpeta = it.hasNext() ? it.next() : base.createFolder(CFG.NOMBRE_CARPETA_RUTINAS);
  escribirConfig_('CARPETA_RUTINAS_ID', carpeta.getId());
  return carpeta;
}

// Todas las filas de la hoja como objetos
function leerRutinas_(hoja) {
  const ult = hoja.getLastRow();
  if (ult < 2) return [];
  return hoja.getRange(2, 1, ult - 1, 7).getValues().map((r, i) => ({
    fila: i + 2, id: normalizarId_(r[0]), nombre: String(r[1] || ''), dia: Number(r[2]), orden: Number(r[3]),
    archivo: String(r[4] || ''), fecha: String(r[5] || '')
  })).filter((x) => x.id && x.archivo);
}

// 5 listas (lun–vie) con las imágenes de un alumno
function diasDe_(filas, id) {
  const dias = [[], [], [], [], []];
  let ultima = ['', '', '', '', ''];
  filas.filter((x) => x.id === id && x.dia >= 1 && x.dia <= 5).sort((a, b) => a.orden - b.orden).forEach((x) => {
    dias[x.dia - 1].push({ orden: x.orden, fecha: x.fecha });
    ultima[x.dia - 1] = x.fecha;
  });
  return { dias: dias, fechas: ultima };
}

function imagenBase64_(archivoId) {
  const blob = DriveApp.getFileById(archivoId).getBlob();
  return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function ahoraTxt_() { return Utilities.formatDate(new Date(), CFG.TZ, 'dd/MM/yyyy'); }

function papelera_(archivoId) { try { DriveApp.getFileById(archivoId).setTrashed(true); } catch (e) { /* ya no existe */ } }

function manejarCoach_(d) {
  const auth = coachAuth_(d);
  if (auth.error) return { ok: false, error: auth.error };
  const coach = auth.coach;
  const accion = String(d.accion || '');
  const mios = alumnosDeCoach_(coach);
  const porId = {}; mios.forEach((a) => { porId[a.id] = a; });
  const id = normalizarId_(d.id || '');

  if (accion === 'coach_lista') {
    const filas = leerRutinas_(asegurarHojaRutinas_());
    return {
      ok: true, coach: coach.nombre,
      alumnos: mios.map((a) => {
        const r = diasDe_(filas, a.id);
        a.cuenta = r.dias.map((x) => x.length);
        return a;
      })
    };
  }

  if (accion === 'coach_pagos') return coachPagos_(coach, d.semana);

  const dia = Number(d.dia);
  const conDia = accion !== 'coach_ver' && accion !== 'coach_aviso';
  if (!porId[id] && accion !== 'coach_copiar') return { ok: false, error: 'alumno' };

  if (accion === 'coach_apuntes') return { ok: true, items: leerApuntes_(asegurarHojaApuntes_(), id) };   // solo lectura

  if (accion === 'coach_ver') {
    const r = diasDe_(leerRutinas_(asegurarHojaRutinas_()), id);
    return { ok: true, dias: r.dias, fechas: r.fechas };
  }

  if (accion === 'coach_img') {
    const orden = Number(d.orden);
    const f = leerRutinas_(asegurarHojaRutinas_()).find((x) => x.id === id && x.dia === dia && x.orden === orden);
    if (!f) return { ok: false, error: 'no_existe' };
    return { ok: true, data: imagenBase64_(f.archivo) };
  }

  if (!(dia >= 1 && dia <= 5 && dia % 1 === 0)) return { ok: false, error: 'dia' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaRutinas_();

    if (accion === 'coach_subir') {
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+\/=]+)$/.exec(String(d.data || ''));
      if (!m || String(d.data).length > CFG.RUTINA_MAX_CHARS) return { ok: false, error: 'imagen' };
      const bytes = Utilities.base64Decode(m[2]);
      const jpg = bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255;
      const png = bytes.length > 4 && (bytes[0] & 255) === 137 && (bytes[1] & 255) === 80 && (bytes[2] & 255) === 78 && (bytes[3] & 255) === 71;
      if (!jpg && !png) return { ok: false, error: 'imagen' };

      const filas = leerRutinas_(hoja).filter((x) => x.id === id && x.dia === dia);
      let orden = Number(d.orden) || 0;
      const previa = orden ? filas.find((x) => x.orden === orden) : null;
      if (!previa) {
        const usados = filas.map((x) => x.orden);
        orden = 0;
        for (let o = 1; o <= CFG.RUTINAS_MAX_DIA; o++) if (usados.indexOf(o) < 0) { orden = o; break; }
        if (!orden) return { ok: false, error: 'maximo' };
      }
      const blob = Utilities.newBlob(bytes, jpg ? 'image/jpeg' : 'image/png', id + '_d' + dia + '_o' + orden + '_' + Date.now() + (jpg ? '.jpg' : '.png'));
      const arch = carpetaRutinas_().createFile(blob);
      if (previa) {
        papelera_(previa.archivo);
        hoja.getRange(previa.fila, 5, 1, 3).setValues([[arch.getId(), ahoraTxt_(), coach.nombre]]);
      } else {
        const fila = hoja.getLastRow() + 1;
        hoja.getRange(fila, 1, 1, 7).setNumberFormat('@')
          .setValues([[id, porId[id].nombre, String(dia), String(orden), arch.getId(), ahoraTxt_(), coach.nombre]]);
      }
      const r = diasDe_(leerRutinas_(hoja), id);
      return { ok: true, dias: r.dias, fechas: r.fechas, orden: orden };
    }

    if (accion === 'coach_quitar') {
      const orden = Number(d.orden);
      const f = leerRutinas_(hoja).find((x) => x.id === id && x.dia === dia && x.orden === orden);
      if (!f) return { ok: false, error: 'no_existe' };
      papelera_(f.archivo);
      hoja.deleteRow(f.fila);
      const r = diasDe_(leerRutinas_(hoja), id);
      return { ok: true, dias: r.dias, fechas: r.fechas };
    }

    if (accion === 'coach_copiar') {
      const origen = id;
      if (!porId[origen]) return { ok: false, error: 'alumno' };
      const destinos = (Array.isArray(d.destinos) ? d.destinos : []).map(normalizarId_)
        .filter((x, i, arr) => x && x !== origen && porId[x] && arr.indexOf(x) === i).slice(0, 40);
      if (!destinos.length) return { ok: false, error: 'destinos' };
      const filas = leerRutinas_(hoja);
      const fuente = filas.filter((x) => x.id === origen && x.dia === dia).sort((a, b) => a.orden - b.orden);
      if (!fuente.length) return { ok: false, error: 'no_existe' };
      const conflictos = destinos.filter((x) => filas.some((f) => f.id === x && f.dia === dia));
      if (conflictos.length && !d.reemplazar) {
        return { ok: true, conflictos: conflictos.map((x) => porId[x].nombre) };
      }
      // quitar lo anterior de los destinos (de abajo hacia arriba para no desfasar filas)
      filas.filter((f) => destinos.indexOf(f.id) >= 0 && f.dia === dia).sort((a, b) => b.fila - a.fila)
        .forEach((f) => { papelera_(f.archivo); hoja.deleteRow(f.fila); });
      const carpeta = carpetaRutinas_();
      const hoy = ahoraTxt_();
      const nuevas = [];
      destinos.forEach((dest) => {
        fuente.forEach((f) => {
          const copia = DriveApp.getFileById(f.archivo).makeCopy(dest + '_d' + dia + '_o' + f.orden + '_' + Date.now(), carpeta);
          nuevas.push([dest, porId[dest].nombre, String(dia), String(f.orden), copia.getId(), hoy, coach.nombre]);
        });
      });
      const primera = hoja.getLastRow() + 1;
      hoja.getRange(primera, 1, nuevas.length, 7).setNumberFormat('@').setValues(nuevas);
      return { ok: true, copiados: destinos.length };
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: false, error: 'accion' };
}

// Alumno: ve las rutinas de su instructor (solo si está asignado a un instructor con panel)
function manejarRutinaAlumno_(id, d) {
  const accion = String(d.accion || '');
  if (accion !== 'rutina_ver' && accion !== 'rutina_img') return { ok: false, error: 'accion' };
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id)) return { ok: false, error: 'invalido' };
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'rt|' + id));
  if (!limiteMin_('rtm:' + huella, CFG.RUTINAS_POR_MINUTO_TARJETA)) return { ok: false, error: 'ocupado' };
  const al = idExiste_(id) ? buscarAlumno_(id) : null;
  if (!al) return { ok: false, error: 'invalido' };
  if (!COACHES[instructorDe_(al.instructor)]) return { ok: false, error: 'sin_rutina' };

  const filas = leerRutinas_(asegurarHojaRutinas_());
  if (accion === 'rutina_ver') {
    const r = diasDe_(filas, id);
    return { ok: true, dias: r.dias, fechas: r.fechas, estado: al.estado };
  }
  const dia = Number(d.dia), orden = Number(d.orden);
  const f = filas.find((x) => x.id === id && x.dia === dia && x.orden === orden);
  if (!f) return { ok: false, error: 'no_existe' };
  return { ok: true, data: imagenBase64_(f.archivo) };
}
