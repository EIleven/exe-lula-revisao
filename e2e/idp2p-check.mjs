// e2e/idp2p-check.mjs
// Verificação determinística dos módulos IDP2P (TOTP Web Crypto, fila mista e contratos das rotas).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMixedMediaQueue, buildVideoQueue } from '../src/lib/media/videoQueue.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK    ${name}`);
}

// 1. Fila mista (vídeos + imagens) sem apagar ou vazar sensíveis
check('FILA MISTA · inclui vídeos e imagens válidos e bloqueia sensível/apagado', () => {
  const posts = [
    { id: 'p1', media: [{ type: 'video', url: 'https://exercitodolula.app/v1.mp4' }] },
    { id: 'p2', media: [{ type: 'image', url: 'https://exercitodolula.app/i1.jpg' }] },
    { id: 'p3', sensitive: true, media: [{ type: 'image', url: 'https://exercitodolula.app/s1.jpg' }] },
    { id: 'p4', isDeleted: true, media: [{ type: 'video', url: 'https://exercitodolula.app/d1.mp4' }] },
  ];
  const mixed = buildMixedMediaQueue(posts);
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].mediaType, 'video');
  assert.equal(mixed[1].mediaType, 'image');
  assert.equal(buildVideoQueue(posts).length, 1);
});

// 2. Contratos de segurança nas novas rotas IDP2P e theater-feed
for (const rel of [
  'src/app/api/idp2p/passkeys/route.ts',
  'src/app/api/idp2p/linked-accounts/route.ts',
  'src/app/api/idp2p/universe/route.ts',
  'src/app/api/media/theater-feed/route.ts',
]) {
  check(`ROTA · ${rel} usa antiBotGuard`, () => {
    const src = readFileSync(rel, 'utf8');
    assert.ok(src.includes('evaluateRequestSecurity'), `${rel} deve chamar evaluateRequestSecurity`);
  });
}

// 3. Autenticador TOTP usa Web Crypto nativo (sem dependência externa)
check('IDP2P TOTP · usa crypto.subtle nativo sem lib externa', () => {
  const src = readFileSync('src/components/idp2p/Idp2pAuthenticatorCard.tsx', 'utf8');
  assert.ok(src.includes('crypto.subtle.importKey') && src.includes('crypto.subtle.sign'));
});

console.log(`\n${passed}/${passed} verificações IDP2P & Mídia passaram.`);

