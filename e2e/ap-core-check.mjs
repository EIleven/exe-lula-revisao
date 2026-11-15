#!/usr/bin/env node
/**
 * Testa o núcleo puro do ActivityPub sem app, sem emuladores e sem rede.
 *   node e2e/ap-core-check.mjs        (ou: npm run e2e:ap-core)
 *
 * Cobre assinatura HTTP, chaves e cifra, identidade, o portão de três níveis, a política de instâncias, as regras
 * de entrega e a validação de atividades recebidas — com ênfase no que precisa FALHAR: assinatura forjada, replay,
 * corpo adulterado, algoritmo trocado, autor falso, SSRF por nome de host, alcance maior que a visibilidade.
 *
 * A assinatura é conferida contra o `openssl` nos dois sentidos. Testar o verificador só com o assinador que nós
 * mesmos escrevemos seria circular; o `openssl` é a segunda opinião independente.
 *
 * Sai com código 1 se algo falhar.
 */
import { execFileSync } from 'node:child_process';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const sig = await import('../src/lib/activitypub/signature.ts');
const keys = await import('../src/lib/activitypub/keys.ts');
const idt = await import('../src/lib/activitypub/identity.ts');
const gate = await import('../src/lib/activitypub/gate.ts');
const del = await import('../src/lib/activitypub/delivery.ts');
const act = await import('../src/lib/activitypub/activity.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
let falhas = 0;
let total = 0;

function confere(nome, condicao, motivo, detalhe) {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const AGORA = Date.UTC(2026, 10, 12, 15, 0, 0);
const ORIGEM = 'https://exercitodolula.app';
const HOST = 'exercitodolula.app';

// ───────────── openssl: a segunda opinião ─────────────

function acharOpenssl() {
  const candidatos = [
    process.env.OPENSSL_BIN,
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'E:\\Arquivos de Programas\\Git\\mingw64\\bin\\openssl.exe',
    '/usr/bin/openssl',
    'openssl',
  ].filter(Boolean);
  for (const c of candidatos) {
    try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch { /* próximo */ }
  }
  return null;
}
const OPENSSL = acharOpenssl();
confere(
  'openssl está disponível para a conferência independente',
  OPENSSL !== null,
  'sem openssl a assinatura só seria testada contra o próprio código que a escreveu; defina OPENSSL_BIN',
  OPENSSL ?? undefined,
);

// ───────────── 1. Chaves ─────────────

const par = await keys.generateActorKeyPair();
const outro = await keys.generateActorKeyPair();
confere('par de chaves: PEMs no formato esperado',
  par.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') && par.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----'),
  'formato inesperado');
confere('loadPublicKey aceita RSA 2048', sig.loadPublicKey(par.publicKeyPem) !== null, 'recusou a chave que nós geramos');
confere('dois pares gerados são diferentes', par.publicKeyPem !== outro.publicKeyPem, 'a geração não é aleatória');

const fraca = generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const curva = generateKeyPairSync('ec', { namedCurve: 'P-256', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
confere('loadPublicKey RECUSA RSA de 1024 bits', sig.loadPublicKey(fraca.publicKey) === null, 'aceitou chave fraca');
confere('loadPublicKey RECUSA chave de curva elíptica', sig.loadPublicKey(curva.publicKey) === null, 'aceitou tipo de chave não suportado');
confere('loadPublicKey RECUSA lixo', sig.loadPublicKey('isto não é um PEM') === null && sig.loadPublicKey('') === null, 'aceitou lixo');
confere('fingerprint é curta e não contém o PEM',
  keys.publicKeyFingerprint(par.publicKeyPem).length === 16 && !keys.publicKeyFingerprint(par.publicKeyPem).includes('BEGIN'),
  'fingerprint vazaria a chave');

// ───────────── 2. Cifra envelope ─────────────

const mestraBytes = Buffer.alloc(32, 7).toString('base64');
const mestra2Bytes = Buffer.alloc(32, 9).toString('base64');
const anel = keys.parseMasterKeyring(`k1:${mestraBytes}`);
confere('keyring: lê id:base64', anel.activeId === 'k1' && anel.keys.size === 1, 'não leu');
confere('keyring: aceita base64 puro como k1', keys.parseMasterKeyring(mestraBytes).activeId === 'k1', 'recusou o formato simples');
for (const [nome, seg] of [
  ['vazia', ''], ['16 bytes', Buffer.alloc(16).toString('base64')], ['id inválido', `k 1:${mestraBytes}`],
  ['id repetido', `k1:${mestraBytes},k1:${mestra2Bytes}`], ['nula', null],
]) {
  let lancou = false;
  try { keys.parseMasterKeyring(seg); } catch { lancou = true; }
  confere(`keyring recusa: ${nome}`, lancou, 'aceitou chave-mestra inválida');
}

const selado = keys.sealSecret(par.privateKeyPem, anel, 'uid-ana');
confere('seal: o texto cifrado NÃO contém a chave privada',
  !JSON.stringify(selado).includes('PRIVATE KEY') && !selado.ct.includes('MIIE'),
  'a chave privada vazou no selado');
confere('seal: abre de volta, idêntica', keys.openSecret(selado, anel, 'uid-ana') === par.privateKeyPem, 'não abriu igual');
confere('seal: IV diferente a cada cifra', keys.sealSecret('x', anel, 'a').iv !== keys.sealSecret('x', anel, 'a').iv, 'IV repetido quebra o GCM');
confere('seal: IV de 12 bytes', Buffer.from(selado.iv, 'base64').length === 12, 'tamanho de IV errado');

function lanca(fn) { try { fn(); return false; } catch { return true; } }
confere('seal: o AAD amarra à pessoa — outro uid NÃO abre', lanca(() => keys.openSecret(selado, anel, 'uid-bia')),
  'trocar o texto cifrado de uma pessoa pela de outra entregaria a chave errada');
confere('seal: texto cifrado adulterado NÃO abre',
  lanca(() => keys.openSecret({ ...selado, ct: Buffer.from('adulterado').toString('base64') }, anel, 'uid-ana')), 'abriu adulterado');
const tagRuim = Buffer.from(selado.tag, 'base64'); tagRuim[0] ^= 1;
confere('seal: tag adulterada NÃO abre', lanca(() => keys.openSecret({ ...selado, tag: tagRuim.toString('base64') }, anel, 'uid-ana')), 'abriu com tag errada');
confere('seal: chave-mestra diferente NÃO abre',
  lanca(() => keys.openSecret(selado, keys.parseMasterKeyring(`k1:${mestra2Bytes}`), 'uid-ana')), 'abriu com a mestra errada');
confere('seal: formato desconhecido é recusado', lanca(() => keys.openSecret({ ...selado, v: 2 }, anel, 'uid-ana')), 'aceitou versão desconhecida');

const anelRotacionado = keys.parseMasterKeyring(`k2:${mestra2Bytes},k1:${mestraBytes}`);
confere('rotação: a primeira chave é a ativa', anelRotacionado.activeId === 'k2', 'ativa errada');
confere('rotação: cifra antiga (k1) ainda abre com o anel novo', keys.openSecret(selado, anelRotacionado, 'uid-ana') === par.privateKeyPem, 'a rotação quebrou o que já estava gravado');
const reembrulhado = keys.rewrapSecret(selado, anelRotacionado, 'uid-ana');
confere('rotação: rewrap passa para a chave ativa', reembrulhado?.kid === 'k2', 'não recifrou');
confere('rotação: o recifrado abre SÓ com a k2 no anel',
  keys.openSecret(reembrulhado, keys.parseMasterKeyring(`k2:${mestra2Bytes}`), 'uid-ana') === par.privateKeyPem, 'perdeu o conteúdo');
confere('rotação: rewrap do que já está na ativa devolve null', keys.rewrapSecret(reembrulhado, anelRotacionado, 'uid-ana') === null, 'recifrou à toa');

// ───────────── 3. Assinatura: caminho feliz ─────────────

const URL_INBOX = 'https://exercitodolula.app/ap/users/ana/inbox';
const KEY_ID = 'https://mastodon.social/users/bia#main-key';
const CORPO = JSON.stringify({ type: 'Follow', nota: 'ação com acento' });

const assinados = sig.signRequest({ method: 'POST', url: URL_INBOX, body: CORPO, privateKeyPem: par.privateKeyPem, keyId: KEY_ID, now: AGORA });
const requisicao = (over = {}) => ({
  method: 'POST',
  path: '/ap/users/ana/inbox',
  headers: { ...assinados, ...over.headers },
  body: over.body === undefined ? Buffer.from(CORPO) : over.body,
  now: AGORA,
  ...Object.fromEntries(Object.entries(over).filter(([k]) => !['headers', 'body'].includes(k))),
});

let v = sig.verifyHttpSignature(requisicao(), par.publicKeyPem);
confere('assinar e verificar um POST', v.ok === true && v.keyId === KEY_ID, `falhou: ${JSON.stringify(v)}`);
confere('o cabeçalho Signature usa rsa-sha256 e assina host, date e digest',
  /algorithm="rsa-sha256"/.test(assinados.signature) && /headers="\(request-target\) host date digest"/.test(assinados.signature),
  assinados.signature.slice(0, 120));
confere('o Digest é SHA-256 em base64 do corpo EM BYTES', assinados.digest === sig.sha256Digest(Buffer.from(CORPO)), 'digest divergente');

const assinadosGet = sig.signRequest({ method: 'GET', url: 'https://exercitodolula.app/ap/users/ana?x=1', privateKeyPem: par.privateKeyPem, keyId: KEY_ID, now: AGORA });
v = sig.verifyHttpSignature({ method: 'GET', path: '/ap/users/ana?x=1', headers: assinadosGet, body: null, now: AGORA }, par.publicKeyPem);
confere('assinar e verificar um GET (sem digest)', v.ok === true, JSON.stringify(v));
confere('GET assinado não leva Digest', assinadosGet.digest === undefined, 'GET com digest');

// hs2019 e algoritmo ausente
const comAlgoritmo = (alg) => ({ ...assinados, signature: assinados.signature.replace('algorithm="rsa-sha256"', alg === null ? '' : `algorithm="${alg}"`).replace(',,', ',') });
confere('algoritmo hs2019 é aceito (é como o Fediverso chama RSA-SHA256)',
  sig.verifyHttpSignature(requisicao({ headers: comAlgoritmo('hs2019') }), par.publicKeyPem).ok, 'recusou hs2019');
confere('algoritmo ausente é aceito como rsa-sha256',
  sig.verifyHttpSignature(requisicao({ headers: comAlgoritmo(null) }), par.publicKeyPem).ok, 'recusou algoritmo ausente');

// ───────────── 4. Assinatura: a segunda opinião (openssl) ─────────────

if (OPENSSL) {
  const dir = mkdtempSync(join(tmpdir(), 'ap-core-'));
  try {
    const caminhoPub = join(dir, 'pub.pem');
    const caminhoPriv = join(dir, 'priv.pem');
    writeFileSync(caminhoPub, par.publicKeyPem);
    writeFileSync(caminhoPriv, par.privateKeyPem);

    // (a) o que NÓS assinamos, o openssl verifica — com a string assinada reconstruída aqui, à mão.
    const prep = sig.prepareVerification(requisicao());
    const linhasManuais = [
      `(request-target): post /ap/users/ana/inbox`,
      `host: ${assinados.host}`,
      `date: ${assinados.date}`,
      `digest: ${assinados.digest}`,
    ].join('\n');
    confere('a string assinada bate com a montada à mão segundo o rascunho', prep.ok && prep.signingString === linhasManuais,
      prep.ok ? JSON.stringify(prep.signingString) : prep.reason);
    writeFileSync(join(dir, 'msg.txt'), linhasManuais);
    writeFileSync(join(dir, 'sig.bin'), prep.parsed.signature);
    let saida = '';
    try {
      saida = execFileSync(OPENSSL, ['dgst', '-sha256', '-verify', caminhoPub, '-signature', join(dir, 'sig.bin'), join(dir, 'msg.txt')], { encoding: 'utf8' });
    } catch (erro) { saida = String(erro.stdout ?? erro.message); }
    confere('OPENSSL verifica a assinatura que NÓS geramos', /Verified OK/.test(saida), saida.trim());

    // (b) o que o OPENSSL assina, nós verificamos.
    const corpoB = '{"type":"Undo"}';
    const dataB = new Date(AGORA).toUTCString();
    const digestB = sig.sha256Digest(Buffer.from(corpoB));
    const stringB = [`(request-target): post /ap/inbox`, `host: ${HOST}`, `date: ${dataB}`, `digest: ${digestB}`].join('\n');
    writeFileSync(join(dir, 'msgB.txt'), stringB);
    execFileSync(OPENSSL, ['dgst', '-sha256', '-sign', caminhoPriv, '-out', join(dir, 'sigB.bin'), join(dir, 'msgB.txt')]);
    const sigB = readFileSync(join(dir, 'sigB.bin')).toString('base64');
    const cabB = {
      host: HOST, date: dataB, digest: digestB,
      signature: `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${sigB}"`,
    };
    const vb = sig.verifyHttpSignature({ method: 'POST', path: '/ap/inbox', headers: cabB, body: Buffer.from(corpoB), now: AGORA }, par.publicKeyPem);
    confere('NÓS verificamos a assinatura que o OPENSSL gerou', vb.ok === true, JSON.stringify(vb));

    // (c) e o openssl recusa a que adulteramos — prova que o teste (a) discrimina.
    writeFileSync(join(dir, 'msgC.txt'), linhasManuais.replace('post', 'get'));
    let saidaC = '';
    try {
      saidaC = execFileSync(OPENSSL, ['dgst', '-sha256', '-verify', caminhoPub, '-signature', join(dir, 'sig.bin'), join(dir, 'msgC.txt')], { encoding: 'utf8' });
    } catch (erro) { saidaC = String(erro.stdout ?? erro.message); }
    confere('o openssl RECUSA a mesma assinatura sobre string adulterada (o teste discrimina)', /Verification (failure|Failure)/.test(saidaC) || !/Verified OK/.test(saidaC), saidaC.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────── 5. Assinatura: o que precisa FALHAR ─────────────

const motivo = (entrada, pem = par.publicKeyPem) => {
  const r = sig.verifyHttpSignature(entrada, pem);
  return r.ok ? 'ok' : r.reason;
};
const esperaRecusa = (nome, entrada, esperado, pem) => {
  const m = motivo(entrada, pem);
  confere(`RECUSA · ${nome}`, m === esperado, `motivo ${m}, esperado ${esperado}`, esperado);
};

esperaRecusa('corpo adulterado (digest)', requisicao({ body: Buffer.from(CORPO.replace('Follow', 'Delete')) }), 'digest');
esperaRecusa('corpo com um espaço a mais', requisicao({ body: Buffer.from(`${CORPO} `) }), 'digest');
esperaRecusa('POST sem corpo mas com digest de corpo', requisicao({ body: null }), 'digest');
esperaRecusa('digest com algoritmo mais fraco apenas',
  requisicao({ headers: { digest: `SHA-512=${Buffer.from('x').toString('base64')}` } }), 'digest');
{
  // O Digest entra na string assinada, então o cabeçalho múltiplo precisa ser assinado como tal — trocar o valor
  // DEPOIS de assinar quebra a assinatura, corretamente. Aqui assinamos à mão com o digest múltiplo.
  const digestMultiplo = `SHA-512=AAAA, ${assinados.digest}`;
  const cab = { host: assinados.host, date: assinados.date, digest: digestMultiplo };
  const str = [
    '(request-target): post /ap/users/ana/inbox',
    `host: ${cab.host}`,
    `date: ${cab.date}`,
    `digest: ${cab.digest}`,
  ].join('\n');
  const assinador = createSign('RSA-SHA256');
  assinador.update(str);
  const valor = assinador.sign(par.privateKeyPem).toString('base64');
  cab.signature = `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${valor}"`;
  confere('digest com vários algoritmos aceita o SHA-256 correto',
    sig.verifyHttpSignature({ method: 'POST', path: '/ap/users/ana/inbox', headers: cab, body: Buffer.from(CORPO), now: AGORA }, par.publicKeyPem).ok,
    'recusou digest múltiplo válido');
}
esperaRecusa('sem cabeçalho Signature', requisicao({ headers: { signature: undefined } }), 'ausente');
esperaRecusa('Signature duplicada', requisicao({ headers: { signature: [assinados.signature, assinados.signature] } }), 'ausente');
esperaRecusa('Signature vazia', requisicao({ headers: { signature: '' } }), 'ausente');
esperaRecusa('Signature sem keyId', requisicao({ headers: { signature: 'algorithm="rsa-sha256",headers="date",signature="AAAA"' } }), 'malformada');
esperaRecusa('Signature sem signature', requisicao({ headers: { signature: `keyId="${KEY_ID}",headers="date"` } }), 'malformada');
esperaRecusa('parâmetro repetido (keyId duas vezes)',
  requisicao({ headers: { signature: assinados.signature.replace('algorithm=', `keyId="https://evil.example/x",algorithm=`) } }), 'malformada');
esperaRecusa('lista de cabeçalhos com nome repetido',
  requisicao({ headers: { signature: assinados.signature.replace('headers="(request-target) host date digest"', 'headers="(request-target) host date date digest"') } }), 'malformada');
esperaRecusa('Signature gigante', requisicao({ headers: { signature: `keyId="${KEY_ID}",signature="${'A'.repeat(5000)}"` } }), 'malformada');

// confusão de algoritmo: HMAC com a chave PÚBLICA como segredo
const stringHmac = ['(request-target): post /ap/users/ana/inbox', `host: ${assinados.host}`, `date: ${assinados.date}`, `digest: ${assinados.digest}`].join('\n');
const hmac = createHmac('sha256', par.publicKeyPem).update(stringHmac).digest('base64');
esperaRecusa('ALGORITMO hmac-sha256 com a chave pública como segredo',
  requisicao({ headers: { signature: `keyId="${KEY_ID}",algorithm="hmac-sha256",headers="(request-target) host date digest",signature="${hmac}"` } }), 'algoritmo');
for (const alg of ['rsa-sha1', 'rsa-pss-sha512', 'ecdsa-sha256', 'ed25519', 'none', 'HS256']) {
  esperaRecusa(`algoritmo ${alg}`, requisicao({ headers: { signature: assinados.signature.replace('rsa-sha256', alg) } }), 'algoritmo');
}

const semAssinar = (nome) => assinados.signature.replace(/headers="[^"]*"/, (m) => `headers="${m.slice(9, -1).split(' ').filter((h) => h !== nome).join(' ')}"`);
for (const obrigatorio of ['host', 'date', 'digest', '(request-target)']) {
  esperaRecusa(`cabeçalho obrigatório fora da assinatura: ${obrigatorio}`,
    requisicao({ headers: { signature: semAssinar(obrigatorio) } }), 'cabecalho-nao-assinado');
}
esperaRecusa('Date ausente', requisicao({ headers: { date: undefined } }), 'cabecalho-ausente');
esperaRecusa('Host ausente', requisicao({ headers: { host: undefined } }), 'cabecalho-ausente');

// janela de tempo
const seg = (n) => n * 1000;
esperaRecusa('REPLAY · assinatura de 6 minutos atrás', requisicao({ now: AGORA + seg(360) }), 'data');
esperaRecusa('REPLAY · assinatura de 1 hora atrás', requisicao({ now: AGORA + seg(3600) }), 'data');
esperaRecusa('relógio · assinatura 6 minutos NO FUTURO', requisicao({ now: AGORA - seg(360) }), 'data');
esperaRecusa('Date inválido', requisicao({ headers: { date: 'ontem' } }), 'data');
confere('4 minutos de diferença ainda passa', sig.verifyHttpSignature(requisicao({ now: AGORA + seg(240) }), par.publicKeyPem).ok, 'janela estreita demais');
confere('limite exato de 5 minutos passa', sig.verifyHttpSignature(requisicao({ now: AGORA + seg(300) }), par.publicKeyPem).ok, 'o limite deveria ser inclusivo');

// a assinatura amarra o destino
esperaRecusa('caminho trocado (outra caixa de entrada)', requisicao({ path: '/ap/users/carla/inbox' }), 'assinatura');
esperaRecusa('query acrescentada ao caminho', requisicao({ path: '/ap/users/ana/inbox?x=1' }), 'assinatura');
esperaRecusa('método trocado (POST assinado, enviado como PUT)', requisicao({ method: 'PUT' }), 'assinatura');
esperaRecusa('host trocado (reenvio para outra instância)', requisicao({ headers: { host: 'outra-instancia.org' } }), 'assinatura');
esperaRecusa('assinada por OUTRA chave', requisicao(), 'assinatura', outro.publicKeyPem);
esperaRecusa('chave de 1024 bits', requisicao(), 'chave', fraca.publicKey);
esperaRecusa('chave de curva elíptica', requisicao(), 'chave', curva.publicKey);
esperaRecusa('chave que não é PEM', requisicao(), 'chave', 'lixo');
esperaRecusa('assinatura de bytes aleatórios',
  requisicao({ headers: { signature: assinados.signature.replace(/signature="[^"]*"$/, 'signature="AAAA"') } }), 'assinatura');

// fuzz: 300 adulterações aleatórias, NENHUMA pode passar
{
  let passou = 0;
  const alvos = ['body', 'date', 'host', 'digest', 'path'];
  for (let i = 0; i < 300; i++) {
    const alvo = alvos[i % alvos.length];
    const r = requisicao();
    const flip = (s) => { const b = Buffer.from(s); b[i % b.length] ^= 1 << (i % 7); return b.toString('latin1'); };
    if (alvo === 'body') r.body = Buffer.from(flip(CORPO), 'latin1');
    else if (alvo === 'path') r.path = flip(r.path);
    else r.headers = { ...r.headers, [alvo]: flip(String(r.headers[alvo])) };
    if (sig.verifyHttpSignature(r, par.publicKeyPem).ok) passou++;
  }
  confere('FUZZ · 300 adulterações de corpo, data, host, digest e caminho: nenhuma passa', passou === 0, `${passou} passaram`);
}

// prepareVerification não precisa da chave: estrutura primeiro
{
  const p = sig.prepareVerification(requisicao());
  confere('prepareVerification roda sem chave e devolve o keyId', p.ok && p.parsed.keyId === KEY_ID, JSON.stringify(p));
  const q = sig.prepareVerification(requisicao({ body: Buffer.from('x') }));
  confere('prepareVerification já recusa digest errado (antes de buscar a chave na rede)', !q.ok && q.reason === 'digest', JSON.stringify(q));
}

// parser
{
  const p = sig.parseSignatureHeader('keyId="https://a.org/k#main-key", algorithm="rsa-sha256", headers="(request-target) host date", signature="QUJD"');
  confere('parser: tolera espaços depois das vírgulas', p !== null && p.keyId === 'https://a.org/k#main-key' && p.headers.length === 3, JSON.stringify(p));
  confere('parser: headers ausente vale "date"', igual(sig.parseSignatureHeader('keyId="k",signature="QUJD"').headers, ['date']), 'padrão errado');
  confere('parser: nomes de cabeçalho vão para minúsculas',
    igual(sig.parseSignatureHeader('keyId="k",headers="Host DATE",signature="QUJD"').headers, ['host', 'date']), 'não normalizou');
  confere('parser: rejeita nulo e não-string', sig.parseSignatureHeader(null) === null && sig.parseSignatureHeader(undefined) === null, 'aceitou');
}

// ───────────── 6. Identidade ─────────────

confere('handle: normaliza maiúsculas e @', idt.normalizeHandle('@Ana_Silva') === 'ana_silva', String(idt.normalizeHandle('@Ana_Silva')));
for (const ruim of ['ab', 'a'.repeat(16), 'ana silva', 'ana.silva', 'ana-silva', '', null, undefined, 'ana@x.org', '../x', 'ana/inbox']) {
  confere(`handle recusa: ${JSON.stringify(ruim)}`, idt.normalizeHandle(ruim) === null, 'aceitou handle inválido');
}

for (const ok of ['mastodon.social', 'social.exemplo.com.br', 'xn--bcher-kva.example.org', 'a-b.example.com']) {
  confere(`hostname aceito: ${ok}`, idt.normalizeHostname(ok) === ok, 'recusou host legítimo');
}
for (const ruim of [
  '127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', '[::1]', 'localhost', 'servidor.local', 'x.internal',
  'a..b.com', '-a.com', 'a-.com', 'sem-ponto', 'com', '', ' ', 'a.b', 'host_com_underline.org', 'a.org:8080', 'a.org/x',
  'x.onion', 'x.lan', 'x.localhost', 'a'.repeat(300) + '.com', null, 123,
]) {
  confere(`hostname recusado: ${JSON.stringify(ruim)}`, idt.normalizeHostname(ruim) === null, 'aceitou host perigoso ou inválido');
}
confere('hostname: ponto final e maiúsculas são normalizados', idt.normalizeHostname('Mastodon.Social.') === 'mastodon.social', 'não normalizou');

confere('acct: com prefixo acct:', igual(idt.parseAcct('acct:ana@mastodon.social'), { user: 'ana', host: 'mastodon.social' }), 'falhou');
confere('acct: com @ inicial', igual(idt.parseAcct('@ana@mastodon.social'), { user: 'ana', host: 'mastodon.social' }), 'falhou');
confere('acct: usuário remoto com ponto e hífen', idt.parseAcct('ana.silva-2@mastodon.social')?.user === 'ana.silva-2', 'recusou');
for (const ruim of ['ana', 'ana@', '@mastodon.social', 'a@b@c.org', 'ana@127.0.0.1', 'ana@localhost', 'ana@x.org:8080', 'ana@x.org/path', '', null, 'a'.repeat(400) + '@x.org']) {
  confere(`acct recusado: ${JSON.stringify(ruim).slice(0, 40)}`, idt.parseAcct(ruim) === null, 'aceitou acct inválido');
}

// WebFinger: só responde por NOSSO host
const wf = (r) => idt.parseWebfingerResource(r, HOST, ORIGEM);
confere('webfinger: acct do nosso host', wf('acct:Ana@exercitodolula.app') === 'ana', String(wf('acct:Ana@exercitodolula.app')));
confere('webfinger: URL do actor', wf('https://exercitodolula.app/ap/users/ana') === 'ana', String(wf('https://exercitodolula.app/ap/users/ana')));
for (const ruim of [
  'acct:ana@outro.org', 'acct:ana@exercitodolula.app.evil.com', 'acct:ana@evil.exercitodolula.app',
  'acct:ana@exercitodolula.app:8080', 'ana@exercitodolula.app', 'https://evil.com/ap/users/ana',
  'https://exercitodolula.app.evil.com/ap/users/ana', 'http://exercitodolula.app/ap/users/ana',
  'https://exercitodolula.app/ap/users/ana/inbox', 'https://exercitodolula.app/ap/users/ab', '', null, 'acct:ab@exercitodolula.app',
]) {
  confere(`webfinger recusa: ${JSON.stringify(ruim)}`, wf(ruim) === null, `respondeu ${wf(ruim)}`);
}
{
  const j = idt.buildWebfinger({ handle: 'ana', host: HOST, origin: ORIGEM, locale: 'pt-BR', userId: 'U123' });
  confere('webfinger: subject em acct:', j.subject === 'acct:ana@exercitodolula.app', j.subject);
  confere('webfinger: link self aponta para o actor em activity+json',
    j.links.some((l) => l.rel === 'self' && l.type === 'application/activity+json' && l.href === `${ORIGEM}/ap/users/ana`), 'link self errado');
  confere('webfinger: link de página de perfil', j.links.some((l) => l.rel === 'http://webfinger.net/rel/profile-page' && l.href.endsWith('/pt-BR/profile/U123')), 'sem perfil');
}

confere('URLs canônicas', idt.actorUrl(ORIGEM, 'ana') === `${ORIGEM}/ap/users/ana` && idt.keyIdUrl(ORIGEM, 'ana').endsWith('/ana#main-key')
  && idt.inboxUrl(ORIGEM, 'ana').endsWith('/ana/inbox') && idt.sharedInboxUrl(ORIGEM) === `${ORIGEM}/ap/inbox`
  && idt.noteUrl(ORIGEM, 'P1') === `${ORIGEM}/ap/notes/P1`, 'URL fora do padrão');
confere('URLs aceitam origin com barra final', idt.actorUrl(`${ORIGEM}/`, 'ana') === `${ORIGEM}/ap/users/ana`, 'barra dupla');
confere('isOwnUrl compara a ORIGEM, não o prefixo',
  idt.isOwnUrl(`${ORIGEM}/x`, ORIGEM) && !idt.isOwnUrl('https://exercitodolula.app.evil.com/x', ORIGEM) && !idt.isOwnUrl('http://exercitodolula.app/x', ORIGEM) && !idt.isOwnUrl(null, ORIGEM),
  'comparou por prefixo');
confere('domainOfUrl só aceita https sem credenciais',
  idt.domainOfUrl('https://mastodon.social/users/a') === 'mastodon.social'
  && idt.domainOfUrl('http://mastodon.social/') === null
  && idt.domainOfUrl('https://u:p@mastodon.social/') === null
  && idt.domainOfUrl('https://127.0.0.1/') === null, 'aceitou URL indevida');

for (const [caminho, esperado] of [
  ['/ap/users/ana', { kind: 'actor', handle: 'ana' }],
  ['/ap/users/ANA', { kind: 'actor', handle: 'ana' }],
  ['/ap/users/ana/inbox', { kind: 'inbox', handle: 'ana' }],
  ['/ap/users/ana/outbox/', { kind: 'outbox', handle: 'ana' }],
  ['/ap/users/ana/followers', { kind: 'followers', handle: 'ana' }],
  ['/ap/inbox', { kind: 'sharedInbox' }],
  ['/ap/notes/AbC_123-x', { kind: 'note', postId: 'AbC_123-x' }],
]) confere(`rota ${caminho}`, igual(idt.parseLocalPath(caminho), esperado), JSON.stringify(idt.parseLocalPath(caminho)));
for (const ruim of ['/ap/users/', '/ap/users/ab', '/ap/users/ana/../x', '/ap/users/ana/inbox/x', '/ap/notes/../x', '/ap/notes/a b', '/ap/users/ana%2Finbox', '/x']) {
  confere(`rota recusada ${ruim}`, idt.parseLocalPath(ruim) === null, 'reconheceu caminho inválido');
}
confere('wantsActivityJson: só com tipo de ActivityPub no Accept',
  idt.wantsActivityJson('application/activity+json') && idt.wantsActivityJson('application/ld+json; profile="https://www.w3.org/ns/activitystreams"')
  && !idt.wantsActivityJson('text/html,application/xhtml+xml') && !idt.wantsActivityJson('*/*') && !idt.wantsActivityJson(null),
  'negociação de conteúdo errada: navegador receberia JSON');

// ───────────── 7. Portão de três níveis ─────────────

const PLAT = { enabled: true, mode: 'open' };
const CONTA = { enabled: true, paused: false, eligibleSince: AGORA - 1000, handle: 'ana' };
const POST = { userId: 'U', visibility: 'public', federation: 'public', type: 'original', category: 'echo', createdAtMs: AGORA, isDeleted: false, hasPoll: false, apObjectId: null };
const pode = (over = {}) => gate.evaluateGate({ op: over.op ?? 'create', platform: { ...PLAT, ...over.platform }, account: { ...CONTA, ...over.account }, post: { ...POST, ...over.post } });
const razao = (r) => (r.allowed ? 'permitido' : r.reason);

confere('PORTÃO · as três chaves ligadas → sai', pode().allowed === true && pode().scope === 'public', JSON.stringify(pode()));
confere('PORTÃO · plataforma desligada → não sai', razao(pode({ platform: { enabled: false } })) === 'plataforma-desligada', razao(pode({ platform: { enabled: false } })));
confere('PORTÃO · botão de emergência → não sai', razao(pode({ platform: { killSwitch: true } })) === 'plataforma-desligada', 'emergência ignorada');
confere('PORTÃO · conta sem opt-in → não sai', razao(pode({ account: { enabled: false } })) === 'conta-nao-optou', razao(pode({ account: { enabled: false } })));
confere('PORTÃO · conta sem handle → não sai', razao(pode({ account: { handle: null } })) === 'conta-nao-optou', 'saiu sem identidade');
confere('PORTÃO · conta pausada → não sai', razao(pode({ account: { paused: true } })) === 'conta-pausada', razao(pode({ account: { paused: true } })));
confere('PORTÃO · post local (padrão) → não sai', razao(pode({ post: { federation: 'local' } })) === 'post-local', 'post local saiu');
confere('PORTÃO · campo ausente vale local', razao(pode({ post: { federation: undefined } })) === 'post-local' && razao(pode({ post: { federation: null } })) === 'post-local', 'ausente não virou local');
for (const estranho of ['PUBLIC', 'Public', 'tudo', 'direct', 'private', '', 42, {}, [], true]) {
  confere(`PORTÃO · valor desconhecido (${JSON.stringify(estranho)}) vale LOCAL`, razao(pode({ post: { federation: estranho } })) === 'post-local', 'valor estranho federou');
}
confere('PORTÃO · post privado nunca sai, nem com alcance followers', razao(pode({ post: { visibility: 'private', federation: 'followers' } })) === 'post-privado', 'post privado saiu');
confere('PORTÃO · alcance público exige post público', razao(pode({ post: { visibility: 'followers', federation: 'public' } })) === 'visibilidade-incompativel', 'ampliou o alcance');
confere('PORTÃO · alcance não listado exige post público', razao(pode({ post: { visibility: 'followers', federation: 'unlisted' } })) === 'visibilidade-incompativel', 'ampliou o alcance');
confere('PORTÃO · alcance só-seguidores aceita post público', pode({ post: { federation: 'followers' } }).scope === 'followers', 'recusou');
confere('PORTÃO · alcance só-seguidores aceita post só-seguidores', pode({ post: { visibility: 'followers', federation: 'followers' } }).scope === 'followers', 'recusou');
confere('PORTÃO · ativar depois NÃO federa o passado', razao(pode({ post: { createdAtMs: AGORA - 5000 } })) === 'anterior-a-ativacao', 'federou post antigo');
confere('PORTÃO · post no instante exato da ativação sai (limite inclusivo)', pode({ post: { createdAtMs: AGORA - 1000 } }).allowed === true, 'limite exclusivo');
confere('PORTÃO · retomar de uma pausa também não federa o que nasceu durante ela',
  razao(pode({ account: { eligibleSince: AGORA + 10 } })) === 'anterior-a-ativacao', 'federou o que nasceu na pausa');
confere('PORTÃO · post apagado → não sai', razao(pode({ post: { isDeleted: true } })) === 'post-apagado', 'apagado saiu');
confere('PORTÃO · citação → sai (permitido)', pode({ post: { type: 'quote' } }).allowed === true, 'quote foi bloqueado');
confere('PORTÃO · repost → sai (permitido)', pode({ post: { type: 'repost' } }).allowed === true, 'repost foi bloqueado');
confere('PORTÃO · tipo desconhecido → não sai (declarado)', razao(pode({ post: { type: 'story' } })) === 'tipo-nao-suportado', 'story saiu');
confere('PORTÃO · notícia (category "news") → sai (permitido desde 85b7eb6)', pode({ post: { category: 'news' } }).allowed === true, 'news foi bloqueada');
confere('PORTÃO · categoria desconhecida → não sai (declarado)', razao(pode({ post: { category: 'outra' } })) === 'categoria-nao-suportada', 'categoria desconhecida saiu');
confere('PORTÃO · enquete → não sai (declarado)', razao(pode({ post: { hasPoll: true } })) === 'enquete-nao-suportada', 'enquete saiu quebrada');

confere('PORTÃO · atualizar algo que nunca saiu → não', razao(pode({ op: 'update' })) === 'nao-federado-antes', razao(pode({ op: 'update' })));
confere('PORTÃO · atualizar algo que saiu → sim', pode({ op: 'update', post: { apObjectId: `${ORIGEM}/ap/notes/P1` } }).allowed === true, 'recusou update legítimo');
confere('PORTÃO · atualizar com conta pausada → não', razao(pode({ op: 'update', account: { paused: true }, post: { apObjectId: 'x' } })) === 'conta-pausada', 'update saiu pausado');
confere('PORTÃO · apagar algo que nunca saiu → não há o que apagar', razao(pode({ op: 'delete' })) === 'nao-federado-antes', razao(pode({ op: 'delete' })));
confere('PORTÃO · apagar o que saiu → sim', pode({ op: 'delete', post: { apObjectId: 'x' } }).allowed === true, 'recusou delete legítimo');
confere('PORTÃO · APAGAR vale mesmo com a conta pausada', pode({ op: 'delete', account: { paused: true }, post: { apObjectId: 'x' } }).allowed === true, 'prendeu a pessoa a uma cópia');
confere('PORTÃO · APAGAR vale mesmo com a conta desligada', pode({ op: 'delete', account: { enabled: false, handle: null }, post: { apObjectId: 'x' } }).allowed === true, 'prendeu a pessoa a uma cópia');
confere('PORTÃO · APAGAR vale mesmo se o post virou privado depois', pode({ op: 'delete', post: { visibility: 'private', apObjectId: 'x' } }).allowed === true, 'não retirou o que já saiu');
confere('PORTÃO · mas o botão de emergência vale até para apagar', razao(pode({ op: 'delete', platform: { killSwitch: true }, post: { apObjectId: 'x' } })) === 'plataforma-desligada', 'emergência furada');

// invariantes, por enumeração exaustiva
{
  let violacoes = 0;
  let combos = 0;
  for (const enabled of [true, false]) for (const kill of [true, false, undefined]) for (const contaOn of [true, false])
  for (const paused of [true, false]) for (const handle of ['ana', null]) for (const visibility of ['public', 'followers', 'private'])
  for (const federation of ['local', 'public', 'unlisted', 'followers', 'x', undefined]) for (const antes of [true, false]) {
    combos++;
    const d = gate.evaluateGate({
      op: 'create',
      platform: { enabled, killSwitch: kill, mode: 'open' },
      account: { enabled: contaOn, paused, eligibleSince: AGORA - 1000, handle },
      post: { ...POST, visibility, federation, createdAtMs: antes ? AGORA - 5000 : AGORA },
    });
    if (d.allowed) {
      const ok = enabled && !kill && contaOn && !paused && handle && !antes
        && ['public', 'unlisted', 'followers'].includes(federation) && visibility !== 'private'
        && (federation === 'followers' || visibility === 'public');
      if (!ok) violacoes++;
    }
  }
  confere(`INVARIANTE · saiu ⇒ plataforma ∧ conta ∧ publicação ∧ visibilidade ∧ pós-ativação (${combos} combinações)`, violacoes === 0, `${violacoes} violações`);
}

confere('endereçamento: público', igual(gate.addressingFor('public', 'F'), { to: [gate.AS_PUBLIC], cc: ['F'] }), 'to/cc errado');
confere('endereçamento: não listado', igual(gate.addressingFor('unlisted', 'F'), { to: ['F'], cc: [gate.AS_PUBLIC] }), 'to/cc errado');
confere('endereçamento: só seguidores NÃO inclui o público em lugar nenhum',
  igual(gate.addressingFor('followers', 'F'), { to: ['F'], cc: [] }), 'followers vazou para o público');

// política de instâncias
const dom = (d, policy, own = HOST) => gate.decideInstance(d, policy, own);
const ABERTA = { mode: 'open', rules: {} };
confere('INSTÂNCIA · modo aberto aceita desconhecida', dom('mastodon.social', ABERTA).decision === 'accept', 'recusou');
confere('INSTÂNCIA · suspensa → rejeita', dom('ruim.org', { mode: 'open', rules: { 'ruim.org': { action: 'suspend' } } }).decision === 'reject', 'aceitou suspensa');
confere('INSTÂNCIA · silenciada → limita', dom('chata.org', { mode: 'open', rules: { 'chata.org': { action: 'silence' } } }).decision === 'limit', 'não limitou');
confere('INSTÂNCIA · a regra de um domínio vale para os subdomínios',
  dom('a.b.ruim.org', { mode: 'open', rules: { 'ruim.org': { action: 'suspend' } } }).decision === 'reject', 'subdomínio escapou do bloqueio');
confere('INSTÂNCIA · a regra mais ESPECÍFICA ganha (suspender subdomínio de domínio permitido)',
  dom('x.boa.org', { mode: 'allowlist', rules: { 'boa.org': { action: 'allow' }, 'x.boa.org': { action: 'suspend' } } }).decision === 'reject', 'regra geral venceu a específica');
confere('INSTÂNCIA · e permitir subdomínio de domínio suspenso',
  dom('ok.ruim.org', { mode: 'open', rules: { 'ruim.org': { action: 'suspend' }, 'ok.ruim.org': { action: 'allow' } } }).decision === 'accept', 'regra específica ignorada');
confere('INSTÂNCIA · lista permitida recusa quem não está nela',
  dom('estranha.org', { mode: 'allowlist', rules: { 'boa.org': { action: 'allow' } } }).reason === 'fora-da-lista-permitida', 'aceitou fora da lista');
confere('INSTÂNCIA · lista permitida aceita quem está',
  dom('boa.org', { mode: 'allowlist', rules: { 'boa.org': { action: 'allow' } } }).decision === 'accept', 'recusou permitida');
confere('INSTÂNCIA · lista permitida vazia recusa tudo', dom('qualquer.org', { mode: 'allowlist', rules: {} }).decision === 'reject', 'lista vazia aceitou');
confere('INSTÂNCIA · o próprio domínio nunca é remoto', dom(HOST, ABERTA).reason === 'dominio-local', 'aceitou a si mesma como remota');
confere('INSTÂNCIA · domínio inválido é recusado', dom('127.0.0.1', ABERTA).reason === 'dominio-invalido' && dom('', ABERTA).reason === 'dominio-invalido', 'aceitou inválido');
confere('INSTÂNCIA · maiúsculas e ponto final são normalizados', dom('RUIM.ORG.', { mode: 'open', rules: { 'ruim.org': { action: 'suspend' } } }).decision === 'reject', 'burlou por maiúsculas');
confere('INSTÂNCIA · "ruim.org" não pega "naoruim.org"', dom('naoruim.org', { mode: 'open', rules: { 'ruim.org': { action: 'suspend' } } }).decision === 'accept', 'bloqueou por sufixo de texto');
confere('INSTÂNCIA · normalizeDomain aceita *.dominio', gate.normalizeDomain('*.Ruim.org') === 'ruim.org', 'não aceitou curinga');

const blocos = [{ scope: 'actor', value: 'https://x.org/users/a' }, { scope: 'domain', value: 'ruim.org' }];
confere('BLOQUEIO · ator específico', gate.isBlockedByUser(blocos, 'https://x.org/users/a', 'x.org'), 'não bloqueou');
confere('BLOQUEIO · outro ator do mesmo servidor passa', !gate.isBlockedByUser(blocos, 'https://x.org/users/b', 'x.org'), 'bloqueou demais');
confere('BLOQUEIO · domínio inteiro e subdomínios', gate.isBlockedByUser(blocos, 'https://a.ruim.org/u', 'a.ruim.org'), 'subdomínio escapou');
confere('BLOQUEIO · sem bloqueios, nada', !gate.isBlockedByUser([], 'https://x.org/users/a', 'x.org'), 'bloqueou sem regra');

// o hostname do gate e o do identity concordam (módulos separados, regra duplicada de propósito)
{
  const corpus = ['mastodon.social', 'x.org', '127.0.0.1', 'localhost', 'a..b.com', 'ok-ok.example.com.br', 'sem-ponto', 'a.b', 'x_y.org', 'XN--A.ORG', '10.0.0.1', 'a'.repeat(70) + '.com'];
  const diverge = corpus.filter((h) => {
    const a = idt.normalizeHostname(h);
    const b = gate.normalizeDomain(h);
    // identity é MAIS restrito (recusa sufixos internos): onde identity aceita, gate tem de aceitar igual.
    return a !== null && a !== b;
  });
  confere('os dois validadores de host concordam no que aceitam', diverge.length === 0, `divergem em: ${diverge.join(', ')}`);
}

// ───────────── 8. Entrega ─────────────

confere('Retry-After em segundos', del.parseRetryAfter('37', AGORA) === 37, String(del.parseRetryAfter('37', AGORA)));
confere('Retry-After em data HTTP', del.parseRetryAfter(new Date(AGORA + 90_000).toUTCString(), AGORA) === 90, String(del.parseRetryAfter(new Date(AGORA + 90_000).toUTCString(), AGORA)));
confere('Retry-After é limitado a um dia', del.parseRetryAfter('9999999', AGORA) === 86_400, 'sem teto');
for (const ruim of ['', 'abc', '-5', '0', null, undefined, new Date(AGORA - 1000).toUTCString()]) {
  confere(`Retry-After inútil: ${JSON.stringify(ruim)}`, del.parseRetryAfter(ruim, AGORA) === null, 'aceitou');
}

const cls = (status, extra = {}) => del.classifyDelivery({ status, ...extra }, AGORA);
for (const s of [200, 201, 202, 204]) confere(`entrega ${s} → enviada`, cls(s).outcome === 'sent', cls(s).outcome);
confere('entrega 410 → inbox sumiu', cls(410).outcome === 'gone', cls(410).outcome);
for (const s of [400, 404, 405, 406, 415, 422]) confere(`entrega ${s} → permanente, não repete`, cls(s).outcome === 'permanent', cls(s).outcome);
for (const s of [408, 425, 429, 500, 502, 503, 504]) confere(`entrega ${s} → tenta de novo`, cls(s).outcome === 'retry', cls(s).outcome);
confere('entrega 401 e 403 → tenta, mas só 3 vezes', cls(401).outcome === 'retry' && cls(403).maxAttempts === 3, 'ambíguo mal tratado');
confere('entrega 3xx → permanente (não seguimos redirecionamento de POST)', cls(307).outcome === 'permanent' && cls(301).outcome === 'permanent', 'tratou redirect como sucesso ou como falha passageira');
confere('erro de rede → tenta de novo', cls(null, { errorDetail: 'ECONNRESET' }).outcome === 'retry', 'desistiu de falha de rede');
confere('destino bloqueado pela guarda de SSRF → não repete', cls(null, { unsafe: true }).outcome === 'unsafe' && cls(null, { unsafe: true }).maxAttempts === 1, 'insistiu em destino proibido');
confere('429 carrega o Retry-After', cls(429, { retryAfter: '120' }).retryAfterSeconds === 120, 'perdeu o Retry-After');

const sempreMeio = () => 0.5;
const passo = (r, n, rnd = sempreMeio) => del.nextStep(r, n, AGORA, rnd);
confere('backoff: 1ª falha espera 60 s (sem jitter com 0.5)', passo(cls(503), 1).delaySeconds === 60, JSON.stringify(passo(cls(503), 1)));
confere('backoff: sequência de esperas',
  igual([1, 2, 3, 4, 5, 6, 7].map((n) => passo(cls(503), n).delaySeconds), [60, 300, 1200, 3600, 10800, 28800, 86400]), 'tabela errada');
confere('backoff: a 8ª falha esgota as tentativas', passo(cls(503), 8).kind === 'dead' && passo(cls(503), 8).reason === 'tentativas-esgotadas', JSON.stringify(passo(cls(503), 8)));
confere('backoff: a 7ª ainda reagenda', passo(cls(503), 7).kind === 'retry', 'desistiu cedo');
confere('backoff: permanente morre na hora', passo(cls(404), 1).kind === 'dead' && passo(cls(404), 1).reason === 'recusado-permanentemente', 'insistiu em 404');
confere('backoff: 403 morre na 3ª tentativa', passo(cls(403), 2).kind === 'retry' && passo(cls(403), 3).kind === 'dead', 'limite de 403 errado');
confere('backoff: jitter fica em ±15%',
  passo(cls(503), 3, () => 0).delaySeconds >= 1020 && passo(cls(503), 3, () => 0.999999).delaySeconds <= 1380, `${passo(cls(503), 3, () => 0).delaySeconds}..${passo(cls(503), 3, () => 0.999999).delaySeconds}`);
confere('backoff: o jitter varia de verdade', passo(cls(503), 3, () => 0.1).delaySeconds !== passo(cls(503), 3, () => 0.9).delaySeconds, 'sem jitter');
confere('backoff: respeita Retry-After MAIOR que a tabela', passo(cls(429, { retryAfter: '7200' }), 1).delaySeconds === 7200, JSON.stringify(passo(cls(429, { retryAfter: '7200' }), 1)));
confere('backoff: Retry-After MENOR não encurta a espera', passo(cls(429, { retryAfter: '5' }), 2).delaySeconds === 300, 'encurtou a espera');
confere('backoff: nunca passa de um dia', passo(cls(429, { retryAfter: '99999999' }), 1).delaySeconds === 86400, 'sem teto');
confere('backoff: o instante é agora + espera', passo(cls(503), 1).at === AGORA + 60_000, 'instante errado');
{
  let t = AGORA; let n = 0; let ultimo = null;
  while (n < 20) { n++; ultimo = del.nextStep(cls(503), n, t, sempreMeio); if (ultimo.kind === 'dead') break; t = ultimo.at; }
  confere('uma entrega que nunca dá certo termina em exatamente 8 tentativas', n === 8 && ultimo.kind === 'dead', `parou em ${n}`);
  confere('o horizonte total de insistência é de ~1,5 dia (131 160 s)', t - AGORA === 131_160_000, `${((t - AGORA) / 86_400_000).toFixed(2)} dias`);
}

const dBase = { uid: 'U', op: 'create', objectId: 'P1', targetInbox: 'https://a.org/inbox' };
confere('deliveryId é determinístico', del.deliveryId(dBase) === del.deliveryId({ ...dBase }), 'id instável: enfileirar duas vezes duplicaria');
for (const campo of ['uid', 'op', 'objectId', 'targetInbox']) {
  confere(`deliveryId muda com ${campo}`, del.deliveryId(dBase) !== del.deliveryId({ ...dBase, [campo]: 'outro' }), 'colisão');
}
confere('deliveryId não colide por concatenação ("a"+"bc" ≠ "ab"+"c")',
  del.deliveryId({ uid: 'a', op: 'bc', objectId: 'x', targetInbox: 'y' }) !== del.deliveryId({ uid: 'ab', op: 'c', objectId: 'x', targetInbox: 'y' }), 'separador ausente');
confere('deliveryId é hex de 64 caracteres', /^[0-9a-f]{64}$/.test(del.deliveryId(dBase)), 'formato');

{
  const alvos = del.groupTargets([
    { inbox: 'https://a.org/u/1/inbox', sharedInbox: 'https://a.org/inbox', domain: 'a.org' },
    { inbox: 'https://a.org/u/2/inbox', sharedInbox: 'https://a.org/inbox', domain: 'a.org' },
    { inbox: 'https://a.org/u/3/inbox', sharedInbox: 'https://a.org/inbox', domain: 'a.org' },
    { inbox: 'https://b.org/u/1/inbox', sharedInbox: null, domain: 'b.org' },
    { inbox: 'https://b.org/u/2/inbox', domain: 'b.org' },
  ]);
  confere('seguidores do mesmo servidor viram UMA entrega no inbox compartilhado',
    alvos.length === 3 && alvos.find((t) => t.inbox === 'https://a.org/inbox')?.followers === 3, JSON.stringify(alvos));
  confere('sem inbox compartilhado, cada um tem o seu', alvos.filter((t) => t.domain === 'b.org').length === 2, 'agrupou o que não podia');
}
confere('disjuntor: sem efeito nas primeiras falhas', del.domainCooldownSeconds(0) === 0 && del.domainCooldownSeconds(2) === 0, 'esfriou cedo');
confere('disjuntor: cresce e tem teto', del.domainCooldownSeconds(3) > 0 && del.domainCooldownSeconds(6) > del.domainCooldownSeconds(3) && del.domainCooldownSeconds(500) <= 6 * 3600, 'sem teto');

// ───────────── 9. HTML de saída ─────────────

const tagHref = (t) => `${ORIGEM}/pt-BR/tag/${encodeURIComponent(t)}`;
const html = (t) => act.plainTextToHtml(t, { tagHref });
confere('HTML · escapa marcação', !html('<script>alert(1)</script>').includes('<script') && html('<b>x</b>').includes('&lt;b&gt;'), html('<script>alert(1)</script>'));
confere('HTML · escapa aspas em tentativa de sair de atributo', !/"[^>]*onerror/i.test(html('"><img src=x onerror=alert(1)>')) && !html('"><img src=x onerror=alert(1)>').includes('<img'), html('"><img src=x onerror=alert(1)>'));
confere('HTML · escapa &', html('a & b') === '<p>a &amp; b</p>', html('a & b'));
confere('HTML · hashtag vira link com rel=tag', /<a href="https:\/\/exercitodolula\.app\/pt-BR\/tag\/lula" class="mention hashtag" rel="tag">#<span>lula<\/span><\/a>/.test(html('viva #lula')), html('viva #lula'));
confere('HTML · hashtag com acento', html('#açaí').includes('/tag/a%C3%A7a%C3%AD') && html('#açaí').includes('<span>açaí</span>'), html('#açaí'));
confere('HTML · "a#b" no meio de palavra NÃO é hashtag', !html('a#b').includes('<a'), html('a#b'));
confere('HTML · URL vira link com nofollow/noopener', /<a href="https:\/\/exemplo\.org\/x\?a=1&amp;b=2" rel="nofollow noopener noreferrer" target="_blank">/.test(html('veja https://exemplo.org/x?a=1&b=2')), html('veja https://exemplo.org/x?a=1&b=2'));
confere('HTML · pontuação final fica FORA do link', html('leia https://exemplo.org/x.').includes('</a>.') && !html('leia https://exemplo.org/x.').includes('x.</a>'), html('leia https://exemplo.org/x.'));
confere('HTML · javascript: não vira link', !html('javascript:alert(1)').includes('<a') && !html('JAVASCRIPT:alert(1)').includes('<a'), html('javascript:alert(1)'));
confere('HTML · data: e vbscript: não viram link', !html('data:text/html,<script>').includes('<a href') && !html('vbscript:x').includes('<a'), 'virou link');
confere('HTML · parágrafos e quebras', html('um\ndois\n\ntrês') === '<p>um<br>dois</p><p>três</p>', html('um\ndois\n\ntrês'));
confere('HTML · CRLF é normalizado', html('um\r\ndois') === '<p>um<br>dois</p>', html('um\r\ndois'));
confere('HTML · vazio devolve vazio', html('') === '' && html('   \n  ') === '', 'não vazio');
confere('HTML · emoji e acento passam intactos', html('olá 🇧🇷 ação') === '<p>olá 🇧🇷 ação</p>', html('olá 🇧🇷 ação'));
confere('HTML · hashtag dentro do parêntese', html('(#lula)').includes('<span>lula</span>'), html('(#lula)'));
confere('HTML · nenhuma tag além das permitidas, em entrada hostil', (() => {
  const saida = html('<iframe src=x>\n\n<svg onload=a>\n#t <style>@import</style> http://x.org/"><b>');
  return [...saida.matchAll(/<\/?([a-z]+)/g)].every((m) => ['p', 'br', 'a', 'span'].includes(m[1]));
})(), 'sobrou tag não permitida');

// ───────────── 10. Objetos de saída ─────────────

const FOLLOWERS = `${ORIGEM}/ap/users/ana/followers`;
const ACTOR = `${ORIGEM}/ap/users/ana`;
const ator = act.buildActor({
  id: ACTOR, handle: 'ana', name: 'Ana', summaryHtml: '<p>oi</p>', profileUrl: `${ORIGEM}/pt-BR/profile/U1`,
  inbox: idt.inboxUrl(ORIGEM, 'ana'), outbox: idt.outboxUrl(ORIGEM, 'ana'), followers: FOLLOWERS, following: idt.followingUrl(ORIGEM, 'ana'),
  sharedInbox: idt.sharedInboxUrl(ORIGEM), keyId: idt.keyIdUrl(ORIGEM, 'ana'), publicKeyPem: par.publicKeyPem,
  avatarUrl: 'https://media.exercitodolula.app/m/AAAAAAAAAAAAAAAAAAAAAA', publishedIso: '2026-01-01T00:00:00Z',
});
confere('ator: tipo Person com handle', ator.type === 'Person' && ator.preferredUsername === 'ana', JSON.stringify(ator).slice(0, 80));
confere('ator: a chave pública pertence ao próprio ator', ator.publicKey.owner === ator.id && ator.publicKey.id === `${ACTOR}#main-key`, 'owner ou id errado');
confere('ator: NUNCA contém chave privada', !JSON.stringify(ator).includes('PRIVATE'), 'a chave privada vazou no actor');
confere('ator: descoberta e indexação começam DESLIGADAS', ator.discoverable === false && ator.indexable === false, 'padrão não protetor');
confere('ator: não exige aprovação manual na v1 (e diz isso)', ator.manuallyApprovesFollowers === false, 'campo errado');
confere('ator: caixa de entrada compartilhada declarada', ator.endpoints.sharedInbox === `${ORIGEM}/ap/inbox`, 'sem sharedInbox');
confere('ator: ícone usa a URL de mídia própria', ator.icon.url.startsWith('https://media.exercitodolula.app/m/'), 'expôs outro host');
confere('ator: sem e-mail, sem data de nascimento', !/email|birth|nascimento|dateOfBirth/i.test(JSON.stringify(ator)), 'dado pessoal no actor');
confere('ator: alsoKnownAs e movedTo só quando existem', !('alsoKnownAs' in ator) && !('movedTo' in ator)
  && act.buildActor({ ...{ id: ACTOR, handle: 'ana', name: 'A', summaryHtml: '', profileUrl: 'u', inbox: 'i', outbox: 'o', followers: 'f', following: 'g', sharedInbox: 's', keyId: 'k', publicKeyPem: 'p', publishedIso: 'x' }, alsoKnownAs: ['https://x.org/u/a'] }).alsoKnownAs.length === 1,
  'campos de migração fora de hora');

const nota = act.buildNote({
  id: `${ORIGEM}/ap/notes/P1`, actorId: ACTOR, contentHtml: '<p>oi</p>', publishedIso: '2026-11-12T12:00:00Z',
  to: [gate.AS_PUBLIC], cc: [FOLLOWERS], url: `${ORIGEM}/pt-BR/post/P1`, sensitive: true,
  attachments: [{ url: 'https://media.exercitodolula.app/m/BBBBBBBBBBBBBBBBBBBBBB', mediaType: 'image/jpeg', alt: 'foto' }],
  hashtags: [{ name: 'lula', href: tagHref('lula') }],
});
confere('nota: tipo Note atribuída ao actor', nota.type === 'Note' && nota.attributedTo === ACTOR, 'autoria errada');
confere('nota: sensível e anexo com mediaType e alt', nota.sensitive === true && nota.attachment[0].mediaType === 'image/jpeg' && nota.attachment[0].name === 'foto', 'anexo errado');
confere('nota: hashtag como objeto Hashtag', igual(nota.tag, [{ type: 'Hashtag', href: tagHref('lula'), name: '#lula' }]), JSON.stringify(nota.tag));
const criar = act.buildCreate(`${ACTOR}/activities/abc12345`, ACTOR, nota);
confere('Create: copia o endereçamento da nota', igual(criar.to, nota.to) && igual(criar.cc, nota.cc) && criar.object === nota, 'endereçamento divergente entre atividade e objeto');
const apagar = act.buildDelete(`${ACTOR}/activities/del12345`, ACTOR, nota.id, nota.to, nota.cc);
confere('Delete: leva Tombstone com o id do objeto', apagar.object.type === 'Tombstone' && apagar.object.id === nota.id, JSON.stringify(apagar.object));
const atualizar = act.buildUpdate(`${ACTOR}/activities/upd12345`, ACTOR, nota, '2026-11-12T13:00:00Z');
confere('Update: carrega `updated` no objeto', atualizar.object.updated === '2026-11-12T13:00:00Z', 'sem updated: servidores remotos ignoram a edição');
const followRecebido = { id: 'https://mastodon.social/f/1', type: 'Follow', actor: 'https://mastodon.social/users/bia', object: ACTOR };
const aceite = act.buildFollowResponse('Accept', `${ACTOR}/activities/acc12345`, ACTOR, followRecebido);
confere('Accept: embute o Follow recebido', aceite.type === 'Accept' && aceite.object.id === followRecebido.id, 'sem o Follow, parte dos servidores não casa');
confere('contagem: coleção só com totalItems, sem itens', (() => {
  const c = act.buildCountOnlyCollection(FOLLOWERS, 42);
  return c.totalItems === 42 && !('orderedItems' in c) && !('first' in c);
})(), 'listou seguidores por padrão (T7)');
confere('página de coleção carrega partOf e next', (() => {
  const p = act.buildOrderedPage({ id: 'x?page=1', partOf: 'x', items: [1], next: 'x?page=2' });
  return p.partOf === 'x' && p.next === 'x?page=2' && p.orderedItems.length === 1;
})(), 'página malformada');

// ───────────── 11. Atividades recebidas ─────────────

const BIA = 'https://mastodon.social/users/bia';
const ctx = { signerActor: BIA, ownHost: HOST };
const entra = (json, c = ctx) => act.parseInboundActivity(json, c);
const motivoIn = (json, c = ctx) => { const r = entra(json, c); return r.ok ? 'ok' : r.reason; };
const follow = { id: 'https://mastodon.social/f/1', type: 'Follow', actor: BIA, object: ACTOR };

confere('ENTRADA · Follow válido', entra(follow).ok && entra(follow).activity.type === 'Follow' && entra(follow).activity.objectId === ACTOR, JSON.stringify(entra(follow)));
confere('ENTRADA · actor como objeto {id}', entra({ ...follow, actor: { id: BIA, type: 'Person' } }).ok, 'não aceitou actor embutido');
confere('ENTRADA · aceita @context e campos desconhecidos', entra({ ...follow, '@context': 'x', extra: { a: 1 } }).ok, 'recusou campo extra');

for (const [nome, json, esperado] of [
  ['não é objeto', 'texto', 'json-invalido'],
  ['é lista', [follow], 'json-invalido'],
  ['nulo', null, 'json-invalido'],
  ['sem id', { ...follow, id: undefined }, 'sem-id'],
  ['id vazio', { ...follow, id: '' }, 'sem-id'],
  ['id em http', { ...follow, id: 'http://mastodon.social/f/1' }, 'id-nao-https'],
  ['id com credenciais', { ...follow, id: 'https://u:p@mastodon.social/f/1' }, 'id-nao-https'],
  ['id que não é URL', { ...follow, id: 'f1' }, 'id-nao-https'],
  ['sem ator', { ...follow, actor: undefined }, 'sem-ator'],
  ['dois atores', { ...follow, actor: [BIA, 'https://x.org/u/z'] }, 'sem-ator'],
  ['ator em http', { ...follow, actor: 'http://mastodon.social/users/bia' }, 'sem-ator'],
  ['FALSIFICAÇÃO · atividade diz ser de outro ator', { ...follow, actor: 'https://outro.org/users/ze', id: 'https://outro.org/f/1' }, 'autor-diferente-do-ator'],
  ['id em OUTRO host que o do ator', { ...follow, id: 'https://outro.org/f/1' }, 'id-de-outro-host'],
  ['tipo desconhecido', { ...follow, type: 'Dislike' }, 'tipo-ignorado'],
  ['tipo não-string', { ...follow, type: ['Follow'] }, 'tipo-ignorado'],
  ['Follow com objeto embutido', { ...follow, object: { id: ACTOR, type: 'Person' } }, 'objeto-invalido'],
  ['Follow com objeto http', { ...follow, object: 'http://exercitodolula.app/ap/users/ana' }, 'objeto-invalido'],
  ['Like sem objeto', { id: 'https://mastodon.social/l/1', type: 'Like', actor: BIA }, 'objeto-invalido'],
]) confere(`ENTRADA · recusa: ${nome}`, motivoIn(json) === esperado, `veio ${motivoIn(json)}, esperado ${esperado}`);

// Ator local: a atividade é coerente com a assinatura (o assinante É o ator), mas o ator é NOSSO. Atividade nossa
// nunca chega por HTTP, então quem se apresenta assim pela rede está mentindo.
confere('ENTRADA · recusa: ator local (nunca chega por HTTP)',
  motivoIn({ ...follow, actor: ACTOR, id: `${ORIGEM}/f/1` }, { signerActor: ACTOR, ownHost: HOST }) === 'ator-local',
  'aceitou atividade que diz ser de um ator nosso');

// Create: o ponto central contra falsificação de autoria
const noteRemota = (over = {}) => ({
  id: 'https://mastodon.social/users/bia/statuses/1', type: 'Note', attributedTo: BIA, content: '<p>oi</p>',
  to: [gate.AS_PUBLIC], cc: [], ...over,
});
const create = (nota) => ({ id: 'https://mastodon.social/users/bia/statuses/1/activity', type: 'Create', actor: BIA, object: nota });
confere('ENTRADA · Create válido', entra(create(noteRemota())).ok, JSON.stringify(entra(create(noteRemota()))));
confere('ENTRADA · attributedTo como {id}', entra(create(noteRemota({ attributedTo: { id: BIA } }))).ok, 'não aceitou');
for (const [nome, nota, esperado] of [
  ['FALSIFICAÇÃO · attributedTo é OUTRO ator', noteRemota({ attributedTo: 'https://mastodon.social/users/vitima' }), 'autor-diferente-do-ator'],
  ['FALSIFICAÇÃO · sem attributedTo', noteRemota({ attributedTo: undefined }), 'autor-diferente-do-ator'],
  ['FALSIFICAÇÃO · attributedTo é lista com outro primeiro', noteRemota({ attributedTo: ['https://x.org/u/z', BIA] }), 'autor-diferente-do-ator'],
  ['id do objeto em OUTRO host', noteRemota({ id: 'https://outro.org/n/1' }), 'id-de-outro-host'],
  ['objeto sem id', noteRemota({ id: undefined }), 'id-de-outro-host'],
  ['tipo de objeto não suportado', noteRemota({ type: 'Event' }), 'tipo-ignorado'],
  ['conteúdo gigante', noteRemota({ content: 'x'.repeat(100_001) }), 'conteudo-grande-demais'],
  ['conteúdo que não é string', noteRemota({ content: { a: 1 } }), 'conteudo-grande-demais'],
  ['anexos demais', noteRemota({ attachment: Array.from({ length: 17 }, () => ({ type: 'Image', url: 'https://x.org/a.png' })) }), 'conteudo-grande-demais'],
  ['tags demais', noteRemota({ tag: Array.from({ length: 101 }, () => ({ type: 'Hashtag', name: '#a' })) }), 'conteudo-grande-demais'],
  ['attachment que não é lista', noteRemota({ attachment: 'x' }), 'conteudo-grande-demais'],
]) confere(`ENTRADA · Create recusa: ${nome}`, motivoIn(create(nota)) === esperado, `veio ${motivoIn(create(nota))}, esperado ${esperado}`);
confere('ENTRADA · Create com objeto por id (sem corpo) é recusado', motivoIn({ ...create(noteRemota()), object: noteRemota().id }) === 'objeto-invalido', 'aceitou objeto não embutido');
confere('ENTRADA · Update segue as mesmas regras do Create',
  motivoIn({ ...create(noteRemota({ attributedTo: 'https://x.org/u/z' })), type: 'Update' }) === 'autor-diferente-do-ator', 'Update burla a checagem');

// Delete / Undo / Accept / Flag / Move
const deletar = (obj) => ({ id: 'https://mastodon.social/d/1', type: 'Delete', actor: BIA, object: obj });
confere('ENTRADA · Delete de objeto do próprio host', entra(deletar('https://mastodon.social/users/bia/statuses/1')).ok, 'recusou');
confere('ENTRADA · Delete com Tombstone', entra(deletar({ id: 'https://mastodon.social/users/bia/statuses/1', type: 'Tombstone' })).ok, 'recusou');
confere('ENTRADA · Delete do próprio ator (conta removida)', entra(deletar(BIA)).ok, 'recusou');
confere('ENTRADA · Delete de objeto de OUTRO host é recusado', motivoIn(deletar('https://outro.org/n/1')) === 'id-de-outro-host', 'um ator apagaria objeto alheio');
confere('ENTRADA · Delete sem objeto é recusado', motivoIn(deletar(undefined)) === 'objeto-invalido', 'aceitou delete vazio');

const undo = (obj) => ({ id: 'https://mastodon.social/u/1', type: 'Undo', actor: BIA, object: obj });
confere('ENTRADA · Undo por id', entra(undo('https://mastodon.social/f/1')).ok, 'recusou');
confere('ENTRADA · Undo de Follow embutido do mesmo ator', entra(undo(follow)).ok && entra(undo(follow)).activity.objectType === 'Follow', 'recusou');
confere('ENTRADA · Undo de atividade embutida de OUTRO ator é recusado',
  motivoIn(undo({ ...follow, actor: 'https://outro.org/users/ze' })) === 'autor-diferente-do-ator', 'alguém desfaria a ação de outro');
confere('ENTRADA · Undo sem tipo no objeto é recusado', motivoIn(undo({ id: 'x' })) === 'objeto-invalido', 'aceitou');

confere('ENTRADA · Accept de Follow embutido', entra({ id: 'https://mastodon.social/a/1', type: 'Accept', actor: BIA, object: { type: 'Follow', id: 'f', actor: ACTOR, object: BIA } }).ok, 'recusou');
confere('ENTRADA · Flag com alvos e conteúdo', entra({ id: 'https://mastodon.social/fl/1', type: 'Flag', actor: BIA, object: ['https://mastodon.social/users/x', ACTOR], content: 'spam' }).ok, 'recusou');
confere('ENTRADA · Flag com alvos demais é recusado', motivoIn({ id: 'https://mastodon.social/fl/1', type: 'Flag', actor: BIA, object: Array.from({ length: 21 }, () => ACTOR) }) === 'objeto-invalido', 'aceitou');
confere('ENTRADA · Flag com texto gigante é recusado', motivoIn({ id: 'https://mastodon.social/fl/1', type: 'Flag', actor: BIA, object: [ACTOR], content: 'x'.repeat(5001) }) === 'conteudo-grande-demais', 'aceitou');
confere('ENTRADA · Move do próprio ator', entra({ id: 'https://mastodon.social/m/1', type: 'Move', actor: BIA, object: BIA, target: 'https://novo.org/users/bia' }).ok, 'recusou');
confere('ENTRADA · Move de OUTRO ator é recusado', motivoIn({ id: 'https://mastodon.social/m/1', type: 'Move', actor: BIA, object: 'https://mastodon.social/users/vitima', target: 'https://novo.org/u/x' }) === 'objeto-invalido', 'um ator moveria outro');

// orçamento de estrutura
{
  let fundo = { a: 1 };
  for (let i = 0; i < 60; i++) fundo = { x: fundo };
  confere('ENTRADA · JSON profundo demais é recusado', motivoIn({ ...follow, extra: fundo }) === 'estrutura-grande-demais', 'aceitou bomba de profundidade');
  confere('ENTRADA · JSON com nós demais é recusado', motivoIn({ ...follow, extra: Array.from({ length: 25_000 }, (_, i) => i) }) === 'estrutura-grande-demais', 'aceitou bomba de largura');
  const antes = Date.now();
  motivoIn({ ...follow, extra: Array.from({ length: 25_000 }, (_, i) => ({ i })) });
  confere('ENTRADA · a recusa por orçamento é rápida', Date.now() - antes < 500, `${Date.now() - antes} ms`);
}
confere('ENTRADA · endereçamento público é reconhecido', act.isAddressedToPublic({ to: [gate.AS_PUBLIC], cc: [] }) && act.isAddressedToPublic({ to: [], cc: [gate.AS_PUBLIC] })
  && !act.isAddressedToPublic({ to: [FOLLOWERS], cc: [] }), 'endereçamento mal lido');

// ───────────── 12. Guardas de arquitetura ─────────────
//
// Duas camadas, duas regras:
//   NÚCLEO (os seis módulos puros): nenhum import além de node:* — é o que o deixa testável sem rede nem Firebase.
//   SERVIÇOS (o resto): podem importar vizinhos com extensão .ts, mas NUNCA Firebase como valor (o armazenamento entra
//   por parâmetro), nem Next, nem o alias @/ (que o Node não resolve e prenderia o código ao framework).
// Em AMBAS: nada de rede crua. Toda saída passa por safeFetchText.

{
  const dir = join(RAIZ, 'src', 'lib', 'activitypub');
  const NUCLEO = ['signature', 'keys', 'identity', 'gate', 'delivery', 'activity'];
  const arquivos = readdirSync(dir).filter((n) => n.endsWith('.ts'));
  confere('há os seis módulos do núcleo', NUCLEO.every((m) => arquivos.includes(`${m}.ts`)), arquivos.join(', '));

  for (const nome of arquivos) {
    const texto = readFileSync(join(dir, nome), 'utf8');
    const semComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imports = [...semComentarios.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)]
      .map((m) => ({ tipo: Boolean(m[1]), de: m[2] }));
    const ehNucleo = NUCLEO.includes(nome.replace(/\.ts$/, ''));

    if (ehNucleo) {
      const indevidos = imports.filter((i) => !i.tipo && !i.de.startsWith('node:'));
      confere(`${nome} (núcleo): só importa node:* (ou import type)`, indevidos.length === 0, `import de valor: ${indevidos.map((i) => i.de).join(', ')}`);
    } else {
      const valores = imports.filter((i) => !i.tipo);
      const proibidos = valores.filter((i) => /^(@\/|next|firebase|firebase-admin|react)/.test(i.de));
      confere(`${nome} (serviço): não importa Firebase, Next nem @/ como valor`, proibidos.length === 0, `import proibido: ${proibidos.map((i) => i.de).join(', ')}`);
      const relativos = valores.filter((i) => i.de.startsWith('.'));
      const semExtensao = relativos.filter((i) => !i.de.endsWith('.ts'));
      confere(`${nome} (serviço): imports relativos levam a extensão .ts (o Node exige)`, semExtensao.length === 0, `sem extensão: ${semExtensao.map((i) => i.de).join(', ')}`);
    }

    confere(`${nome}: não faz rede por conta própria`,
      !/(^|[^.\w])fetch\(|http\.request|https\.request|XMLHttpRequest/.test(semComentarios), 'rede crua: toda saída passa por safeFetchText');
    confere(`${nome}: não registra segredo em log`, !/console\.(log|info|warn|error)\([^)]*(privateKey|PRIVATE|masterKey)/i.test(semComentarios), 'log de segredo');
  }
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Núcleo do ActivityPub OK: assinatura conferida pelo openssl, portão de três níveis e entrada hostil recusada.');
