// Security regression tests for the door code, admin guards and per-person limits.
// Run: node tests/security.test.js   (uses minimal mocks of the Apps Script services)
const crypto=require('crypto'), fs=require('fs'), path=require('path');
const DIR=path.join(__dirname,'..','apps-script');
const sg=b=>Array.from(b).map(v=>v>127?v-256:v), ub=b=>Buffer.from(b.map(v=>v&255));
let NOW=Date.now(); const realNow=Date.now; Date.now=()=>NOW;
const props={};
global.Utilities={
  DigestAlgorithm:{SHA_256:'sha256'},
  getUuid:()=>crypto.randomUUID(),
  computeDigest:(a,d)=>sg(crypto.createHash('sha256').update(d).digest()),
  computeHmacSha256Signature:(d,k)=>sg(crypto.createHmac('sha256',k).update(d).digest()),
  base64EncodeWebSafe:b=>(Array.isArray(b)?ub(b):Buffer.from(b)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),
  formatDate:(d,tz,f)=>new Date(d).toISOString().slice(0,10),
};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v}})};
const cache={}; global.CacheService={getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>{cache[k]=v},remove:k=>delete cache[k]})};
let owner=false;
global.Session={getActiveUser:()=>({getEmail:()=>owner?'a@x.com':''}),getEffectiveUser:()=>({getEmail:()=>'a@x.com'})};
let src=fs.readdirSync(DIR).filter(f=>f.endsWith('.gs')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(f=>fs.readFileSync(path.join(DIR,f),'utf8')).join('\n').replace(/\bconst /g,'var ').replace(/\blet /g,'var ');
(0,eval)(src+`
;globalThis.T={puertaValida_,tokenPuerta_,sesionValida_,sesionPuerta_,soloDuenoOAlarma_,soloDueno_,manejarAsistencia_,limiteMin_,hashCorto_};`);
const T=globalThis.T; let ok=0,fail=0; const t=(n,c)=>{(c?ok++:fail++); console.log((c?'✔':'✘')+' '+n)};
const v=Math.floor(NOW/60000);
t('token actual válido',T.puertaValida_(T.tokenPuerta_(v)));
t('token de hace 2 min válido',T.puertaValida_(T.tokenPuerta_(v-2)));
NOW+=4*60000; t('token de hace 4 min vencido',!T.puertaValida_(T.tokenPuerta_(v)));
NOW=realNow();
t('vacío/basura rechazado',!T.puertaValida_('')&&!T.puertaValida_('AAAAAAAAAA')&&!T.puertaValida_('../../etc'));
t('recibo del día válido solo para su id',T.sesionValida_('KAL-AAAAAA',T.sesionPuerta_('KAL-AAAAAA'))&&!T.sesionValida_('KAL-BBBBBB',T.sesionPuerta_('KAL-AAAAAA')));
owner=false;
let thr=false; try{T.soloDueno_()}catch(e){thr=true} t('administrador: anónimo rechazado',thr);
thr=false; try{T.soloDuenoOAlarma_(undefined)}catch(e){thr=true} t('avisos: llamada desde navegador rechazada',thr);
thr=false; try{T.soloDuenoOAlarma_({})}catch(e){thr=true} t('avisos: evento sin triggerUid rechazado',thr);
thr=false; try{T.soloDuenoOAlarma_({triggerUid:'123'})}catch(e){thr=true} t('avisos: disparador horario real permitido',!thr);
owner=true; thr=false; try{T.soloDueno_();T.soloDuenoOAlarma_()}catch(e){thr=true} t('dueño puede ejecutar a mano',!thr);
global.CFG=global.CFG||{};
for (const a of ['asistencia_registrar','asistencia_tarjeta']) { const r=T.manejarAsistencia_({accion:a,tel:'77777777'}); t(a+' sin QR → presencia',r.error==='presencia'); }
let r=T.manejarAsistencia_({accion:'asistencia_ver',tel:'77777777'}); t('ver por celular sin QR ni recibo → presencia',r.error==='presencia');
r=T.manejarAsistencia_({accion:'asistencia_registrar',tel:'77777777',pt:'XXXXXXXXXX'}); t('registrar con QR falso → presencia',r.error==='presencia');
const lim=[]; for(let i=0;i<10;i++) lim.push(T.limiteMin_('x',8)); t('límite por persona corta al 9.º intento',lim[7]===true&&lim[8]===false);
console.log(`\n${ok} ok, ${fail} fallan`); process.exit(fail?1:0);
