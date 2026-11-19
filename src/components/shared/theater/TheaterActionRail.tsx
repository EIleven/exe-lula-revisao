// src/components/shared/theater/TheaterActionRail.tsx
// Os ícones flutuantes do teatro de vídeo (Curtir, Comentários, Repostar, Salvar, velocidade) e o bloco do autor (avatar, @, Seguir).
// Reaproveita os motores que o cartão do feed já usa (usePostMainInteractions e useFollowToggle): respondem na hora, sincronizam com
// os outros cartões e desfazem sozinhos se o servidor recusar. Sem login, pedem login em vez de falhar calados.
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Bookmark, Check, Gauge, Heart, MessageCircle, Plus, Repeat2 } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Post } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { usePostMainInteractions } from '@/hooks/features/post/usePostMainInteractions';
import { useFollowToggle } from '@/hooks/features/profile/useFollowToggle';
import { getCachedPostInteraction } from '@/lib/events/postInteractionState';
import { useToast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { compactCount } from '@/lib/media/videoQueue';

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const botao =
  'flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const contagem = 'text-[11px] font-medium leading-none text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]';

function authorOf(post: Post) {
  return {
    name: post.user?.name ?? post.authorDetails?.name ?? '',
    username: post.user?.username ?? post.authorDetails?.username ?? '',
    avatarUrl: post.user?.avatarUrl ?? post.authorDetails?.avatarUrl,
  };
}

/** Avatar, @ e "Seguir" do autor + o começo do texto do post, no canto de baixo à esquerda. */
export function TheaterAuthorInfo({ post, onNeedLogin }: { post: Post; onNeedLogin: (acao: string) => void }) {
  const locale = useLocale();
  const currentUserId = useCurrentUserId();
  const { toast } = useToast();
  const autor = authorOf(post);
  const isSelf = !!currentUserId && currentUserId === post.userId;
  const follow = useFollowToggle({
    activeUserId: currentUserId,
    targetUserId: post.userId,
    isFollowing: post.user?.isFollowing,
    followersCount: post.user?.followersCount,
    onFailure: (error) => {
      toast({ title: 'Não foi possível atualizar', description: friendlyErrorMessage(error, 'Verifique a conexão e tente de novo.'), variant: 'destructive' });
    },
  });
  const onFollow = () => {
    if (!currentUserId) {
      onNeedLogin('seguir');
      return;
    }
    if (!isSelf) follow.toggle();
  };
  const texto = (post.text ?? post.headline ?? '').replace(/\s+/g, ' ').trim();
  return (
    <div className="pointer-events-auto max-w-[min(26rem,calc(100%-6.5rem))] space-y-2 text-white">
      <div className="flex items-center gap-2">
        <Link href={`/${locale}/profile/${post.userId}`} className="flex min-w-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Perfil de ${autor.name || autor.username}`}>
          <Avatar className="h-9 w-9 shrink-0 ring-2 ring-white/70">
            <AvatarImage src={autor.avatarUrl} alt="" />
            <AvatarFallback>{(autor.name || autor.username || 'U').substring(0, 1)}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">@{autor.username}</span>
        </Link>
        {!isSelf && (
          <button
            type="button"
            onClick={onFollow}
            aria-pressed={follow.isFollowing}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              follow.isFollowing ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {follow.isFollowing ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {follow.isFollowing ? 'Seguindo' : 'Seguir'}
          </button>
        )}
      </div>
      {texto && <p className="line-clamp-2 text-sm leading-snug [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">{texto}</p>}
    </div>
  );
}

type RailProps = {
  post: Post;
  /** Comentários publicados na gaveta nesta sessão (somam ao contador do post). */
  commentsBonus?: number;
  speed: number;
  onSpeedChange: (velocidade: number) => void;
  onOpenComments: () => void;
  onNeedLogin: (acao: string) => void;
};

/** A coluna de ícones da direita. `post` é o do item ativo; o contador de comentários vem de fora quando a gaveta adiciona um. */
export function TheaterActionRail({ post: initialPost, commentsBonus = 0, speed, onSpeedChange, onOpenComments, onNeedLogin }: RailProps) {
  const currentUserId = useCurrentUserId();
  const [post, setPost] = useState<Post | null>(() => {
    const cached = getCachedPostInteraction(currentUserId, initialPost.id);
    return cached ? { ...initialPost, ...cached } : initialPost;
  });
  const interactions = usePostMainInteractions({ post, setPost, currentUserId, openLoginPrompt: onNeedLogin });
  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sincronia em tempo real dos contadores (curtidas, reposts, comentários) com o Firestore.
  useEffect(() => {
    if (!initialPost.id) return;
    const unsub = onSnapshot(
      doc(db, 'posts', initialPost.id),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Partial<Post>;
        setPost((prev) =>
          prev
            ? {
                ...prev,
                likes: typeof data.likes === 'number' ? data.likes : prev.likes,
                reposts: typeof data.reposts === 'number' ? data.reposts : prev.reposts,
                commentsCount: typeof data.commentsCount === 'number' ? data.commentsCount : prev.commentsCount,
                quotesCount: typeof data.quotesCount === 'number' ? data.quotesCount : prev.quotesCount,
              }
            : prev
        );
      },
      () => undefined
    );
    return () => unsub();
  }, [initialPost.id]);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuAberto(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [menuAberto]);

  if (!post) return null;
  const curtido = !!post.isLiked;
  const repostado = !!post.isReposted;
  const salvo = !!post.isBookmarked;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-3" data-testid="theater-action-rail">
      <div className="flex flex-col items-center gap-1">
        <button type="button" className={cn(botao, curtido && 'text-[hsl(var(--like))]')} onClick={(e) => interactions.handleLikePost(e)} aria-pressed={curtido} aria-label={curtido ? 'Descurtir' : 'Curtir'}>
          <Heart className="h-6 w-6" fill={curtido ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        <span className={contagem}>{compactCount(post.likes)}</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <button type="button" className={botao} onClick={onOpenComments} aria-label="Comentários">
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className={contagem}>{compactCount((post.commentsCount ?? 0) + commentsBonus)}</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          className={cn(botao, repostado && 'text-[hsl(var(--repost))]')}
          onClick={(e) => interactions.handleRepostToggle(e)}
          disabled={post.allowReposts === false}
          aria-pressed={repostado}
          aria-label={repostado ? 'Desfazer repost' : 'Repostar'}
        >
          <Repeat2 className="h-6 w-6" aria-hidden="true" />
        </button>
        <span className={contagem}>{compactCount(post.reposts)}</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <button type="button" className={cn(botao, salvo && 'text-primary')} onClick={(e) => interactions.handleBookmarkPost(e)} aria-pressed={salvo} aria-label={salvo ? 'Remover dos salvos' : 'Salvar'}>
          <Bookmark className="h-6 w-6" fill={salvo ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>

      <div ref={menuRef} className="relative flex flex-col items-center gap-1">
        <button type="button" className={cn(botao, speed !== 1 && 'text-primary')} onClick={() => setMenuAberto((v) => !v)} aria-haspopup="menu" aria-expanded={menuAberto} aria-label="Velocidade de reprodução">
          <Gauge className="h-6 w-6" aria-hidden="true" />
        </button>
        {speed !== 1 && <span className={contagem}>{speed}×</span>}
        {menuAberto && (
          <div role="menu" aria-label="Velocidade" className="absolute bottom-0 right-14 w-28 overflow-hidden rounded-xl border border-white/10 bg-black/85 py-1 text-sm text-white shadow-xl backdrop-blur">
            {PLAYBACK_SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={v === speed}
                onClick={() => {
                  onSpeedChange(v);
                  setMenuAberto(false);
                }}
                className={cn('flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none', v === speed && 'text-primary')}
              >
                <span>{v === 1 ? 'Normal' : `${v}×`}</span>
                {v === speed && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
