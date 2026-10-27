// Generates a VAPID key pair (P-256) for Web Push.
//   node tools/generate-vapid-keys.js
// - VAPID_PUB  -> Apps Script "Script properties" AND web/config.js (VAPID_PUBLIC_KEY)
// - VAPID_PRIV -> Apps Script "Script properties" ONLY. Never commit it.
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const b = (s) => Buffer.from(s, 'base64url');
const pub = Buffer.concat([Buffer.from([4]), b(jwk.x), b(jwk.y)]).toString('base64url');
console.log('VAPID_PUB =', pub);
console.log('VAPID_PRIV =', jwk.d);
console.log('\nKeep VAPID_PRIV secret: paste it into Project Settings → Script properties and nowhere else.');
