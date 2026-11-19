import assert from 'node:assert/strict';
import {
  createSovereignAccessKey,
  createSignedQrPass,
  verifySignedQrPass,
  encryptKeyringForTransfer,
  decryptKeyringTransfer,
  mergeKeyrings,
} from '../src/lib/crypto/sovereignKeyring.ts';

let passed = 0;
function ok(label) {
  passed++;
  console.log(`OK    ${label}`);
}

const key = await createSovereignAccessKey('Painel Interno', 'acesso-total');
assert.match(key.fingerprint, /^LULA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
assert.equal(key.revoked, false);
ok('KEYGEN · gera par ECDSA P-256 e fingerprint LULA-XXXX-XXXX-XXXX');

const now = Date.now();
const { token, payload } = await createSignedQrPass({
  key,
  userId: 'user-breno',
  deviceId: 'dev-1',
  ttlSeconds: 120,
  nowMs: now,
});
assert.ok(token.startsWith('exelula-pass:v1.'));
ok('QR PASS · gera token compacto assinado exelula-pass:v1');

const validRes = await verifySignedQrPass(token, { nowMs: now + 5000, consumeNonce: true });
assert.equal(validRes.valid, true);
assert.equal(validRes.payload.appName, 'Painel Interno');
ok('VERIFY · valida assinatura ECDSA P-256 offline sem servidor');

const replayRes = await verifySignedQrPass(token, { nowMs: now + 6000, consumeNonce: true });
assert.equal(replayRes.valid, false);
assert.equal(replayRes.code, 'REPLAY');
ok('ANTI-REPLAY · bloqueia reutilização do mesmo Passe QR');

const fresh = await createSignedQrPass({
  key,
  userId: 'user-breno',
  deviceId: 'dev-1',
  ttlSeconds: 60,
  nowMs: now,
});
const parts = fresh.token.slice('exelula-pass:v1.'.length).split('.');
const decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
decoded.scope = 'admin-falso';
const tamperedToken = `exelula-pass:v1.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${parts[1]}`;
const tamperRes = await verifySignedQrPass(tamperedToken, { nowMs: now + 1000, consumeNonce: false });
assert.equal(tamperRes.valid, false);
assert.equal(tamperRes.code, 'TAMPERED');
ok('INTEGRIDADE · rejeita payload adulterado (TAMPERED)');

const expiredRes = await verifySignedQrPass(fresh.token, { nowMs: now + 120_000, consumeNonce: false });
assert.equal(expiredRes.valid, false);
assert.equal(expiredRes.code, 'EXPIRED');
ok('TTL · rejeita passe expirado (EXPIRED)');

const revokedRes = await verifySignedQrPass(fresh.token, {
  nowMs: now + 1000,
  consumeNonce: false,
  revokedKeyIds: new Set([payload.keyId]),
});
assert.equal(revokedRes.valid, false);
assert.equal(revokedRes.code, 'REVOKED');
ok('CONTROLE · rejeita passe de chave revogada (REVOKED)');

const bundle = await encryptKeyringForTransfer([key], 'senha-soberana-123');
assert.equal(bundle.kind, 'exelula-keyring-bundle');
assert.equal(bundle.keyCount, 1);
const decrypted = await decryptKeyringTransfer(bundle, 'senha-soberana-123');
assert.equal(decrypted.length, 1);
assert.equal(decrypted[0].id, key.id);
await assert.rejects(() => decryptKeyringTransfer(bundle, 'senha-errada'));
ok('COFRE · cifra e decifra com AES-GCM-256 + PBKDF2 250k (rejeita senha errada)');

const merged = mergeKeyrings([{ ...key, revoked: true }], [key]);
assert.equal(merged.length, 1);
assert.equal(merged[0].revoked, true);
ok('SYNC · mergeKeyrings preserva revogação sem duplicar chaves');

const domainKey = await createSovereignAccessKey('Login App Externa', 'acesso-total', 'app.parceiro.br', ['dev-autorizado']);
const domainPass = await createSignedQrPass({
  key: domainKey,
  userId: 'user-breno',
  deviceId: 'dev-autorizado',
  blockedProviders: ['provedor-ruim.com'],
  nowMs: now,
});
const blockedRes = await verifySignedQrPass(domainPass.token, {
  nowMs: now + 1000,
  consumeNonce: false,
  blockedProviders: ['parceiro.br'],
});
assert.equal(blockedRes.valid, false);
assert.equal(blockedRes.code, 'PROVIDER_BLOCKED');
ok('PROVEDORES · bloqueia provedor/subdomínio quando está na blocklist do usuário');

const unauthDeviceRes = await verifySignedQrPass(domainPass.token, {
  nowMs: now + 1000,
  consumeNonce: false,
  authorizedDeviceIds: new Set(['outro-aparelho']),
});
assert.equal(unauthDeviceRes.valid, false);
assert.equal(unauthDeviceRes.code, 'DEVICE_NOT_AUTHORIZED');
ok('DISPOSITIVOS · rejeita passe emitido por dispositivo não autorizado pelo usuário');

const mismatchRes = await verifySignedQrPass(domainPass.token, {
  nowMs: now + 1000,
  consumeNonce: false,
  expectedProvider: 'outro-site.com',
});
assert.equal(mismatchRes.valid, false);
assert.equal(mismatchRes.code, 'PROVIDER_MISMATCH');
ok('ESCOPO DOMÍNIO · rejeita chave restrita quando usada em outro provedor');

console.log(`\n${passed} verificações passaram. Sistema Soberano de Chaves P2P & Passe QR OK.`);
