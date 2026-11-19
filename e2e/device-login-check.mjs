#!/usr/bin/env node
/**
 * O login por dispositivo conectado (Chave Soberana), com um banco de mentira:
 *   node e2e/device-login-check.mjs        (ou: npm run e2e:login-dispositivo)
 *
 * Provas:
 *  - o CÓDIGO só chega ao aparelho que PEDE; o aparelho que aprova (lista, RTDB) nunca o vê e tem de DIGITÁ-LO (número
 *    casado: aprovar às cegas não existe); errar 5 vezes recusa o pedido;
 *  - a aprovação NÃO se perde quando a credencial não pode ser emitida (antes: aprovado → consumido → erro → "expirada");
 *  - uma conta aguenta no máximo 3 pedidos pendentes de aparelhos diferentes e 12 por hora; o mesmo aparelho ou a mesma
 *    origem pedindo de novo SUBSTITUI o pedido anterior;
 *  - o segredo do desafio só existe em hash; consumir é de uma vez só;
 *  - o endereço do RTDB nunca vem vazio (o App Hosting entrega `databaseURL: ""`).
 * Sai com código 1 se algo falhar.
 */
import {
  CHALLENGE_TTL_MS, MAX_CODE_ATTEMPTS, listPending, parseLocalAccountHandle, pollChallenge, respondChallenge, startChallenge,
} from '../src/lib/server/deviceLoginCore.ts';
import { MAX_PENDING_PER_ACCOUNT, MAX_STARTS_PER_ACCOUNT_PER_HOUR, planNewChallenge, verificationCodeMatches } from '../src/lib/server/deviceLoginPolicy.ts';
import { resolveRtdbUrl } from '../src/lib/rtdbUrl.ts';
import { createHash } from 'node:crypto';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo) => {
  total++;
  if (condicao) console.log(`OK    ${nome}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo ?? 'condição falsa'}`); }
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────── um Firestore de mentira ─────────────────────────
function bancoFalso() {
  const docs = new Map();
  const ref = (col, id) => {
    const chave = `${col}/${id}`;
    return {
      id,
      get: async () => ({ exists: docs.has(chave), data: () => (docs.has(chave) ? structuredClone(docs.get(chave)) : undefined) }),
      set: async (d) => { docs.set(chave, structuredClone(d)); },
      update: async (p) => { if (!docs.has(chave)) throw new Error(`sem documento ${chave}`); docs.set(chave, { ...docs.get(chave), ...structuredClone(p) }); },
    };
  };
  const consulta = (col, filtros = [], lim = 1000) => ({
    where: (campo, _op, valor) => consulta(col, [...filtros, [campo, valor]], lim),
    limit: (n) => consulta(col, filtros, n),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([k, d]) => k.startsWith(`${col}/`) && filtros.every(([campo, valor]) => d[campo] === valor))
        .slice(0, lim)
        .map(([k, d]) => ({ id: k.slice(col.length + 1), data: () => structuredClone(d) })),
    }),
  });
  return {
    docs,
    collection: (col) => ({ doc: (id) => ref(col, id), ...consulta(col) }),
    // As escritas só valem no "commit", como no Firestore; as leituras veem o que já foi gravado.
    runTransaction: async (fn) => {
      const escritas = [];
      const out = await fn({ get: (r) => r.get(), update: (r, p) => { escritas.push([r, p]); } });
      for (const [r, p] of escritas) await r.update(p);
      return out;
    },
  };
}

const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
function casa(over = {}) {
  const relogio = { t: T0 };
  const db = bancoFalso();
  const espelho = [];
  const logs = [];
  const contas = new Map([
    ['ana', { uid: 'U_ANA', username: 'Ana', name: 'Ana Silva', avatarUrl: 'https://exercitodolula.app/a.png' }],
    ['bia', { uid: 'U_BIA', username: 'bia', name: 'Bia', avatarUrl: '' }],
  ]);
  const limites = new Map();
  const casa = {
    relogio, db, espelho, logs, mintaCom: over.mint ?? (async () => ({ customToken: 'TOKEN-1' })), minted: [],
    deps: {
      db,
      now: () => relogio.t,
      mint: async (uid, claims) => { casa.minted.push({ uid, claims }); return casa.mintaCom(uid, claims); },
      mirror: async (uid, payload, id) => { espelho.push({ uid, payload: payload ? structuredClone(payload) : null, id }); },
      resolveAccount: async (h) => contas.get(h) ?? null,
      takeRateLimit: (chave, max, janela) => {
        const marcas = (limites.get(chave) ?? []).filter((m) => relogio.t - m < janela);
        if (marcas.length >= max) { limites.set(chave, marcas); return false; }
        marcas.push(relogio.t); limites.set(chave, marcas); return true;
      },
      localDomains: new Set(['exercitodolula.app', 'www.exercitodolula.app']),
      log: (nivel, msg, detalhe) => logs.push({ nivel, msg, detalhe }),
    },
  };
  return casa;
}
const pede = (c, dispositivo = 'dev-1', ip = '203.0.113.7', handle = '@ana') =>
  startChallenge(c.deps, { handle, requesterDeviceId: dispositivo, requesterDeviceLabel: `Navegador ${dispositivo}`, requesterIp: ip });
const hash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ═════════════ 1. Quem é a conta ═════════════
{
  const dom = new Set(['exercitodolula.app', 'www.exercitodolula.app']);
  for (const [entrada, esperado] of [['@ana', 'ana'], ['ana', 'ana'], ['@ana@exercitodolula.app', 'ana'], ['ana@EXERCITODOLULA.APP', 'ana'], ['@@ana@www.exercitodolula.app', 'ana'], ['  @Ana  ', 'ana']]) {
    confere(`HANDLE · ${JSON.stringify(entrada)} → ${esperado}`, parseLocalAccountHandle(entrada, dom).localHandle === esperado, JSON.stringify(parseLocalAccountHandle(entrada, dom)));
  }
  for (const entrada of ['', '   ', '@', '@ana@mastodon.social', 'ana@evil.exercitodolula.app.evil.com', 'a b', 'ana!', '@@']) {
    const r = parseLocalAccountHandle(entrada, dom);
    confere(`HANDLE · ${JSON.stringify(entrada)} é recusado com uma explicação`, r.localHandle === null && typeof r.error === 'string' && r.error.length > 10, JSON.stringify(r));
  }
  confere('HANDLE · domínio externo diz para usar o do Exe. Lula', /exercitodolula\.app/.test(parseLocalAccountHandle('@ana@mastodon.social', dom).error ?? ''), 'mensagem');
}

// ═════════════ 2. start ═════════════
{
  const c = casa();
  const r = await pede(c);
  confere('START · pedido válido: devolve código, segredo e validade de 5 min', r.ok && /^\d{3} \d{3}$/.test(r.verificationCode) && r.secretToken.length >= 30 && r.expiresAt === T0 + CHALLENGE_TTL_MS, JSON.stringify(r).slice(0, 160));
  const doc = c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`);
  confere('START · o segredo fica só em HASH no banco (nunca o texto)', doc.secretTokenHash === hash(r.secretToken) && !JSON.stringify(doc).includes(r.secretToken), 'segredo em claro');
  confere('START · o código fica no documento (só o servidor lê) e o pedido nasce pendente com expireAt para a política de TTL', doc.verificationCode === r.verificationCode && doc.status === 'pending' && doc.expireAt instanceof Date && doc.codeAttempts === 0, JSON.stringify(doc));
  const aviso = c.espelho.at(-1);
  confere('START · o aviso em tempo real (RTDB) leva o pedido SEM o código, SEM o segredo e SEM o resumo do IP', aviso.payload?.challengeId === r.challengeId && !('verificationCode' in aviso.payload) && !('secretTokenHash' in aviso.payload) && !('requesterIpHash' in aviso.payload) && !JSON.stringify(aviso.payload).includes(r.verificationCode), JSON.stringify(aviso.payload));
  confere('START · o IP aparece só mascarado', aviso.payload.requesterIpHint === '203.0.*.*', aviso.payload.requesterIpHint);
  const lista = await listPending(c.deps, 'U_ANA');
  confere('START · a lista de pendentes (consulta do aparelho que aprova) também não leva o código', lista.length === 1 && !('verificationCode' in lista[0]) && !('secretTokenHash' in lista[0]) && !('requesterIpHash' in lista[0]), JSON.stringify(lista[0]));
  confere('START · a conta mostrada é a do handle', r.account.federatedHandle === '@ana@exercitodolula.app' && r.account.name === 'Ana Silva', JSON.stringify(r.account));

  const desc = await startChallenge(c.deps, { handle: '@ninguem', requesterDeviceId: 'x', requesterDeviceLabel: 'x', requesterIp: '1.2.3.4' });
  confere('START · conta inexistente → 404', !desc.ok && desc.status === 404, JSON.stringify(desc));
  const ruim = await startChallenge(c.deps, { handle: '@ana@mastodon.social', requesterDeviceId: 'x', requesterDeviceLabel: 'x', requesterIp: '1.2.3.4' });
  confere('START · domínio externo → 400', !ruim.ok && ruim.status === 400, JSON.stringify(ruim));
}
{
  // o mesmo aparelho pedindo de novo SUBSTITUI o pedido anterior
  const c = casa();
  const a = await pede(c, 'dev-1', '203.0.113.7');
  c.relogio.t += 5_000;
  const b = await pede(c, 'dev-1', '203.0.113.9');
  confere('SUBSTITUI · o pedido novo do MESMO aparelho vence o anterior', c.db.docs.get(`deviceLoginChallenges/${a.challengeId}`).status === 'expired' && c.db.docs.get(`deviceLoginChallenges/${b.challengeId}`).status === 'pending', 'não substituiu');
  confere('SUBSTITUI · o aviso antigo some do aparelho que aprova', c.espelho.some((e) => e.id === a.challengeId && e.payload === null), JSON.stringify(c.espelho.map((e) => [e.id.slice(-4), e.payload === null])));
  confere('SUBSTITUI · só um pendente sobra', (await listPending(c.deps, 'U_ANA')).length === 1, String((await listPending(c.deps, 'U_ANA')).length));
  const d = await pede(c, 'dev-9', '203.0.113.9');
  confere('SUBSTITUI · outro aparelho da MESMA origem (mesmo IP) também substitui (não soma)', d.ok && c.db.docs.get(`deviceLoginChallenges/${b.challengeId}`).status === 'expired', JSON.stringify(d).slice(0, 80));
}
{
  // teto de pendentes por conta
  const c = casa();
  const ok = [];
  for (let i = 1; i <= MAX_PENDING_PER_ACCOUNT; i++) ok.push(await pede(c, `dev-${i}`, `198.51.100.${i}`));
  confere(`TETO · ${MAX_PENDING_PER_ACCOUNT} aparelhos diferentes pedem e entram`, ok.every((r) => r.ok), JSON.stringify(ok.map((r) => r.ok)));
  const quarto = await pede(c, 'dev-4', '198.51.100.4');
  confere('TETO · o próximo aparelho DIFERENTE é recusado com 429 e explicação', !quarto.ok && quarto.status === 429 && /pendentes/.test(quarto.error), JSON.stringify(quarto));
  const mesmo = await pede(c, 'dev-2', '198.51.100.77');
  confere('TETO · mas quem JÁ tem pedido pendente (mesmo aparelho) ainda consegue pedir de novo (substitui)', mesmo.ok, JSON.stringify(mesmo));
  confere('TETO · a conta da Bia não é afetada pelo teto da Ana', (await pede(c, 'dev-1', '198.51.100.1', '@bia')).ok, 'Bia bloqueada');
  c.relogio.t += CHALLENGE_TTL_MS + 1000;
  confere('TETO · pedidos VENCIDOS não contam: passados os 5 min a conta aceita de novo', (await pede(c, 'dev-5', '198.51.100.5')).ok, 'ainda bloqueada');
}
{
  // teto por hora
  const c = casa();
  let ultimo = null;
  for (let i = 1; i <= MAX_STARTS_PER_ACCOUNT_PER_HOUR; i++) { ultimo = await pede(c, 'dev-1', '203.0.113.7'); c.relogio.t += 1000; }
  confere(`HORA · ${MAX_STARTS_PER_ACCOUNT_PER_HOUR} pedidos na hora passam (cada um substitui o anterior)`, ultimo.ok, JSON.stringify(ultimo).slice(0, 80));
  const passou = await pede(c, 'dev-1', '203.0.113.7');
  confere('HORA · o seguinte, na mesma hora, é recusado com 429', !passou.ok && passou.status === 429, JSON.stringify(passou));
  c.relogio.t += 3_600_000;
  confere('HORA · uma hora depois a conta volta a aceitar', (await pede(c, 'dev-1', '203.0.113.7')).ok, 'não voltou');
}

// ═════════════ 3. respond: número digitado ═════════════
const aprova = (c, r, codigo, uid = 'U_ANA') => respondChallenge(c.deps, { challengeId: r.challengeId, uid, action: 'approve', verificationCode: codigo, approverDeviceId: 'celular', approverDeviceLabel: 'Meu celular' });
{
  const c = casa();
  const r = await pede(c);
  const sem = await aprova(c, r, undefined);
  confere('CÓDIGO · aprovar SEM digitar o código é recusado (400) e conta como tentativa', !sem.ok && sem.status === 400 && c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).codeAttempts === 1, JSON.stringify(sem));
  const errado = await aprova(c, r, '000 000');
  confere('CÓDIGO · código errado → 400 e o pedido continua pendente', !errado.ok && errado.status === 400 && c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).status === 'pending', JSON.stringify(errado));
  const certo = await aprova(c, r, r.verificationCode.replace(' ', ''));
  confere('CÓDIGO · o código certo (digitado sem o espaço) aprova, mesmo depois de erros', certo.ok && certo.status === 'approved', JSON.stringify(certo));
  confere('CÓDIGO · quem aprovou fica registrado', c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).approverDeviceLabel === 'Meu celular', 'sem aprovador');
  confere('CÓDIGO · ao responder, o aviso sai da lista dos aparelhos', c.espelho.at(-1).payload === null && c.espelho.at(-1).id === r.challengeId, JSON.stringify(c.espelho.at(-1)));
}
for (const formato of ['{c}', '{a} {b}', '{a}-{b}', ' {a}{b} ', '{a}.{b}']) {
  const c = casa();
  const r = await pede(c);
  const [a, b] = r.verificationCode.split(' ');
  const digitado = formato.replace('{c}', `${a}${b}`).replace('{a}', a).replace('{b}', b);
  confere(`CÓDIGO · digitado como ${JSON.stringify(digitado)} confere`, (await aprova(c, r, digitado)).ok === true, 'não aceitou');
}
{
  const c = casa();
  const r = await pede(c);
  let ultimo = null;
  for (let i = 1; i <= MAX_CODE_ATTEMPTS; i++) ultimo = await aprova(c, r, '999 999');
  confere(`CÓDIGO · ${MAX_CODE_ATTEMPTS} códigos errados RECUSAM o pedido por segurança (423)`, !ultimo.ok && ultimo.status === 423 && c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).status === 'rejected', JSON.stringify(ultimo));
  const depois = await aprova(c, r, r.verificationCode);
  confere('CÓDIGO · depois disso nem o código certo aprova (409)', !depois.ok && depois.status === 409, JSON.stringify(depois));
  confere('CÓDIGO · o aviso sai do aparelho que aprova', c.espelho.at(-1).payload === null, JSON.stringify(c.espelho.at(-1)));
  const poll = await pollChallenge(c.deps, { challengeId: r.challengeId, secretToken: r.secretToken });
  confere('CÓDIGO · e o aparelho que PEDIU vê "recusado"', poll.status === 'rejected', JSON.stringify(poll));
}
{
  const c = casa();
  const r = await pede(c);
  const rec = await respondChallenge(c.deps, { challengeId: r.challengeId, uid: 'U_ANA', action: 'reject', approverDeviceId: 'x', approverDeviceLabel: 'x' });
  confere('RESPONDER · recusar não pede código', rec.ok && rec.status === 'rejected', JSON.stringify(rec));
  const outro = await respondChallenge(c.deps, { challengeId: r.challengeId, uid: 'U_ANA', action: 'approve', verificationCode: r.verificationCode, approverDeviceId: 'x', approverDeviceLabel: 'x' });
  confere('RESPONDER · já respondido → 409', !outro.ok && outro.status === 409, JSON.stringify(outro));
}
{
  const c = casa();
  const r = await pede(c);
  const alheio = await aprova(c, r, r.verificationCode, 'U_BIA');
  confere('RESPONDER · outra conta NÃO responde pelo pedido (403)', !alheio.ok && alheio.status === 403, JSON.stringify(alheio));
  const nada = await respondChallenge(c.deps, { challengeId: 'dlc_nao_existe', uid: 'U_ANA', action: 'approve', verificationCode: '123456', approverDeviceId: 'x', approverDeviceLabel: 'x' });
  confere('RESPONDER · pedido inexistente → 404', !nada.ok && nada.status === 404, JSON.stringify(nada));
  c.relogio.t += CHALLENGE_TTL_MS + 1;
  const vencido = await aprova(c, r, r.verificationCode);
  confere('RESPONDER · pedido vencido → 410 e o aviso some', !vencido.ok && vencido.status === 410 && c.espelho.at(-1).payload === null, JSON.stringify(vencido));
}

// ═════════════ 4. poll ═════════════
{
  const c = casa();
  const r = await pede(c);
  const entrada = { challengeId: r.challengeId, secretToken: r.secretToken };
  confere('POLL · pendente → "pending"', (await pollChallenge(c.deps, entrada)).status === 'pending', 'status');
  confere('POLL · segredo errado → "rejected", sem credencial', (await pollChallenge(c.deps, { ...entrada, secretToken: 'x'.repeat(32) })).status === 'rejected', 'aceitou');
  confere('POLL · parâmetros vazios → "expired"', (await pollChallenge(c.deps, { challengeId: '', secretToken: '' })).status === 'expired', 'status');
  confere('POLL · desafio inexistente → "expired"', (await pollChallenge(c.deps, { challengeId: 'dlc_x', secretToken: 'y' })).status === 'expired', 'status');
  await aprova(c, r, r.verificationCode);
  const ok = await pollChallenge(c.deps, entrada);
  confere('POLL · aprovado: devolve a credencial da conta certa, com a marca do método', ok.status === 'approved' && ok.customToken === 'TOKEN-1' && ok.uid === 'U_ANA' && c.minted[0].claims.authMethod === 'sovereign-device-key', JSON.stringify(ok));
  const de_novo = await pollChallenge(c.deps, entrada);
  confere('POLL · a credencial sai UMA vez só: a segunda consulta vê "consumed"', de_novo.status === 'consumed' && !de_novo.customToken && c.minted.length === 1, JSON.stringify(de_novo));
}
{
  // a emissão falha: a aprovação NÃO se perde
  let falhar = true;
  const c = casa({ mint: async () => { if (falhar) throw new Error("Permission 'iam.serviceAccounts.signBlob' denied"); return { customToken: 'TOKEN-DEPOIS' }; } });
  const r = await pede(c);
  const entrada = { challengeId: r.challengeId, secretToken: r.secretToken };
  await aprova(c, r, r.verificationCode);
  const p1 = await pollChallenge(c.deps, entrada);
  confere('FALHA · a credencial não pôde ser emitida: o aparelho recebe "pending" + credential_unavailable (não "expirada")', p1.status === 'pending' && p1.error === 'credential_unavailable' && !p1.customToken, JSON.stringify(p1));
  confere('FALHA · o desafio VOLTA a "aprovado" (a aprovação não é queimada)', c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).status === 'approved', c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).status);
  confere('FALHA · o erro vai para o registro do servidor, não para o aparelho', c.logs.some((l) => l.nivel === 'error' && /signBlob/.test(String(l.detalhe))) && !JSON.stringify(p1).includes('signBlob'), JSON.stringify(c.logs));
  falhar = false;
  const p2 = await pollChallenge(c.deps, entrada);
  confere('FALHA · consertado o servidor, a MESMA aprovação vira sessão na consulta seguinte', p2.status === 'approved' && p2.customToken === 'TOKEN-DEPOIS' && p2.uid === 'U_ANA', JSON.stringify(p2));
  confere('FALHA · e só então o desafio é consumido', c.db.docs.get(`deviceLoginChallenges/${r.challengeId}`).status === 'consumed' && (await pollChallenge(c.deps, entrada)).status === 'consumed', 'não consumiu');
}
{
  // a emissão falha E o prazo acaba: expira (não fica tentando para sempre)
  const c = casa({ mint: async () => { throw new Error('fora do ar'); } });
  const r = await pede(c);
  const entrada = { challengeId: r.challengeId, secretToken: r.secretToken };
  await aprova(c, r, r.verificationCode);
  await pollChallenge(c.deps, entrada);
  c.relogio.t += CHALLENGE_TTL_MS + 1;
  const fim = await pollChallenge(c.deps, entrada);
  confere('FALHA · se o prazo acaba antes de o servidor se recuperar, o pedido EXPIRA', fim.status === 'expired', JSON.stringify(fim));
}
{
  // alguém mexeu no desafio durante a falha: não se "ressuscita" nada
  const c = casa();
  const r = await pede(c);
  const chave = `deviceLoginChallenges/${r.challengeId}`;
  c.mintaCom = async () => { c.db.docs.set(chave, { ...c.db.docs.get(chave), status: 'expired', consumedAt: null }); throw new Error('falhou'); };
  await aprova(c, r, r.verificationCode);
  await pollChallenge(c.deps, { challengeId: r.challengeId, secretToken: r.secretToken });
  confere('FALHA · só desfaz o "consumido" se ninguém mexeu no desafio nesse meio tempo (nada de ressuscitar vencido)', c.db.docs.get(chave).status === 'expired', c.db.docs.get(chave).status);
}
{
  const c = casa();
  const r = await pede(c);
  c.relogio.t += CHALLENGE_TTL_MS + 1;
  const p = await pollChallenge(c.deps, { challengeId: r.challengeId, secretToken: r.secretToken });
  confere('POLL · pedido vencido sem resposta → "expired" e o aviso some do aparelho que aprova', p.status === 'expired' && c.espelho.at(-1).payload === null, JSON.stringify(p));
}

// ═════════════ 5. política pura ═════════════
{
  const agora = T0;
  const p = (id, dev, ip, vivo = true) => ({ challengeId: id, requesterDeviceId: dev, requesterIpHash: ip, createdAt: agora - 1000, expiresAt: vivo ? agora + 60_000 : agora - 1 });
  confere('POLÍTICA · conta sem pendentes: permite e não substitui nada', igual(planNewChallenge([], { deviceId: 'a', ipHash: 'x' }, agora), { allow: true, supersede: [] }), 'plano');
  confere('POLÍTICA · mesmo aparelho substitui', igual(planNewChallenge([p('1', 'a', 'x')], { deviceId: 'a', ipHash: 'y' }, agora), { allow: true, supersede: ['1'] }), 'plano');
  confere('POLÍTICA · mesma origem (IP) substitui', igual(planNewChallenge([p('1', 'b', 'x')], { deviceId: 'a', ipHash: 'x' }, agora), { allow: true, supersede: ['1'] }), 'plano');
  confere('POLÍTICA · IP desconhecido ("") nunca junta pedidos', igual(planNewChallenge([p('1', 'b', '')], { deviceId: 'a', ipHash: '' }, agora), { allow: true, supersede: [] }), 'plano');
  confere('POLÍTICA · vencidos são ignorados', igual(planNewChallenge([p('1', 'a', 'x', false), p('2', 'b', 'y', false), p('3', 'c', 'z', false), p('4', 'd', 'w', false)], { deviceId: 'e', ipHash: 'v' }, agora), { allow: true, supersede: [] }), 'plano');
  confere('POLÍTICA · no teto, o aparelho novo é recusado', !planNewChallenge([p('1', 'a', 'a'), p('2', 'b', 'b'), p('3', 'c', 'c')], { deviceId: 'd', ipHash: 'd' }, agora).allow, 'plano');
  confere('POLÍTICA · no teto, quem já está na lista ainda substitui o seu', planNewChallenge([p('1', 'a', 'a'), p('2', 'b', 'b'), p('3', 'c', 'c')], { deviceId: 'b', ipHash: 'q' }, agora).allow === true, 'plano');
  for (const [esperado, digitado, ok] of [['123 456', '123456', true], ['123 456', '123 456', true], ['123 456', '123-456', true], ['123 456', ' 123 456 ', true], ['123 456', '123 457', false], ['123 456', '12345', false], ['123 456', '1234567', false], ['123 456', '', false], ['123 456', undefined, false], ['123 456', 123456, false], ['123 456', null, false], ['', '', false], ['12 345', '12345', false]]) {
    confere(`CÓDIGO PURO · ${JSON.stringify(esperado)} × ${JSON.stringify(digitado)} → ${ok}`, verificationCodeMatches(esperado, digitado) === ok, String(verificationCodeMatches(esperado, digitado)));
  }
}

// ═════════════ 6. endereço do RTDB ═════════════
{
  const tab = [
    ['produção do App Hosting: databaseURL "" e projeto conhecido', { optionsUrl: '', envProjectId: 'echo-b5aw9', optionsProjectId: 'echo-b5aw9' }, 'https://echo-b5aw9-default-rtdb.firebaseio.com'],
    ['URL configurada no ambiente vence', { envUrl: 'https://outro.firebaseio.com/', optionsUrl: 'https://x.firebaseio.com', envProjectId: 'echo-b5aw9' }, 'https://outro.firebaseio.com'],
    ['URL nas opções do app', { optionsUrl: 'https://opts.firebaseio.com', envProjectId: 'echo-b5aw9' }, 'https://opts.firebaseio.com'],
    ['URL de emulador (http) é aceita', { envUrl: 'http://127.0.0.1:9000?ns=demo' }, 'http://127.0.0.1:9000?ns=demo'],
    ['lixo na URL cai no endereço padrão', { envUrl: 'undefined', optionsUrl: 'null', envProjectId: 'echo-b5aw9' }, 'https://echo-b5aw9-default-rtdb.firebaseio.com'],
    ['só o projeto das opções', { optionsProjectId: 'meu-projeto-1' }, 'https://meu-projeto-1-default-rtdb.firebaseio.com'],
    ['sem nada: null (sem tempo real, sem erro)', {}, null],
    ['projeto com caracteres inválidos: null', { envProjectId: 'Projeto Ruim!' }, null],
    ['projeto malicioso (com barra): null', { envProjectId: 'a/b' }, null],
    ['valores que não são texto não lançam', { envUrl: 42, optionsUrl: {}, envProjectId: null, optionsProjectId: undefined }, null],
  ];
  for (const [nome, entrada, esperado] of tab) confere(`RTDB · ${nome}`, resolveRtdbUrl(entrada) === esperado, String(resolveRtdbUrl(entrada)));
}

console.log(`\n${total - falhas}/${total} verificações passaram.`);
if (falhas > 0) { console.log(`${falhas} FALHA(S).`); process.exit(1); }
