#!/usr/bin/env node
/**
 * Identidade das contas e objetos do Fediverso dentro do app: sem app, sem emuladores e sem rede.
 *   node e2e/ap-identidade-check.mjs        (ou: npm run e2e:ap-identidade)
 *
 * O que precisa ser verdade:
 *   - o id local de um ator/post remoto é estável (ids já gravados em produção dependem do texto exato);
 *   - uma conta ou post do NOSSO domínio é reconhecido como nosso e NUNCA vira `ap_...` (o caso @Breno);
 *   - o documento que um servidor remoto devolve como "ator" só vale se for de quem dissemos: id igual à URL pedida,
 *     usuário igual ao do handle, host coerente e caixas de entrada no mesmo host (cada recusa fecha um ataque);
 *   - ninguém recalcula `ap_<hash>` por conta própria fora deste módulo (o que existia em quinze lugares).
 *
 * Sai com código 1 se algo falhar.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ri = await import('../src/lib/activitypub/remoteIdentity.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ORIGEM = 'https://exercitodolula.app';
const HOST = 'exercitodolula.app';
let falhas = 0;
let total = 0;
function confere(nome, condicao, motivo, detalhe) {
  total++;
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}
const sha = (t) => createHash('sha256').update(t).digest('hex');

// ───────────── 1. ids locais ─────────────
{
  const ator = 'https://mastodon.social/users/Gargron';
  confere('ID · remoteUserIdOf = ap_ + 24 hex do sha256 da URL exata (compatível com o que já está gravado)',
    ri.remoteUserIdOf(ator) === `ap_${sha(ator).slice(0, 24)}` && /^ap_[0-9a-f]{24}$/.test(ri.remoteUserIdOf(ator)), ri.remoteUserIdOf(ator));
  confere('ID · NÃO normaliza a URL (barra final e caixa mudam o id; ids antigos dependem disso)',
    ri.remoteUserIdOf(`${ator}/`) !== ri.remoteUserIdOf(ator) && ri.remoteUserIdOf(ator.toLowerCase()) !== ri.remoteUserIdOf(ator), 'normalizou');
  const obj = 'https://mastodon.social/users/Gargron/statuses/115000000000000001';
  confere('ID · remotePostIdOf = ap_ + 24 hex', ri.remotePostIdOf(obj) === `ap_${sha(obj).slice(0, 24)}`, ri.remotePostIdOf(obj));
  confere('ID · remoteFollowDocIdOf = 32 hex (herança do primeiro desenho de ap_following)', ri.remoteFollowDocIdOf(ator) === sha(ator).slice(0, 32), ri.remoteFollowDocIdOf(ator));
  confere('ID · isRemoteId reconhece ap_ e só ap_', ri.isRemoteId('ap_abc') && !ri.isRemoteId('qdnRsBvLG8NdwrLv9GwiHDa1xi42') && !ri.isRemoteId(null) && !ri.isRemoteId(42), 'reconhecimento errado');
}

// ───────────── 2. id canônico do objeto (uri, não url) ─────────────
{
  const uri = 'https://organica.social/users/gus/statuses/117607259043591585';
  const url = 'https://organica.social/@gus/117607259043591585';
  confere('CANÔNICO · prefere o id ActivityPub (uri) à página (url): o mesmo post tem UM id, venha do inbox ou do perfil',
    ri.canonicalObjectId({ uri, url }) === uri, ri.canonicalObjectId({ uri, url }));
  confere('CANÔNICO · sem uri, usa a url', ri.canonicalObjectId({ uri: null, url }) === url, 'não caiu para a url');
  confere('CANÔNICO · recusa o que não é https e o que não é texto',
    ri.canonicalObjectId({ uri: 'http://x/1', url: undefined }) === null && ri.canonicalObjectId({ uri: 42, url: {} }) === null, 'aceitou lixo');
}

// ───────────── 3. o que é NOSSO ─────────────
{
  confere('NOSSO · URL do ator do nosso domínio → o handle em minúsculas', ri.ownActorHandle(`${ORIGEM}/ap/users/breno`, ORIGEM) === 'breno', 'não reconheceu');
  confere('NOSSO · caixa alta e barra final não enganam', ri.ownActorHandle(`${ORIGEM}/ap/users/Breno/`, ORIGEM) === 'breno', String(ri.ownActorHandle(`${ORIGEM}/ap/users/Breno/`, ORIGEM)));
  confere('NOSSO · ator de OUTRO servidor com o mesmo caminho não é nosso', ri.ownActorHandle('https://mastodon.social/ap/users/breno', ORIGEM) === null, 'tomou ator alheio por nosso');
  confere('NOSSO · a caixa de entrada não é "o ator"', ri.ownActorHandle(`${ORIGEM}/ap/users/breno/inbox`, ORIGEM) === null, 'inbox lido como ator');
  confere('NOSSO · isOwnHostUrl compara o host (porta e caminho não mudam de quem é o domínio)',
    ri.isOwnHostUrl(`${ORIGEM}/qualquer/coisa`, HOST) && ri.isOwnHostUrl('https://exercitodolula.app:8443/x', HOST) && !ri.isOwnHostUrl('https://exercitodolula.app.evil.com/x', HOST) && !ri.isOwnHostUrl('https://evil.com/exercitodolula.app', HOST), 'comparação de host errada');
  confere('NOSSO · "exercitodolula.app.evil.com" NÃO é nosso (comparação por prefixo seria o buraco)', !ri.isOwnHostUrl('https://exercitodolula.app.evil.com/ap/users/breno', HOST), 'prefixo enganou');

  const p = (u) => ri.ownPostRef(u, ORIGEM);
  confere('POST · nota ActivityPub', JSON.stringify(p(`${ORIGEM}/ap/notes/RpaJWoPgWd59vhpmMS3R`)) === JSON.stringify({ postId: 'RpaJWoPgWd59vhpmMS3R', commentId: null }), JSON.stringify(p(`${ORIGEM}/ap/notes/RpaJWoPgWd59vhpmMS3R`)));
  confere('POST · comentário ActivityPub: o id do COMENTÁRIO vem junto (curtir um comentário não é curtir o post)',
    JSON.stringify(p(`${ORIGEM}/ap/notes/P1/comments/C9`)) === JSON.stringify({ postId: 'P1', commentId: 'C9' }), JSON.stringify(p(`${ORIGEM}/ap/notes/P1/comments/C9`)));
  confere('POST · página web do post, em qualquer idioma', p(`${ORIGEM}/pt-BR/post/P2`)?.postId === 'P2' && p(`${ORIGEM}/en/post/P3?x=1#y`)?.postId === 'P3', 'página não reconhecida');
  confere('POST · URL de OUTRO servidor com o mesmo desenho não é post nosso', p('https://outro.com/ap/notes/P1') === null && p('https://outro.com/pt-BR/post/P1') === null, 'tomou post alheio por nosso');
  confere('POST · perfil, ator e coisas que não são post → null', p(`${ORIGEM}/pt-BR/profile/U1`) === null && p(`${ORIGEM}/ap/users/breno`) === null && p(null) === null && p(`${ORIGEM}/ap/notes/`) === null, 'confundiu com post');
  confere('POST · id com caractere fora do padrão é recusado (nada de ../ no meio)', p(`${ORIGEM}/ap/notes/..%2Fx`) === null && p(`${ORIGEM}/ap/notes/a/comments/b/c`) === null, 'aceitou id malformado');
  confere('ACCT · @Breno@exercitodolula.app → handle local "breno"; de outro host → null',
    ri.ownHandleOfAcct('Breno', 'exercitodolula.app', HOST) === 'breno' && ri.ownHandleOfAcct('Breno', 'ExercitoDoLula.App', HOST) === 'breno'
      && ri.ownHandleOfAcct('Breno', 'mastodon.social', HOST) === null, 'acct próprio mal resolvido');
  confere('HOST · sameHost compara o host das duas URLs', ri.sameHost('https://um.com.br/x', 'https://um.com.br/y') && !ri.sameHost('https://um.com.br/x', 'https://dois.com.br/x') && !ri.sameHost(null, 'https://um.com.br/x'), 'sameHost errado');
}

// ───────────── 4. o documento de ator é de quem dissemos? ─────────────
{
  const base = () => ({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://mastodon.social/users/gargron',
    type: 'Person',
    preferredUsername: 'Gargron',
    inbox: 'https://mastodon.social/users/gargron/inbox',
    outbox: 'https://mastodon.social/users/gargron/outbox',
    endpoints: { sharedInbox: 'https://mastodon.social/inbox' },
  });
  const valida = (json, extra = {}) => ri.validateFetchedActor({
    requestedUrl: 'https://mastodon.social/users/gargron', handleUser: 'Gargron', handleDomain: 'mastodon.social', json, ownHost: HOST, ...extra,
  });
  const ok = valida(base());
  confere('ATOR · um ator íntegro passa, com o handle do usuário declarado', ok.ok && ok.actor.handle === 'Gargron@mastodon.social' && ok.actor.inbox.endsWith('/inbox') && ok.actor.sharedInbox === 'https://mastodon.social/inbox', JSON.stringify(ok));
  const razao = (json, extra) => { const r = valida(json, extra); return r.ok ? 'ok' : r.reason; };

  confere('ATOR · "id" diferente da URL pedida → recusado (envenenamento do cache de OUTRO ator)',
    razao({ ...base(), id: 'https://mastodon.social/users/outra-pessoa' }) === 'id-divergente', razao({ ...base(), id: 'https://mastodon.social/users/outra-pessoa' }));
  confere('ATOR · servidor hostil devolvendo o id de um ator de OUTRO servidor → recusado',
    razao({ ...base(), id: 'https://mastodon.social/users/gargron' }, { requestedUrl: 'https://evil.com/actor', handleDomain: 'evil.com' }) === 'id-divergente', 'aceitou o id de outro servidor');
  confere('ATOR · servidor hostil devolvendo o id do NOSSO @Breno → recusado como ator-proprio (o fantasma de produção)',
    razao({ ...base(), id: `${ORIGEM}/ap/users/breno`, preferredUsername: 'x' }, { requestedUrl: 'https://evil.com/actor', handleUser: 'x', handleDomain: 'evil.com' }) === 'ator-proprio', 'um ator nosso foi aceito como remoto');
  confere('ATOR · pedir diretamente o ator do nosso domínio → recusado (nunca é remoto)',
    razao({ ...base(), id: `${ORIGEM}/ap/users/breno`, preferredUsername: 'breno', inbox: `${ORIGEM}/ap/users/breno/inbox`, endpoints: {} },
      { requestedUrl: `${ORIGEM}/ap/users/breno`, handleUser: 'breno', handleDomain: 'exercitodolula.app' }) === 'ator-proprio', 'aceitou o nosso ator como remoto');
  confere('ATOR · inbox em OUTRO host → recusado (a entrega iria para onde o ator escolheu)', razao({ ...base(), inbox: 'https://coletor.com/inbox' }) === 'inbox-de-outro-host', razao({ ...base(), inbox: 'https://coletor.com/inbox' }));
  confere('ATOR · sharedInbox em OUTRO host → recusado', razao({ ...base(), endpoints: { sharedInbox: 'https://coletor.com/inbox' } }) === 'inbox-de-outro-host', 'aceitou sharedInbox de fora');
  confere('ATOR · inbox que não é https → recusado', razao({ ...base(), inbox: 'http://mastodon.social/inbox' }) === 'inbox-de-outro-host', 'aceitou http');
  confere('ATOR · preferredUsername diferente do handle → recusado', razao({ ...base(), preferredUsername: 'outro' }) === 'usuario-divergente', razao({ ...base(), preferredUsername: 'outro' }));
  confere('ATOR · caixa alta no usuário não é divergência', razao({ ...base(), preferredUsername: 'GARGRON' }, { handleUser: 'gargron' }) === 'ok', 'recusou por maiúsculas');
  confere('ATOR · tipo que não é ator (Note) → recusado', razao({ ...base(), type: 'Note' }) === 'tipo-invalido', 'aceitou Note como ator');
  confere('ATOR · lixo (null, texto, lista) → recusado', ['tipo-invalido'].every((r) => razao(null) === r && razao('x') === r && razao([]) === r), 'aceitou lixo');
  confere('ATOR · sem caixa de entrada é aceito (basta para MOSTRAR o perfil; seguir exige inbox)', valida({ ...base(), inbox: undefined, endpoints: undefined }).ok === true, 'recusou ator sem inbox');
  // delegação por WEB_DOMAIN: o handle é user@example.com e o ator mora em social.example.com
  confere('ATOR · delegação: ator em social.example.com para o handle user@example.com é aceito',
    razao({ ...base(), id: 'https://social.example.com/users/user', preferredUsername: 'user', inbox: 'https://social.example.com/users/user/inbox', outbox: undefined, endpoints: {} },
      { requestedUrl: 'https://social.example.com/users/user', handleUser: 'user', handleDomain: 'example.com' }) === 'ok', 'recusou delegação legítima');
  confere('ATOR · domínio sem parentesco com o handle → recusado (o servidor A não responde por pessoas de B)',
    razao({ ...base(), id: 'https://dois.com.br/users/user', preferredUsername: 'user', inbox: 'https://dois.com.br/inbox', endpoints: {} },
      { requestedUrl: 'https://dois.com.br/users/user', handleUser: 'user', handleDomain: 'um.com.br' }) === 'host-divergente', 'aceitou domínio sem parentesco');
  confere('ATOR · "example.com.evil.com" não é subdomínio de example.com',
    razao({ ...base(), id: 'https://example.com.evil.com/users/user', preferredUsername: 'user', inbox: 'https://example.com.evil.com/inbox', endpoints: {} },
      { requestedUrl: 'https://example.com.evil.com/users/user', handleUser: 'user', handleDomain: 'example.com' }) === 'host-divergente', 'sufixo enganou');
  confere('ATOR · a URL final de um redirecionamento também vale como "a URL pedida"',
    razao({ ...base(), id: 'https://mastodon.social/users/gargron' }, { requestedUrl: 'https://mastodon.social/@gargron', finalUrl: 'https://mastodon.social/users/gargron' }) === 'ok', 'recusou o redirecionamento legítimo');
}

// ───────────── 5. guarda de arquitetura: ninguém recalcula ap_<hash> fora do módulo ─────────────
{
  const permitidos = new Set(['src/lib/activitypub/remoteIdentity.ts']);
  const ignorar = new Set(['node_modules', '.next', '.git']);
  const arquivos = [];
  const anda = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (ignorar.has(nome)) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) anda(caminho);
      else if (/\.(ts|tsx)$/.test(nome)) arquivos.push(caminho);
    }
  };
  anda(join(RAIZ, 'src'));
  const reincidentes = [];
  for (const arquivo of arquivos) {
    const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
    if (permitidos.has(rel)) continue;
    const texto = readFileSync(arquivo, 'utf8');
    if (/`ap_\$\{[^`]*(createHash|\.digest\(|\.slice\(0,\s*\d+\)|sha\()/.test(texto)) reincidentes.push(rel);
    // O hash "puro" de 24 ou 32 hex também é de remoteIdentity (id do ator, do objeto e do vínculo de "seguindo").
    else if (/createHash\('sha256'\)\.update\([^)]*\)\.digest\('hex'\)\.slice\(0,\s*(24|32)\)/.test(texto)) reincidentes.push(rel);
  }
  confere('ARQUITETURA · nenhum arquivo monta `ap_${hash}` por conta própria (use remoteIdentity)', reincidentes.length === 0, `recalculam o id: ${reincidentes.join(', ')}`);
}

console.log('');
console.log(`${total} verificações.`);
if (falhas) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log('Identidade remota OK: um ator ou post do nosso domínio nunca vira ap_, e o ator buscado só vale se for de quem dissemos.');
