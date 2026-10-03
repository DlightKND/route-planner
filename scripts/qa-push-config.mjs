// Generate independent QA keys without printing private material or credentials.
// Upload edge-secrets.env using an authenticated Supabase CLI or Dashboard.
import {webcrypto,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const contact=process.argv[2];
if(!contact||!/^mailto:[^\s@]+@[^\s@]+$/.test(contact)){
  throw new Error('Usage: node scripts/qa-push-config.mjs mailto:your-email');
}
const folder=resolve('.qa-push');
// An existing folder may hold keys used by a live subscription. Never rotate it.
await mkdir(folder,{mode:0o700});
const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const [publicKey,privateKey,raw]=await Promise.all([
  webcrypto.subtle.exportKey('jwk',keys.publicKey),
  webcrypto.subtle.exportKey('jwk',keys.privateKey),
  webcrypto.subtle.exportKey('raw',keys.publicKey)
]);
const publicValue=Buffer.from(raw).toString('base64url');
const secrets=`PUSH_SECRET=${randomBytes(32).toString('hex')}\nVAPID_KEYS=${JSON.stringify({publicKey,privateKey})}\nVAPID_CONTACT=${contact}\n`;
// Fail if files already exist: do not rotate an existing QA subscription silently.
await writeFile(resolve(folder,'edge-secrets.env'),secrets,{mode:0o600,flag:'wx'});
await writeFile(resolve(folder,'vite.env'),`VITE_VAPID_PUBLIC=${publicValue}\n`,{mode:0o600,flag:'wx'});
console.log('QA configuration created in .qa-push; private keys were not printed.');
