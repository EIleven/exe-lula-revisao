// src/lib/federation/remoteId.ts
// Ids de conteúdo materializado do Fediverso (`users/ap_…`, `posts/ap_…`). SEGURO PARA O NAVEGADOR: sem node:crypto. O cálculo do
// id (o hash) mora em src/lib/activitypub/remoteIdentity.ts, que só roda no servidor.

export const REMOTE_ID_PREFIX = 'ap_';

/** O id é de um usuário, post ou comentário materializado do Fediverso? */
// Devolve `boolean` e NÃO um type guard (`id is string`): com guard, `.filter((id) => !isRemoteId(id))` num `string[]` é inferido
// como "id is never" e o resultado vira `never[]`.
export const isRemoteId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(REMOTE_ID_PREFIX);
