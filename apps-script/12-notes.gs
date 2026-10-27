/* ============================================================
   MIS APUNTES
   Cuaderno del alumno: ejercicio, intensidad (liga/peso), reps y notas, con fecha. Cada registro se guarda (historial).
   Hoja "Apuntes": Ref | ID | Alumno | Fecha | Ejercicio | Intensidad | Reps | Notas | Creado
   ============================================================ */
const HOJA_APUNTES = 'Apuntes';
const APUNTES_MAX = 500;            // por alumno
const APUNTES_POR_MINUTO = 40;      // por tarjeta

function asegurarHojaApuntes_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_APUNTES);
  if (h) return h;
  h = ss.insertSheet(HOJA_APUNTES);
  h.getRange(1, 1, 1, 9).setValues([['Ref', 'ID', 'Alumno', 'Fecha', 'Ejercicio', 'Intensidad', 'Reps', 'Notas', 'Creado']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:I').setNumberFormat('@');
  [90, 110, 200, 100, 220, 160, 100, 320, 150].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Apuntes de los alumnos: los escribe el sistema').setWarningOnly(true);
  return h;
}

function fechaApunte_(v) {
  return v instanceof Date ? Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd') : String(v || '');
}

function leerApuntes_(hoja, id) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  const v = hoja.getRange(2, 1, n, 9).getValues();
  const out = [];
  v.forEach((f) => {
    if (String(f[1]) !== id) return;
    out.push({ ref: String(f[0]), fecha: fechaApunte_(f[3]), ejercicio: String(f[4]), intensidad: String(f[5]), reps: String(f[6]), notas: String(f[7]), creado: String(f[8]) });
  });
  out.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : 0)));
  return out.map((x) => ({ ref: x.ref, fecha: x.fecha, ejercicio: x.ejercicio, intensidad: x.intensidad, reps: x.reps, notas: x.notas }));
}

function validarApunte_(d) {
  const ejercicio = limpiarTexto_(d.ejercicio, 60), intensidad = limpiarTexto_(d.intensidad, 60), reps = limpiarTexto_(d.reps, 40);
  const notas = limpiarTexto_(d.notas, 300);
  if (ejercicio.length < 2) return { error: 'ejercicio' };
  if (!intensidad) return { error: 'intensidad' };
  if (!reps) return { error: 'reps' };
  const hoy = isoHoy_();
  let fecha = String(d.fecha || '').trim() || hoy;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return { error: 'fecha' };
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return { error: 'fecha' };
  const lim = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10) + 1));    // mañana como máximo (por la hora del celular)
  const viejo = new Date(Date.UTC(+hoy.slice(0, 4) - 3, +hoy.slice(5, 7) - 1, +hoy.slice(8, 10)));
  if (dt > lim || dt < viejo) return { error: 'fecha' };
  return { fecha: fecha, ejercicio: ejercicio, intensidad: intensidad, reps: reps, notas: notas };
}

function manejarApuntes_(id, d) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };
  const cache = CacheService.getScriptCache();
  const huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ap|' + id));
  const clave = 'apm:' + huella + ':' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(clave) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > APUNTES_POR_MINUTO) return { ok: false, error: 'ocupado' };

  const accion = String(d.accion || '');
  if (accion === 'apuntes_leer') return { ok: true, items: leerApuntes_(asegurarHojaApuntes_(), id) };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'ocupado' };
  try {
    const hoja = asegurarHojaApuntes_();
    const ahora = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss');

    if (accion === 'apuntes_crear') {
      const a = validarApunte_(d);
      if (a.error) return { ok: false, error: a.error };
      if (leerApuntes_(hoja, id).length >= APUNTES_MAX) return { ok: false, error: 'limite' };
      const ref = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      const fila = hoja.getLastRow() + 1;
      hoja.getRange(fila, 1, 1, 9).setNumberFormat('@').setValues([[ref, id, String(nombreDe_(id) || ''), a.fecha, a.ejercicio, a.intensidad, a.reps, a.notas, ahora]]);
      return { ok: true, items: leerApuntes_(hoja, id) };
    }

    if (accion === 'apuntes_editar' || accion === 'apuntes_borrar') {
      const ref = String(d.ref || '');
      if (!/^[0-9a-f]{10}$/.test(ref)) return { ok: false, error: 'no_existe' };
      const n2 = hoja.getLastRow() - 1;
      if (n2 < 1) return { ok: false, error: 'no_existe' };
      const col = hoja.getRange(2, 1, n2, 2).getValues();
      let fila = 0;
      for (let i = 0; i < col.length; i++) { if (String(col[i][0]) === ref && String(col[i][1]) === id) { fila = i + 2; break; } }
      if (!fila) return { ok: false, error: 'no_existe' };
      if (accion === 'apuntes_borrar') { hoja.deleteRow(fila); return { ok: true, items: leerApuntes_(hoja, id) }; }
      const a = validarApunte_(d);
      if (a.error) return { ok: false, error: a.error };
      hoja.getRange(fila, 4, 1, 5).setNumberFormat('@').setValues([[a.fecha, a.ejercicio, a.intensidad, a.reps, a.notas]]);
      return { ok: true, items: leerApuntes_(hoja, id) };
    }
    return { ok: false, error: 'accion' };
  } finally { lock.releaseLock(); }
}
