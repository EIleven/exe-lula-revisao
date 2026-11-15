// Alcance de um post no Fediverso. Fica FIXO depois de criado (as regras do Firestore não deixam editar o campo): um
// post local não vira público por uma edição. Sem o campo, vale 'local'.
export type FederationReach = 'local' | 'public' | 'unlisted' | 'followers';

export const FEDERATION_REACHES: readonly FederationReach[] = ['local', 'public', 'unlisted', 'followers'];

export const isFederatedReach = (r: FederationReach | undefined | null): r is Exclude<FederationReach, 'local'> =>
  r === 'public' || r === 'unlisted' || r === 'followers';
