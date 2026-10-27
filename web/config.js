/* Deployment settings. Copy this file, replace the placeholders, and keep your real values out of version control. */
window.KALOS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',     // public Apps Script web app (ends in /exec)
  PAGE_URL: 'https://YOUR_USER.github.io/YOUR_REPO/',                          // where web/ is hosted
  FRONT_DESK_WHATSAPP: '59170000000',                                          // country code + number, digits only
  PHYSIO_WHATSAPP: '59170000001',
  PHYSIO_MAPS_URL: '',                                                         // optional Google Maps link
  VAPID_PUBLIC_KEY: '',                                                        // from tools/generate-vapid-keys.js
  PAYMENT_ACCOUNT_HOLDER: 'Account Holder Name'                                // name shown next to the payment QR
};
