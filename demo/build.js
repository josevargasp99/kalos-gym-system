// Builds the static demo into ../docs (served by GitHub Pages).  Usage: node demo/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true }); fs.writeFileSync(path.join(out, p), s); };
const cp = (from, to) => { fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(out, to)); };
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('Pattern not found: ' + a.slice(0, 60)); return s.replace(a, b); };

fs.rmSync(path.join(out, 'assets'), { recursive: true, force: true });
['card', 'coach', 'owner', 'door'].forEach((d) => fs.rmSync(path.join(out, d), { recursive: true, force: true }));

// ---- the "server": emulator + the real .gs files + seed + glue ----
const gs = fs.readdirSync(path.join(root, 'apps-script')).filter((f) => f.endsWith('.gs')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const server = [rd('demo/gas-emulator.js'), ...gs.map((f) => '/* ---- apps-script/' + f + ' ---- */\n' + rd('apps-script/' + f)), rd('demo/seed.js'), rd('demo/runtime.js')].join('\n;\n');
wr('assets/server.js', server);

const head = (rel) => `<script src="${rel}assets/server.js"></script>\n`;
const demoCfg = `window.KALOS_CONFIG = { API_URL: 'https://demo.invalid/exec', PAGE_URL: location.origin + location.pathname.replace(/[^/]*$/, ''), FRONT_DESK_WHATSAPP: '59170000000', PHYSIO_WHATSAPP: '59170000001', PHYSIO_MAPS_URL: '', VAPID_PUBLIC_KEY: '', PAYMENT_ACCOUNT_HOLDER: 'Demo Account (not real)' };\nwindow.DEMO_HOME = '../';\n`;

// ---- student card (PWA) ----
let card = rd('web/index.html');
card = must(card, '<script src="config.js"></script>', '<script>' + demoCfg + '</script>\n' + head('../'));
card = must(card, "function pushSoportado() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }", 'function pushSoportado() { return false; }   // demo: no push');
card = must(card, "navigator.serviceWorker.register('sw.js').catch(function () {});", '/* demo: no service worker */');
card = card.replace('<link rel="manifest" href="manifest.webmanifest">', '');
wr('card/index.html', card);
['logo.png', 'isotipo-splash.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'].forEach((f) => cp('web/' + f, 'card/' + f));
cp('demo/qr-pago-demo.png', 'card/qr-pago.png');

// ---- instructor app ----
let coach = rd('web/coach.html');
coach = must(coach, '<script src="config.js"></script>', '<script>' + demoCfg + '</script>\n' + head('../'));
coach = coach.replace('<link rel="manifest" href="manifest-coach.webmanifest">', '');
wr('coach/index.html', coach);
['logo.png', 'icon-192.png', 'apple-touch-icon.png', 'favicon-32.png'].forEach((f) => { try { cp('web/' + f, 'coach/' + f); } catch (e) { /* optional */ } });

// ---- owner panel + door screen (Apps Script HTML Service pages) ----
const gasPage = (name, folder) => {
  let h = rd('apps-script/' + name + '.html');
  const inject = '<script>window.DEMO_HOME = "../";</script>\n' + head('../');
  h = h.includes('<head>') ? h.replace('<head>', '<head>\n' + inject) : inject + h;
  wr(folder + '/index.html', h);
};
gasPage('Panel', 'owner');
gasPage('Door', 'door');

// ---- landing ----
wr('index.html', rd('demo/landing.html'));
wr('.nojekyll', '');
console.log('Demo built:', fs.readdirSync(out).join(', '));
