#!/usr/bin/env node
/**
 * Identidade E2EE, chaveiro, backup cifrado e histórico P2P local, sem navegador e sem Firebase:
 *   node e2e/e2ee-check.mjs        (ou: npm run e2e:e2ee)
 *
 * O defeito que esta suíte fecha: o código antigo gerava um par de chaves em CADA aparelho e sobrescrevia a chave pública
 * da conta. Com dois aparelhos, a chave publicada alternava a cada acesso (um cabo de guerra), o que chegava no intervalo
 * só abria no aparelho dono da chave daquele momento, e trocar de navegador deixava o histórico ilegível. Aqui DOIS
 * aparelhos da mesma conta (dois armazenamentos, uma chave publicada) provam que:
 *   - aparelho sem chave NÃO gera outra nem publica: fica em `needs-restore` até a pessoa escolher;
 *   - restaurar o backup cifrado adota a identidade da conta; "criar nova" é ato explícito e o outro aparelho NÃO reage
 *     sobrescrevendo;
 *   - girar a chave mantém o histórico (e o que um contato cifrou para a chave velha) legível;
 *   - o payload novo continua legível pelo código ANTIGO (compatibilidade durante a transição);
 *   - o arquivo de backup é cifrado com a senha, e uma importação hostil (outra conta, chave adulterada, KDF absurdo,
 *     mensagens com formato errado) é recusada sem gravar nada.
 * Sai com código 1 se algo falhar.
 */
import {
  activeKey, canonicalPublicJson, cleanPrivateJwk, cleanPublicJwk, fingerprint, findKeyByPublic, generateKeyEntry, keyIdOf,
  mergeKeyrings, migrateLegacyPair, newKeyring, rotateKeyring, safetyNumber, validateKeyring, MAX_KEYS_IN_RING,
} from '../src/lib/crypto/e2eeKeyring.ts';
import { createIdentityService, KEY_PREFIX_V1, KEY_PREFIX_V2 } from '../src/lib/crypto/e2eeIdentity.ts';
import {
  describeBundleError, readBundle, sealBundle, BUNDLE_FORMAT, MAX_BUNDLE_CHARS, MAX_KDF_ITERATIONS,
} from '../src/lib/p2p/p2pBundle.ts';
import {
  clearAll, deleteMessage, exportAll, importConversations, loadConversation, mergeConversation, sanitizeStored, saveMessage, stats,
  MAX_LOCAL_MESSAGES, MSGS_PREFIX,
} from '../src/lib/p2p/p2pLocalStore.ts';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};

class MemStorage {
  constructor(limiteBytes = Infinity) { this.m = new Map(); this.limite = limiteBytes; this.bloqueado = false; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    if (this.bloqueado) throw new Error('SecurityError');
    const outros = [...this.m.entries()].filter(([x]) => x !== k).reduce((s, [, val]) => s + val.length, 0);
    if (outros + v.length > this.limite) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(k); }
}

const publicadas = () => {
  const mapa = new Map();
  const chamadas = [];
  return { mapa, chamadas, async get(u) { return mapa.get(u) ?? null; }, async set(u, v) { chamadas.push(v); mapa.set(u, v); } };
};
const tempo = { t: 1_800_000_000_000 };
const aparelho = (pub, storage = new MemStorage()) => ({ storage, svc: createIdentityService({ storage, published: pub, now: () => tempo.t++ }) });
const pontoDe = (json) => { const j = JSON.parse(json); return `${j.x}.${j.y}`; };
const IT = 100_000; // mínimo aceito pelo leitor; rápido o bastante para a suíte

// ═════════════ A. Primitivas do chaveiro ═════════════
const k1 = await generateKeyEntry(1);
const k2 = await generateKeyEntry(2);
confere('CHAVEIRO · cada chave tem id estável derivado da pública, e duas chaves nunca coincidem', k1.id === await keyIdOf(k1.publicJwk) && k1.id !== k2.id && k1.id.length === 22, `${k1.id} ${k2.id}`);
confere('CHAVEIRO · só P-256 válida entra (outra curva, coordenada curta, tipo errado são recusados; campo extra é descartado)',
  cleanPublicJwk({ ...k1.publicJwk, ext: true, key_ops: [], foo: 1 }) !== null && !('foo' in cleanPublicJwk({ ...k1.publicJwk, foo: 1 })) && cleanPublicJwk({ ...k1.publicJwk, crv: 'P-384' }) === null
    && cleanPublicJwk({ ...k1.publicJwk, x: 'curta' }) === null && cleanPublicJwk({ ...k1.publicJwk, kty: 'RSA' }) === null && cleanPrivateJwk(k1.publicJwk) === null && cleanPrivateJwk(k1.privateJwk) !== null, 'validação frouxa');
const ring = newKeyring(k1);
confere('CHAVEIRO · um chaveiro válido passa na validação', (await validateKeyring(JSON.parse(JSON.stringify(ring)))) !== null, 'recusou o próprio chaveiro');
const adulterado = JSON.parse(JSON.stringify(ring)); adulterado.keys[0].id = 'x'.repeat(22);
const trocado = JSON.parse(JSON.stringify(ring)); trocado.keys[0].privateJwk = { ...k2.privateJwk, x: k1.privateJwk.x, y: k1.privateJwk.y };
const semAtiva = JSON.parse(JSON.stringify(ring)); semAtiva.activeId = 'nao-existe';
const duplicado = JSON.parse(JSON.stringify(ring)); duplicado.keys.push(duplicado.keys[0]);
const cheio = { v: 2, activeId: k1.id, keys: Array.from({ length: MAX_KEYS_IN_RING + 1 }, () => ring.keys[0]) };
const resultados = await Promise.all([adulterado, trocado, semAtiva, duplicado, cheio, { v: 2, activeId: 'a', keys: [] }, null, 'x', { v: 1 }].map((c) => validateKeyring(c)));
confere('CHAVEIRO · id adulterado, `d` que não é do ponto, ativa inexistente, id repetido, chaveiro cheio ou vazio: recusados', resultados.every((r) => r === null), JSON.stringify(resultados.map((r) => r === null)));

const velho = { v: 1, publicJwk: { ...k1.publicJwk, ext: true, key_ops: [] }, privateJwk: { ...k1.privateJwk, ext: true, key_ops: ['deriveKey'] } };
const migrado = await migrateLegacyPair(velho, 5);
confere('CHAVEIRO · o par do formato antigo migra para um chaveiro de uma chave, a ativa, com o mesmo id', migrado && migrado.activeId === k1.id && migrado.keys.length === 1, JSON.stringify(migrado)?.slice(0, 80));
confere('CHAVEIRO · par antigo adulterado (coordenadas de uma chave, `d` de outra) NÃO migra', (await migrateLegacyPair({ v: 1, publicJwk: k1.publicJwk, privateJwk: { ...k2.privateJwk, x: k1.publicJwk.x, y: k1.publicJwk.y } }, 5)) === null, 'migrou lixo');
const textoAntigo = JSON.stringify({ ...k1.publicJwk, ext: true, key_ops: [] });
confere('CHAVEIRO · achar a chave pela pública compara o PONTO, não o texto (o formato publicado pelo app antigo tem campos a mais)', findKeyByPublic(ring, textoAntigo)?.id === k1.id && findKeyByPublic(ring, canonicalPublicJson(k1.publicJwk))?.id === k1.id && findKeyByPublic(ring, canonicalPublicJson(k2.publicJwk)) === null, 'não achou');
const girado = await rotateKeyring(ring, 10);
confere('CHAVEIRO · girar cria a nova ativa e aposenta a anterior (que continua no chaveiro)', girado.keys.length === 2 && girado.activeId !== k1.id && girado.keys.find((k) => k.id === k1.id).retiredAt === 10 && girado.keys.find((k) => k.id === girado.activeId).retiredAt === undefined, JSON.stringify(girado.keys.map((k) => [k.id.slice(0, 4), k.retiredAt])));
const unido = mergeKeyrings(newKeyring(k1), newKeyring(k2));
confere('CHAVEIRO · unir mantém as duas e fica com a ativa de quem já estava aqui (restaurar um backup não rouba a identidade do aparelho)', unido.keys.length === 2 && unido.activeId === k1.id && unido.keys.find((k) => k.id === k2.id).retiredAt !== undefined, JSON.stringify(unido.keys.map((k) => [k.id.slice(0, 4), k.retiredAt])));
confere('CHAVEIRO · ...e adota a chave pedida (a que a conta publica) quando se indica', mergeKeyrings(newKeyring(k1), newKeyring(k2), k2.id).activeId === k2.id, 'não adotou');
const fp1 = await fingerprint(k1.publicJwk);
confere('CHAVEIRO · impressão digital: 5 grupos de 5 dígitos, igual para o mesmo ponto em qualquer formato, diferente para outra chave', /^(\d{5} ){4}\d{5}$/.test(fp1) && fp1 === await fingerprint(textoAntigo) && fp1 !== await fingerprint(k2.publicJwk), fp1);
const s12 = await safetyNumber(k1.publicJwk, k2.publicJwk);
confere('CHAVEIRO · número de segurança: o mesmo para os dois lados, e muda se qualquer chave mudar', s12 === await safetyNumber(k2.publicJwk, k1.publicJwk) && s12 !== await safetyNumber(k1.publicJwk, (await generateKeyEntry(3)).publicJwk) && /^(\d{5} ){5}\d{5}$/.test(s12), s12);

// ═════════════ B. Um aparelho ═════════════
{
  const pub = publicadas();
  const A = aparelho(pub);
  const st = await A.svc.status('alice');
  confere('IDENTIDADE · primeiro aparelho da conta: cria a chave e a publica (uma vez)', st.status === 'ready' && st.created === true && pub.chamadas.length === 1 && pontoDe(pub.mapa.get('alice')) === pontoDe(st.publicKeyJson), JSON.stringify(st).slice(0, 100));
  const A2 = aparelho(pub, A.storage); // outra aba/sessão do mesmo aparelho
  const st2 = await A2.svc.status('alice');
  confere('IDENTIDADE · mesmo aparelho, outra sessão: pronto, sem criar nem publicar de novo', st2.status === 'ready' && st2.created === false && st2.keyId === st.keyId && pub.chamadas.length === 1, `publicações=${pub.chamadas.length}`);
  confere('IDENTIDADE · o chaveiro novo e o espelho no formato antigo ficam gravados (abas antigas continuam funcionando)', A.storage.getItem(`${KEY_PREFIX_V2}alice`) && JSON.parse(A.storage.getItem(`${KEY_PREFIX_V1}alice`)).v === 1, 'faltou gravação');
}

// ═════════════ C. Cifrar e decifrar entre pessoas ═════════════
{
  const pub = publicadas();
  const alice = aparelho(pub); const bob = aparelho(pub);
  const sa = await alice.svc.status('alice'); const sb = await bob.svc.status('bob');
  const p = await alice.svc.encrypt('olá, Bob — segredo', 'alice', sb.publicKeyJson);
  confere('CIFRA · o texto cifrado não contém o texto claro, e o payload leva as duas chaves públicas', p && !JSON.stringify(p).includes('segredo') && p.senderPublicKey && p.recipientPublicKey && p.alg === 'ECDH-P256-AES-GCM', JSON.stringify(p)?.slice(0, 80));
  const dB = await bob.svc.decrypt(p, 'bob', false, sa.publicKeyJson);
  const dA = await alice.svc.decrypt(p, 'alice', true, sb.publicKeyJson);
  confere('CIFRA · o destinatário decifra, e o remetente também (lê o que ele mesmo mandou)', dB.ok && dB.text === 'olá, Bob — segredo' && dA.ok && dA.text === 'olá, Bob — segredo', JSON.stringify([dB, dA]));
  const adulteradoP = { ...p, ciphertext: p.ciphertext.slice(0, -4) + (p.ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  confere('CIFRA · texto cifrado adulterado não abre (GCM autentica)', (await bob.svc.decrypt(adulteradoP, 'bob', false, sa.publicKeyJson)).ok === false, 'abriu adulterado');
  const carol = aparelho(pub); await carol.svc.status('carol');
  const dC = await carol.svc.decrypt(p, 'carol', false, sa.publicKeyJson);
  confere('CIFRA · um terceiro não abre a mensagem dos outros dois', dC.ok === false, JSON.stringify(dC));
  const proprio = await alice.svc.encrypt('lembrete', 'alice', sa.publicKeyJson); // "Mensagens Salvas": cifra para si mesma
  const dP = await alice.svc.decrypt(proprio, 'alice', true, undefined);
  confere('CIFRA · "Mensagens Salvas" (cifrar para a própria chave) abre para quem escreveu', dP.ok && dP.text === 'lembrete', JSON.stringify(dP));
  confere('CIFRA · sem a chave pública do destinatário, ou com texto vazio ou gigante, NÃO cifra (devolve nulo; quem chama decide, nunca vira texto claro por acidente)',
    (await alice.svc.encrypt('x', 'alice', null)) === null && (await alice.svc.encrypt('x', 'alice', 'lixo')) === null && (await alice.svc.encrypt('', 'alice', sb.publicKeyJson)) === null && (await alice.svc.encrypt('a'.repeat(20_001), 'alice', sb.publicKeyJson)) === null, 'cifrou algo inválido');
}

// ═════════════ D. Dois aparelhos da mesma conta (o defeito original) ═════════════
{
  const pub = publicadas();
  const bobPub = publicadas();
  const bob = aparelho(bobPub); const sbob = await bob.svc.status('bob');
  const A = aparelho(pub); const B = aparelho(pub); // dois aparelhos da Alice
  const sa = await A.svc.status('alice');
  const publicadaAntes = pub.mapa.get('alice');
  const estadoB = await B.svc.status('alice');
  confere('DOIS APARELHOS · o aparelho SEM chave não gera outra nem publica: fica em needs-restore', estadoB.status === 'needs-restore' && B.storage.length === 0 && pub.mapa.get('alice') === publicadaAntes && pub.chamadas.length === 1, JSON.stringify(estadoB));
  confere('DOIS APARELHOS · ...e não cifra (nunca cai para texto claro por falta de chave)', (await B.svc.encrypt('oi', 'alice', sbob.publicKeyJson)) === null, 'cifrou sem identidade');
  const msgDoBob = await bob.svc.encrypt('mensagem do Bob para a Alice', 'bob', sa.publicKeyJson);
  confere('DOIS APARELHOS · o aparelho A abre; o B (sem chave) responde "missing-key", sem estourar', (await A.svc.decrypt(msgDoBob, 'alice', false, sbob.publicKeyJson)).ok === true && (await B.svc.decrypt(msgDoBob, 'alice', false, sbob.publicKeyJson)).reason === 'missing-key', 'resposta inesperada');
  // acessos repetidos de A e B não fazem a chave publicada oscilar (era o cabo de guerra)
  for (let i = 0; i < 3; i++) { A.svc.invalidate('alice'); B.svc.invalidate('alice'); await A.svc.status('alice'); await B.svc.status('alice'); }
  confere('DOIS APARELHOS · acessos repetidos dos dois não fazem a chave publicada oscilar (antes: um cabo de guerra a cada acesso)', pub.mapa.get('alice') === publicadaAntes && pub.chamadas.length === 1, `publicações=${pub.chamadas.length}`);

  const chaveiroA = await A.svc.exportKeyring('alice');
  const restaurado = await B.svc.importKeyring('alice', chaveiroA);
  confere('RESTAURAR · importar o chaveiro do aparelho A adota a identidade da conta no B (mesma chave, sem republicar)', restaurado.status === 'ready' && restaurado.keyId === sa.keyId && pub.chamadas.length === 1, JSON.stringify(restaurado));
  confere('RESTAURAR · o B passa a abrir o que já havia chegado', (await B.svc.decrypt(msgDoBob, 'alice', false, sbob.publicKeyJson)).ok === true, 'não abriu');

  // "criar nova identidade" é ato explícito num aparelho; o outro NÃO reage sobrescrevendo
  const C = aparelho(pub); // terceiro aparelho, sem chave
  const novo = await C.svc.createNewIdentity('alice');
  confere('NOVA IDENTIDADE · é uma escolha explícita: o aparelho cria e PUBLICA outra chave', novo.status === 'ready' && novo.keyId !== sa.keyId && pontoDe(pub.mapa.get('alice')) === pontoDe(novo.publicKeyJson) && pub.chamadas.length === 2, JSON.stringify(novo).slice(0, 100));
  A.svc.invalidate('alice');
  const aDepois = await A.svc.status('alice');
  confere('NOVA IDENTIDADE · o aparelho A NÃO reage sobrescrevendo a chave nova (fica em needs-restore até a pessoa decidir)', aDepois.status === 'needs-restore' && pub.chamadas.length === 2, JSON.stringify(aDepois));
  confere('NOVA IDENTIDADE · o histórico antigo continua abrindo no A (a decifragem usa o chaveiro, não o estado)', (await A.svc.decrypt(msgDoBob, 'alice', false, sbob.publicKeyJson)).ok === true, 'perdeu o histórico');
  const msgNova = await bob.svc.encrypt('depois da troca', 'bob', novo.publicKeyJson);
  confere('NOVA IDENTIDADE · o que chega cifrado para a chave nova só abre onde ela está (C abre; A, sem ela, "key-not-in-keyring")', (await C.svc.decrypt(msgNova, 'alice', false, sbob.publicKeyJson)).ok === true && (await A.svc.decrypt(msgNova, 'alice', false, sbob.publicKeyJson)).reason === 'key-not-in-keyring', 'comportamento inesperado');
  const ringC = await C.svc.exportKeyring('alice');
  await A.svc.importKeyring('alice', ringC);
  const aFinal = await A.svc.status('alice');
  confere('NOVA IDENTIDADE · levar o chaveiro do C ao A: o A adota a chave publicada (a nova) e mantém a antiga para o histórico', aFinal.status === 'ready' && aFinal.keyId === novo.keyId && (await A.svc.decrypt(msgNova, 'alice', false, sbob.publicKeyJson)).ok === true && (await A.svc.decrypt(msgDoBob, 'alice', false, sbob.publicKeyJson)).ok === true, JSON.stringify(aFinal).slice(0, 100));
}

// ═════════════ E. Rotação ═════════════
{
  const pub = publicadas();
  const bobPub = publicadas();
  const bob = aparelho(bobPub); const sbob = await bob.svc.status('bob');
  const A = aparelho(pub); const sa = await A.svc.status('alice');
  const antiga = await bob.svc.encrypt('cifrada para a chave ANTIGA da Alice', 'bob', sa.publicKeyJson); // o Bob ainda tem a chave velha em cache
  const girou = await A.svc.rotate('alice');
  confere('ROTAÇÃO · a chave nova passa a ser a publicada, e a anterior fica no chaveiro', girou.status === 'ready' && girou.keyId !== sa.keyId && pontoDe(pub.mapa.get('alice')) === pontoDe(girou.publicKeyJson) && (await A.svc.exportKeyring('alice')).keys.length === 2, JSON.stringify(girou).slice(0, 80));
  confere('ROTAÇÃO · o que um contato cifrou para a chave ANTIGA ainda abre depois da troca', (await A.svc.decrypt(antiga, 'alice', false, sbob.publicKeyJson)).ok === true, 'perdeu o histórico');
  const nova = await bob.svc.encrypt('para a chave nova', 'bob', girou.publicKeyJson);
  confere('ROTAÇÃO · e o que é cifrado para a nova abre também', (await A.svc.decrypt(nova, 'alice', false, sbob.publicKeyJson)).ok === true, 'não abriu a nova');
  const enviadaAntes = await A.svc.encrypt('minha, na chave nova', 'alice', sbob.publicKeyJson);
  confere('ROTAÇÃO · a mensagem que a própria Alice mandou na chave antiga ainda abre para ela', (await A.svc.decrypt(await (async () => { const v = await aparelho(publicadas()).svc; return antiga; })(), 'alice', false, sbob.publicKeyJson)).ok === true && (await A.svc.decrypt(enviadaAntes, 'alice', true, sbob.publicKeyJson)).ok === true, 'não abriu');

  // rotação interrompida: a gravação local acontece, a publicação falha; no acesso seguinte termina sozinha
  const pub2 = publicadas(); const D = aparelho(pub2); await D.svc.status('dora');
  const anterior = pub2.mapa.get('dora');
  const setOriginal = pub2.set; pub2.set = async () => { throw new Error('sem rede'); };
  let lancou = false; try { await D.svc.rotate('dora'); } catch { lancou = true; }
  pub2.set = setOriginal; D.svc.invalidate('dora');
  const depois = await D.svc.status('dora');
  confere('ROTAÇÃO · se a publicação falhar no meio, o erro aparece e o acesso seguinte termina o serviço (publica a ativa)', lancou && depois.status === 'ready' && pontoDe(pub2.mapa.get('dora')) === pontoDe(depois.publicKeyJson) && pub2.mapa.get('dora') !== anterior, `lancou=${lancou} ${JSON.stringify(depois).slice(0, 60)}`);
}

// ═════════════ F. Transição: o que o app antigo gravou e como ele lê o novo ═════════════
{
  const pub = publicadas();
  const par = await generateKeyEntry(1);
  const storage = new MemStorage();
  // exatamente o que o app antigo guardava e publicava
  storage.setItem(`${KEY_PREFIX_V1}ana`, JSON.stringify({ v: 1, publicJwk: { ...par.publicJwk, ext: true, key_ops: [] }, privateJwk: { ...par.privateJwk, ext: true, key_ops: ['deriveKey'] } }));
  pub.mapa.set('ana', JSON.stringify({ ...par.publicJwk, ext: true, key_ops: [] }));
  const A = aparelho(pub, storage);
  const st = await A.svc.status('ana');
  confere('TRANSIÇÃO · quem só tem o formato antigo migra sozinho, mantém a MESMA chave e não republica (a publicada bate pelo ponto)', st.status === 'ready' && st.keyId === par.id && pub.chamadas.length === 0 && storage.getItem(`${KEY_PREFIX_V2}ana`) !== null, JSON.stringify(st).slice(0, 90));
  const bobPub = publicadas(); const bob = aparelho(bobPub); const sbob = await bob.svc.status('bob');
  const paraAna = await bob.svc.encrypt('antes da migração', 'bob', pub.mapa.get('ana'));
  confere('TRANSIÇÃO · o que chega cifrado para o texto publicado no formato antigo abre', (await A.svc.decrypt(paraAna, 'ana', false, sbob.publicKeyJson)).ok === true, 'não abriu');
  // o código ANTIGO lendo um payload NOVO (decifragem como era antes: pública do payload + par guardado)
  const antigoDecifra = async (payload, stored, isSender, peerKeyJson) => {
    const subtle = globalThis.crypto.subtle;
    const peerKey = isSender ? payload.recipientPublicKey || peerKeyJson : payload.senderPublicKey || peerKeyJson;
    const j = JSON.parse(peerKey);
    if (!(j && j.kty === 'EC' && j.crv === 'P-256' && j.x && j.y)) return null;
    const priv = await subtle.importKey('jwk', stored.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const pubk = await subtle.importKey('jwk', j, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const aes = await subtle.deriveKey({ name: 'ECDH', public: pubk }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: b(payload.iv) }, aes, b(payload.ciphertext)));
  };
  const doBob = await bob.svc.encrypt('escrito pelo código novo', 'bob', pub.mapa.get('ana'));
  const lido = await antigoDecifra(doBob, JSON.parse(storage.getItem(`${KEY_PREFIX_V1}ana`)), false, sbob.publicKeyJson).catch(() => null);
  confere('TRANSIÇÃO · um aparelho com o código ANTIGO ainda decifra o que o código novo cifrou (mesmo algoritmo, mesmo segredo derivado)', lido === 'escrito pelo código novo', String(lido));
}

// ═════════════ G. Armazenamento indisponível ═════════════
{
  const pub = publicadas();
  const storage = new MemStorage(); storage.bloqueado = true;
  const A = aparelho(pub, storage);
  const st = await A.svc.status('eva');
  confere('ARMAZENAMENTO · se a chave não puder ser guardada, NÃO é publicada (uma chave que se perde no próximo recarregamento deixaria a conta ilegível)', st.status === 'storage-unavailable' && pub.chamadas.length === 0 && !pub.mapa.has('eva'), JSON.stringify(st));
}

// ═════════════ H. Arquivo de portabilidade ═════════════
{
  const pub = publicadas(); const A = aparelho(pub); await A.svc.status('alice');
  const keyring = await A.svc.exportKeyring('alice');
  const idMsg = (n) => `p2p_18000000${String(n).padStart(5, '0')}_ab${n}`;
  const conv = 'aliceAAAAAA_bobBBBBBBB';
  const content = {
    format: BUNDLE_FORMAT, version: 2, exportedAt: new Date().toISOString(), userId: 'alice',
    preferences: { defaultZeroDbOnly: true, autoConnectP2p: true, autoConnectScope: 'mutual', relayOnly: false },
    e2eeKeyring: keyring,
    p2p: { conversations: { [conv]: [{ id: idMsg(1), senderId: 'alice', text: 'oi', createdAt: new Date(Date.now() - 1000).toISOString() }] } },
  };
  let curta = null; try { await sealBundle(content, '1234567'); } catch (e) { curta = e.message; }
  confere('ARQUIVO · senha curta é recusada na exportação', curta === 'senha-curta', String(curta));
  const arq = await sealBundle(content, 'uma senha longa e boa', { iterations: IT });
  confere('ARQUIVO · o arquivo é cifrado: não contém a chave privada, o texto das mensagens, o id da conta nem o chaveiro em claro', !arq.includes(keyring.keys[0].privateJwk.d) && !arq.includes('"oi"') && !arq.includes('alice') && !arq.includes('privateJwk') && JSON.parse(arq).encrypted === true, 'vazou conteúdo');
  const ok = await readBundle(arq, { userId: 'alice', passphrase: 'uma senha longa e boa', minIterations: IT });
  confere('ARQUIVO · com a senha certa, volta idêntico (chaveiro, preferências e mensagens)', ok.ok && ok.legacy === false && ok.content.e2eeKeyring.activeId === keyring.activeId && ok.content.p2p.conversations[conv].length === 1 && ok.content.preferences.defaultZeroDbOnly === true, JSON.stringify(ok).slice(0, 100));
  confere('ARQUIVO · senha errada ou ausente é recusada, cada uma com o seu motivo',
    (await readBundle(arq, { userId: 'alice', passphrase: 'senha errada aqui', minIterations: IT })).error === 'senha-incorreta' && (await readBundle(arq, { userId: 'alice', minIterations: IT })).error === 'senha-necessaria', 'motivo errado');
  const env = JSON.parse(arq);
  const dado = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0)); dado[Math.floor(dado.length / 2)] ^= 1;
  const adult = { ...env, data: btoa(String.fromCharCode(...dado)) };
  const trocaIter = { ...env, kdf: { ...env.kdf, iterations: env.kdf.iterations + 1 } };
  confere('ARQUIVO · um bit alterado no conteúdo, ou nos parâmetros da derivação, é detectado (autenticado)', (await readBundle(JSON.stringify(adult), { userId: 'alice', passphrase: 'uma senha longa e boa', minIterations: IT })).error === 'senha-incorreta' && (await readBundle(JSON.stringify(trocaIter), { userId: 'alice', passphrase: 'uma senha longa e boa', minIterations: IT })).error === 'senha-incorreta', 'aceitou adulterado');
  confere('ARQUIVO · backup de OUTRA conta é recusado (mesmo com a senha certa)', (await readBundle(arq, { userId: 'bob', passphrase: 'uma senha longa e boa', minIterations: IT })).error === 'outra-conta', 'aceitou outra conta');
  const absurdo = { ...env, kdf: { ...env.kdf, iterations: MAX_KDF_ITERATIONS + 1 } };
  const fraco = { ...env, kdf: { ...env.kdf, iterations: 1000 } };
  confere('ARQUIVO · custo de derivação fora da faixa é recusado (um valor gigante travaria o navegador; um baixo enfraqueceria a senha)', (await readBundle(JSON.stringify(absurdo), { userId: 'alice', passphrase: 'x' })).error === 'kdf' && (await readBundle(JSON.stringify(fraco), { userId: 'alice', passphrase: 'x' })).error === 'kdf', 'aceitou KDF fora da faixa');
  confere('ARQUIVO · lixo, arquivo gigante e versão futura têm motivo próprio',
    (await readBundle('nao e json', { userId: 'alice' })).error === 'json' && (await readBundle('x'.repeat(MAX_BUNDLE_CHARS + 1), { userId: 'alice' })).error === 'tamanho'
      && (await readBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 9 }), { userId: 'alice' })).error === 'versao' && (await readBundle('[]', { userId: 'alice' })).error === 'formato', 'motivo errado');
  confere('ARQUIVO · todo erro tem texto para a pessoa', ['tamanho', 'json', 'formato', 'versao', 'senha-necessaria', 'senha-incorreta', 'outra-conta', 'kdf', 'invalido'].every((e) => describeBundleError(e).length > 10), 'faltou texto');

  // conteúdo hostil DENTRO de um arquivo cifrado com a senha certa (um amigo mal-intencionado mandou o arquivo)
  const hostil = JSON.parse(JSON.stringify(content));
  hostil.p2p.conversations['__proto__'] = [{ id: idMsg(2), senderId: 'x', text: 'y', createdAt: new Date().toISOString() }];
  hostil.p2p.conversations['conversa-invalida'] = [{ id: idMsg(3), senderId: 'x', text: 'y', createdAt: new Date().toISOString() }];
  hostil.p2p.conversations[conv].push({ id: 'qualquer-coisa', senderId: 'bob', text: 'id inválido', createdAt: new Date().toISOString() });
  hostil.p2p.conversations[conv].push({ id: idMsg(4), senderId: 'bob', text: 'x'.repeat(9000), createdAt: new Date().toISOString() });
  hostil.p2p.conversations[conv].push({ id: idMsg(5), senderId: 'bob', text: 'data do século 19', createdAt: '1850-01-01T00:00:00Z' });
  hostil.p2p.conversations[conv].push({ id: idMsg(6), senderId: 'bob', text: 'campo extra', createdAt: new Date().toISOString(), sender: { email: 'a@b.c' }, html: '<img onerror=1>' });
  const lido = await readBundle(await sealBundle(hostil, 'uma senha longa e boa', { iterations: IT }), { userId: 'alice', passphrase: 'uma senha longa e boa', minIterations: IT });
  const lista = lido.ok ? lido.content.p2p.conversations[conv] : [];
  confere('ARQUIVO · mensagem com id inválido, texto gigante ou data absurda é descartada; conversa de id inválido ou "__proto__" não entra',
    lido.ok && Object.keys(lido.content.p2p.conversations).join() === conv && lista.map((m) => m.id).join() === [idMsg(1), idMsg(6)].join(), JSON.stringify(lista.map((m) => m.id)));
  confere('ARQUIVO · campo desconhecido (perfil embutido, HTML) não atravessa', lista.find((m) => m.id === idMsg(6)) && !('sender' in lista.find((m) => m.id === idMsg(6))) && !('html' in lista.find((m) => m.id === idMsg(6))), 'campo extra passou');
  const chaveAdulterada = JSON.parse(JSON.stringify(content)); chaveAdulterada.e2eeKeyring.keys[0].publicJwk.x = keyring.keys[0].publicJwk.y;
  confere('ARQUIVO · chaveiro adulterado dentro do arquivo é recusado (nada é gravado)', (await readBundle(await sealBundle(chaveAdulterada, 'uma senha longa e boa', { iterations: IT }), { userId: 'alice', passphrase: 'uma senha longa e boa', minIterations: IT })).error === 'invalido', 'aceitou chaveiro adulterado');

  // formato antigo (v1): JSON em claro com a chave privada
  const v1 = { version: 1, exportedAt: 'x', userId: 'alice', preferences: { defaultZeroDbOnly: true, autoConnectP2p: false }, e2eeKeyPair: { v: 1, publicJwk: keyring.keys[0].publicJwk, privateJwk: keyring.keys[0].privateJwk }, conversations: { [conv]: [{ id: idMsg(1), senderId: 'alice', text: 'velho', createdAt: new Date(Date.now() - 5000).toISOString(), sender: { id: 'alice', email: 'segredo@x.com' } }] } };
  const lv1 = await readBundle(JSON.stringify(v1), { userId: 'alice' });
  confere('ARQUIVO · o backup antigo (v1, em claro) ainda é lido: chave migrada, mensagens limpas (o perfil embutido some), e marcado como antigo', lv1.ok && lv1.legacy === true && lv1.content.e2eeKeyring.activeId === keyring.activeId && !('sender' in lv1.content.p2p.conversations[conv][0]) && lv1.content.preferences.autoConnectP2p === false && lv1.content.preferences.autoConnectScope === 'mutual', JSON.stringify(lv1).slice(0, 100));
  const v1ruim = { ...v1, e2eeKeyPair: { v: 1, publicJwk: keyring.keys[0].publicJwk, privateJwk: { ...keyring.keys[0].privateJwk, d: keyring.keys[0].privateJwk.x } } };
  confere('ARQUIVO · backup antigo com chave inconsistente ou de outra conta é recusado', (await readBundle(JSON.stringify(v1ruim), { userId: 'alice' })).error === 'invalido' && (await readBundle(JSON.stringify(v1), { userId: 'bob' })).error === 'outra-conta', 'aceitou');
}

// ═════════════ I. Histórico local ═════════════
{
  const st = new MemStorage();
  const idMsg = (n) => `p2p_18000000${String(n).padStart(5, '0')}_ab${n}`;
  const conv = 'aliceAAAAAA_bobBBBBBBB';
  const msg = (n, extra = {}) => ({ id: idMsg(n), senderId: 'bobBBBBBBB', text: `m${n}`, createdAt: new Date(Date.now() - (1000 - n) * 1000).toISOString(), ...extra });
  const r1 = saveMessage(st, 'aliceAAAAAA', conv, msg(1, { sender: { id: 'x', email: 'segredo@x.com' } }));
  confere('HISTÓRICO · grava só o que a mensagem é (o perfil embutido do remetente, com e-mail, não vai para o armazenamento)', r1.inserted && !st.getItem(`${MSGS_PREFIX}aliceAAAAAA:${conv}`).includes('segredo') && !st.getItem(`${MSGS_PREFIX}aliceAAAAAA:${conv}`).includes('"sender"'), st.getItem(`${MSGS_PREFIX}aliceAAAAAA:${conv}`));
  confere('HISTÓRICO · a mesma mensagem duas vezes não duplica (e o aviso de repetida vem como inserted:false)', saveMessage(st, 'aliceAAAAAA', conv, msg(1)).inserted === false && loadConversation(st, 'aliceAAAAAA', conv).length === 1, 'duplicou');
  confere('HISTÓRICO · mensagem inválida não entra', saveMessage(st, 'aliceAAAAAA', conv, { id: 'x', senderId: 'a', text: 'y', createdAt: new Date().toISOString() }).inserted === false && saveMessage(st, 'aliceAAAAAA', 'conversa-ruim', msg(2)).inserted === false, 'entrou lixo');
  // o histórico ANTIGO guardava o texto claro junto do cifrado; nada disso se perde
  const e2ee = { v: 1, alg: 'ECDH-P256-AES-GCM', senderPublicKey: '{"a":1}', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAA' };
  st.setItem(`${MSGS_PREFIX}aliceAAAAAA:${conv}`, JSON.stringify([msg(7, { text: 'claro guardado', e2ee, sender: { id: 'x' } })]));
  const antigo = loadConversation(st, 'aliceAAAAAA', conv)[0];
  confere('HISTÓRICO · o registro antigo (texto claro + cifrado) é preservado: é a única forma de ler a mensagem se a chave se perdeu', antigo.text === 'claro guardado' && antigo.e2ee && !('sender' in antigo), JSON.stringify(antigo).slice(0, 90));
  // cota cheia
  const apertado = new MemStorage(2500);
  let inseridas = 0;
  for (let i = 1; i <= 60; i++) if (saveMessage(apertado, 'aliceAAAAAA', conv, msg(i, { text: 'x'.repeat(120) })).inserted) inseridas++;
  const guardadas = loadConversation(apertado, 'aliceAAAAAA', conv);
  confere('HISTÓRICO · cota cheia: a mensagem NOVA sempre fica (as mais antigas é que saem), em vez de falhar calada', inseridas === 60 && guardadas.some((m) => m.id === idMsg(60)) && guardadas.length < 60, `inseridas=${inseridas}, guardadas=${guardadas.length}`);
  const muitas = Array.from({ length: 260 }, (_, i) => sanitizeStored(msg(i + 1)));
  const unida = mergeConversation([], muitas);
  confere('HISTÓRICO · a união ordena por data e mantém as 200 MAIS RECENTES', unida.length === MAX_LOCAL_MESSAGES && unida[unida.length - 1].id === idMsg(260) && unida[0].id === idMsg(61), `${unida.length} ${unida[0]?.id}`);
  const dest = new MemStorage();
  const resultado = importConversations(dest, 'aliceAAAAAA', { [conv]: [msg(1), msg(2), { id: 'ruim' }, msg(2)], 'conv-ruim': [msg(3)] });
  confere('HISTÓRICO · importar conta só o que de fato entrou e quantas foram descartadas', resultado.conversationsRestored === 1 && resultado.messagesRestored === 2 && resultado.messagesSkipped === 1, JSON.stringify(resultado));
  saveMessage(dest, 'bobBBBBBBB', conv, msg(9));
  confere('HISTÓRICO · cada conta tem o seu: limpar o histórico de uma não toca a outra', clearAll(dest, 'aliceAAAAAA') === 1 && stats(dest, 'bobBBBBBBB').messages === 1 && stats(dest, 'aliceAAAAAA').messages === 0, JSON.stringify(stats(dest, 'bobBBBBBBB')));
  deleteMessage(dest, 'bobBBBBBBB', conv, idMsg(9));
  confere('HISTÓRICO · apagar uma mensagem tira só ela; exportar devolve as conversas que restam', loadConversation(dest, 'bobBBBBBBB', conv).length === 0 && Object.keys(exportAll(dest, 'bobBBBBBBB')).length === 0, 'não apagou');
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) { console.log(`${falhas} falha(s).`); process.exit(1); }
console.log('E2EE OK: um aparelho sem chave nunca sobrescreve a conta, a rotação preserva o histórico e o backup é cifrado e validado.');
