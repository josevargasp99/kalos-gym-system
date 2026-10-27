/* ============================================================
   FISIOTERAPIA ALIADA
   Cuenta cuántos alumnos tocan "Escribir al fisioterapeuta" (hoja "Fisio"; solo la ve el dueño)
   ============================================================ */
const HOJA_FISIO = 'Fisio';

function asegurarHojaFisio_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HOJA_FISIO);
  if (h) return h;
  h = ss.insertSheet(HOJA_FISIO);
  h.getRange(1, 1, 1, 4).setValues([['Fecha', 'Hora', 'ID', 'Nombre']])
    .setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#3CE86B');
  h.setFrozenRows(1);
  h.getRange('A2:D').setNumberFormat('@');
  [100, 80, 110, 220].forEach((w, i) => h.setColumnWidth(i + 1, w));
  h.protect().setDescription('Consultas al fisioterapeuta aliado: las escribe el sistema').setWarningOnly(true);
  return h;
}

function manejarFisio_(id) {
  const formato = new RegExp('^' + CFG.PREFIJO_ID + '[' + CFG.ALFABETO_ID + ']{' + CFG.LARGO_ID + '}$');
  if (!formato.test(id) || !idExiste_(id)) return { ok: false, error: 'invalido' };
  const cache = CacheService.getScriptCache();
  const clave = 'fi:' + id + ':' + isoHoy_();      // máximo 1 registro por alumno por día
  if (cache.get(clave)) return { ok: true, repetido: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { ok: true };     // si hay cola, no molestamos al alumno
  try {
    const h = asegurarHojaFisio_();
    const seguro = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t);
    const ahora = new Date();
    h.getRange(h.getLastRow() + 1, 1, 1, 4).setNumberFormat('@')
      .setValues([[Utilities.formatDate(ahora, CFG.TZ, 'yyyy-MM-dd'), Utilities.formatDate(ahora, CFG.TZ, 'HH:mm'), id, seguro(String(nombreDe_(id) || ''))]]);
    cache.put(clave, '1', 21600);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function fisioMes_(mes) {
  try {
    const h = SpreadsheetApp.getActive().getSheetByName(HOJA_FISIO);
    if (!h || h.getLastRow() < 2) return { total: 0, alumnos: 0 };
    const v = h.getRange(2, 1, h.getLastRow() - 1, 3).getValues();
    const ids = {}; let n = 0;
    v.forEach((f) => {
      const fe = f[0] instanceof Date ? Utilities.formatDate(f[0], CFG.TZ, 'yyyy-MM-dd') : String(f[0]);
      if (fe.slice(0, 7) === mes) { n++; ids[String(f[2])] = 1; }
    });
    return { total: n, alumnos: Object.keys(ids).length };
  } catch (e) { return { total: 0, alumnos: 0 }; }
}
