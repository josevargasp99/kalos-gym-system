# Setup guide (about 30 minutes)

1. **Sheet and project.** Create a Google Sheet, open *Extensions → Apps Script*, and add every file from `apps-script/` (`.gs` as Script, `.html` as HTML, `appsscript.json` via *Project settings → Show manifest*).
2. **Initial setup.** Run `setup()` once from the editor and accept the permissions. It creates the sheets and a `Config` tab.
3. **Config values** (tab `Config`, columns *Clave | Valor*): `PAGINA_URL` (where `web/` is hosted), `WEBAPP_URL`, `PLANTILLA_ID` and `CARPETA_PDF_ID` (card template and output folder), `CARPETA_RUTINAS_ID` (routine images), `COACH_CLAVE` (≥ 20 random letters/digits), `PCT_PARTNER` / `PCT_COACH` (revenue split), optional `FERIADOS` (comma-separated `YYYY-MM-DD`).
4. **Push keys.** `node tools/generate-vapid-keys.js`. Put `VAPID_PUB` and `VAPID_PRIV` in *Project settings → Script properties*, and the public key in `web/config.js`. Set `VAPID_SUB` (a `mailto:` contact) in `13-push-notifications.gs`.
5. **Two deployments.** *Deploy → New deployment → Web app*:
   - **Public:** execute as *me*, access *anyone*. Its `/exec` URL goes in `web/config.js` (`API_URL`).
   - **Private:** execute as *me*, access *only myself*. Open this URL for the owner panel; add `?pantalla=puerta` for the door screen.
6. **Front-end.** Edit `web/config.js` (URLs, WhatsApp numbers, payment holder), put your payment QR in `web/qr-pago.png`, and publish `web/` with GitHub Pages.
7. **Reminders.** Run `instalarAlarmas()` once to create the 09:00 and 16:30 triggers.
8. **Door.** Leave an old phone or tablet on the private door URL (`…/exec?pantalla=puerta`) next to the entrance. The QR it shows rotates every minute.
9. **First member.** Use *Nuevo alumno* in the owner panel; print or send the card link.

> Apps Script has quotas (UrlFetch, triggers, execution time). A single gym is far below them.
