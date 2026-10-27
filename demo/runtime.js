/*
 * Demo glue: seeds the in-memory sheet and routes the front-ends' calls to the REAL server code.
 *  - fetch(API_URL…)           -> doGet-style lookups and doPost (card + instructor app)
 *  - google.script.run.<fn>()  -> the owner panel and the door screen
 * Loaded after gas-emulator.js, the apps-script/*.gs files and seed.js.
 */
(function () {
  'use strict';
  var SEEDED = seedDemo();
  window.DEMO_STUDENTS = SEEDED.students;

  /* --- fetch shim --- */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var API = (window.KALOS_CONFIG || {}).API_URL || '';
    if (typeof url === 'string' && API && url.indexOf(API) === 0) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var out;
          try {
            if (!opts || !opts.method || opts.method === 'GET') {
              var q = new URL(url).searchParams;
              out = q.get('format') === 'json' ? consultar_(normalizarId_(q.get('id') || '')) : { ok: false };
            } else {
              out = JSON.parse(doPost({ postData: { contents: opts.body } }).getContent());
            }
          } catch (e) { out = { ok: false, error: 'demo' }; }
          resolve(new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }, 140);
      });
    }
    return realFetch ? realFetch(url, opts) : Promise.reject(new Error('offline'));
  };

  /* --- google.script.run shim --- */
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (t, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          setTimeout(function () {
            try {
              var fn = window[name];
              if (typeof fn !== 'function') throw new Error('Unknown server function: ' + name);
              var r = fn.apply(null, args);
              if (ok) ok(r === undefined ? undefined : JSON.parse(JSON.stringify(r)));
            } catch (e) { if (fail) fail({ message: String(e && e.message || e) }); else if (window.console) console.error(e); }
          }, 160);
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

  /* --- "DEMO" strip on every page --- */
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#111;color:#cfe8d5;font:12px/1.3 system-ui,sans-serif;padding:7px 12px;text-align:center;border-top:1px solid #3CE86B;';
    var a = document.createElement('a');
    a.href = (window.DEMO_HOME || '../'); a.textContent = '← demo home'; a.style.cssText = 'color:#3CE86B;margin-right:10px;text-decoration:none';
    bar.appendChild(a);
    bar.appendChild(document.createTextNode('DEMO · synthetic data only · nothing is saved · the real server code runs in your browser'));
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '36px';
  });
})();
