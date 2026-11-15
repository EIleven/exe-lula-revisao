// src/lib/services/posts/visibility.ts
import type { PostVisibility, User } from '@/lib/types';

/**
 * Todo post nasce com a visibilidade do perfil do autor (as regras do Firestore exigem): perfil privado -> só para
 * seguidores; público -> público. Quando o perfil muda, a Function onUserUpdated leva os posts antigos junto.
 */
export const postVisibilityFor = (author: Pick<User, 'profileVisibility'>): PostVisibility =>
  author.profileVisibility === 'private' ? 'followers' : 'public';
