#!/usr/bin/env node
/**
 * Testa, nos emuladores, as REGRAS do Firestore da federação com o ID token real de cada usuário.
 *   npm run emulators        (noutro terminal; as regras só recarregam REINICIANDO o emulador)
 *   node e2e/ap-rules-check.mjs
 *
 * O que as regras garantem (o resto do portão — plataforma e instante do envio — é do servidor):
 *   - um post só nasce com alcance externo se a PESSOA optou e não está em pausa;
 *   - o alcance de fora nunca é maior que a visibilidade de dentro;
 *   - o alcance fica FIXO: edição não o amplia;
 *   - o cliente não se auto-ativa, não lê o estado dos outros e não toca nas coleções do servidor.
 *
 * Sai com código 1 se algo falhar.
 */
import {
  ADMIN, EMU, PROJECT, fsCall, fsCreateAtServerTime, fsGetDoc, fsSet, fsUpdate, signInRest,
} from './lib/harness.mjs';

let falhas = 0;
let total = 0;
const confere = (nome, condicao, motivo, detalhe) => {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
};
const permitido = (nome, r) => confere(nome, r.status === 200, `foi RECUSADO (HTTP ${r.status}) ${JSON.stringify(r.json?.error?.message ?? '').slice(0, 80)}`, 'permitido');
const negado = (nome, r) => confere(nome, r.status === 403 || r.status === 401, `foi PERMITIDO (HTTP ${r.status})`, 'recusado');

const stamp = Date.now().toString(36);

try {
  const r = await fetch(`${EMU.firestore}/`);
  if (!r.ok && r.status !== 404) throw new Error(String(r.status));
} catch {
  console.log('FALHA emulador do Firestore não responde — rode `npm run emulators`');
  process.exit(1);
}

/** Conta com e-mail confirmado, claim de membro e perfil, como o app deixa depois do cadastro. */
async function criarConta(rotulo, { privado = false, federacao = null } = {}) {
  const email = `ap.${stamp}.${rotulo}@example.test`;
  const senha = 'Teste!123456';
  const cria = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
  });
  const { localId: uid } = await cria.json();
  await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true, customAttributes: JSON.stringify({ member: true }) }),
  });
  const { idToken } = await signInRest(email, senha);
  const username = `ap_${rotulo}_${stamp}`.slice(0, 15);
  await fsSet(`users/${uid}`, {
    name: `Pessoa ${rotulo}`, username, name_lowercase: `pessoa ${rotulo}`, profileVisibility: privado ? 'private' : 'public',
    followersCount: 0, followingCount: 0, postsCount: 0, isAdmin: false,
  }, 'owner');
  if (federacao) await fsSet(`users/${uid}/private/federation`, federacao, 'owner');
  return { uid, token: idToken, privado };
}

const A = await criarConta('a', { federacao: { enabled: true, paused: false, handle: 'a' } }); // aderiu
const B = await criarConta('b'); //                                                              nunca aderiu
const Z = await criarConta('z', { federacao: { enabled: true, paused: true, handle: 'z' } }); //   aderiu e pausou
const D = await criarConta('d', { federacao: { enabled: false, paused: false, handle: 'd' } }); //  aderiu e desligou
const P = await criarConta('p', { privado: true, federacao: { enabled: true, paused: false, handle: 'p' } }); // perfil privado

const base = (c, extra = {}) => ({
  userId: c.uid, text: 'olá, Fediverso', visibility: c.privado ? 'followers' : 'public', likes: 0, reposts: 0, commentsCount: 0,
  quotesCount: 0, views: 0, isDeleted: false, allowReposts: true, replyPermission: 'everyone', category: 'echo', type: 'original', ...extra,
});
let n = 0;
const postar = (c, extra = {}) => fsCreateAtServerTime('posts', `ap_${stamp}_${++n}`, base(c, extra), c.token);

// ── regressão: o comportamento anterior não mudou ──
permitido('REGRESSÃO · post sem o campo federation continua nascendo', await postar(A));
permitido('REGRESSÃO · quem NUNCA aderiu continua postando normalmente', await postar(B));
permitido('REGRESSÃO · perfil privado continua postando normalmente', await postar(P));

// ── nível PUBLICAÇÃO + nível CONTA ──
permitido('federation: "local" é o padrão e é aceito por qualquer pessoa', await postar(B, { federation: 'local' }));
permitido('conta que aderiu: alcance público', await postar(A, { federation: 'public' }));
permitido('conta que aderiu: alcance não listado', await postar(A, { federation: 'unlisted' }));
permitido('conta que aderiu: alcance só-seguidores', await postar(A, { federation: 'followers' }));
negado('quem NUNCA aderiu NÃO cria post com alcance externo (público)', await postar(B, { federation: 'public' }));
negado('quem NUNCA aderiu NÃO cria post com alcance externo (só-seguidores)', await postar(B, { federation: 'followers' }));
negado('conta PAUSADA não cria post com alcance externo', await postar(Z, { federation: 'public' }));
negado('conta que DESLIGOU não cria post com alcance externo', await postar(D, { federation: 'public' }));
permitido('conta pausada ainda posta LOCAL (a pausa não a cala)', await postar(Z, { federation: 'local' }));

// ── o alcance de fora nunca é maior que a visibilidade de dentro ──
negado('perfil PRIVADO não cria post com alcance público', await postar(P, { federation: 'public' }));
negado('perfil PRIVADO não cria post com alcance não listado', await postar(P, { federation: 'unlisted' }));
permitido('perfil PRIVADO cria post só-seguidores (cabe na visibilidade dele)', await postar(P, { federation: 'followers' }));

// ── valores inválidos e o que a v1 não representa ──
for (const estranho of ['PUBLIC', 'Public', 'tudo', 'direct', 'private', '', 'followers ']) {
  negado(`valor desconhecido ${JSON.stringify(estranho)} é recusado (não vira público por engano)`, await postar(A, { federation: estranho }));
}
permitido('artigo/notícia (category news) federa para conta que aderiu', await postar(A, { federation: 'public', category: 'news', headline: 'x' }));
negado('enquete não federa', await postar(A, {
  federation: 'public', poll: { options: [{ id: 'a', text: 'sim' }, { id: 'b', text: 'não' }], endsAt: new Date(Date.now() + 3_600_000) },
  pollOptionIds: ['a', 'b'], pollCounts: { a: 0, b: 0 }, pollTotal: 0,
}));

// ── o alcance é FIXO ──
const idLocal = `ap_${stamp}_edicao`;
permitido('(controle) A cria um post local', await fsCreateAtServerTime('posts', idLocal, base(A, { federation: 'local' }), A.token));
negado('EDIÇÃO não amplia o alcance: local → público', await fsUpdate(`posts/${idLocal}`, { federation: 'public' }, A.token));
negado('EDIÇÃO não amplia o alcance nem para só-seguidores', await fsUpdate(`posts/${idLocal}`, { federation: 'followers' }, A.token));
permitido('(controle) editar o texto do mesmo post continua permitido', await fsUpdate(`posts/${idLocal}`, { text: 'editado', isEdited: true, editCount: 1, updatedAt: new Date().toISOString() }, A.token));
const idPublico = `ap_${stamp}_edicao2`;
permitido('(controle) A cria um post público', await fsCreateAtServerTime('posts', idPublico, base(A, { federation: 'public' }), A.token));
negado('EDIÇÃO não restringe nem reescreve o alcance por cima do servidor (público → local)', await fsUpdate(`posts/${idPublico}`, { federation: 'local' }, A.token));
negado('outra pessoa não edita o alcance do post de A', await fsUpdate(`posts/${idPublico}`, { federation: 'local' }, B.token));

// ── o estado da federação da conta ──
negado('a pessoa NÃO se auto-ativa gravando o próprio documento de federação', await fsSet(`users/${B.uid}/private/federation`, { enabled: true, paused: false, handle: 'b' }, B.token));
negado('a pessoa NÃO altera o próprio documento (reabrir a janela de elegibilidade)', await fsUpdate(`users/${A.uid}/private/federation`, { eligibleSince: 0 }, A.token));
negado('a pessoa NÃO apaga o próprio documento de federação', (await fsCall('DELETE', `users/${A.uid}/private/federation`, { token: A.token })));
const leDono = await fsGetDoc(`users/${A.uid}/private/federation`, A.token);
confere('(controle) o DONO lê o próprio estado de federação', leDono.status === 200 && leDono.doc?.enabled === true, `HTTP ${leDono.status}`);
negado('OUTRA pessoa não lê o estado de federação de A', (await fsGetDoc(`users/${A.uid}/private/federation`, B.token)));
negado('anônimo não lê o estado de federação de A', (await fsGetDoc(`users/${A.uid}/private/federation`, null)));

// ── coleções do servidor: nada de cliente ──
for (const caminho of [`ap_keys/${A.uid}`, 'ap_handles/a', 'config/federation', 'ap_followers/x', 'ap_deliveries/x', 'ap_outbound/x', 'ap_seen/x', 'ap_remote_actors/x', 'ap_user_blocks/x', 'ap_instance_policy/x', 'ap_objects/x', 'ap_audit/x', 'ap_flags/x', 'ap_stats/x', 'ap_domain_health/x']) {
  negado(`ler ${caminho} é recusado`, await fsGetDoc(caminho, A.token));
  negado(`gravar ${caminho} é recusado`, await fsSet(caminho, { enabled: true, ok: 1 }, A.token));
}
negado('listar ap_followers é recusado', await fsCall('GET', 'ap_followers', { token: A.token }));
negado('listar ap_keys é recusado (a chave privada cifrada nunca chega ao cliente)', await fsCall('GET', 'ap_keys', { token: A.token }));
negado('ligar a plataforma pelo cliente (config/federation) é recusado', await fsSet('config/federation', { enabled: true, killSwitch: false }, A.token));

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Regras da federação OK: opt-in obrigatório, alcance nunca maior que a visibilidade, fixo depois de criado.');
