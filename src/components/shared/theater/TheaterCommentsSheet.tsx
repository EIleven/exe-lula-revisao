// src/components/shared/theater/TheaterCommentsSheet.tsx
// A gaveta de comentários do teatro de vídeo (bottom-sheet): lê com getCommentsForPost e grava com addCommentToPost, os MESMOS serviços
// da página do post. É própria (e não o CommentSection) porque o teatro fica por cima da tela inteira: os diálogos e menus do resto do app
// abririam ATRÁS dele. Respostas, curtidas de comentário e threads continuam na página do post (link no topo da gaveta).
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { ExternalLink, Loader2, Send, X } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Comment, Post } from '@/lib/types';
import { useCurrentUserId, useViewerSummary } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { getCommentsForPost, canUserReplyToLoadedPost } from '@/lib/services/comments/commentReadService';
import { addCommentToPost } from '@/lib/services/comments/commentWriteActions';
import { compactCount } from '@/lib/media/videoQueue';

const MAX_LENGTH = 1000;

function quando(valor: unknown, locale: string): string {
  try {
    const bruto = valor as { toDate?: () => Date } | string | number | null | undefined;
    const data = bruto && typeof bruto === 'object' && typeof bruto.toDate === 'function' ? bruto.toDate() : new Date(bruto as string | number);
    if (Number.isNaN(data.getTime())) return '';
    return formatDistanceToNow(data, { addSuffix: false, locale: locale === 'en' ? enUS : ptBR });
  } catch {
    return '';
  }
}

type Props = {
  post: Post;
  onClose: () => void;
  onNeedLogin: (acao: string) => void;
  /** Um comentário foi publicado aqui: o contador do ícone sobe. */
  onCommentAdded?: () => void;
};

export default function TheaterCommentsSheet({ post, onClose, onNeedLogin, onCommentAdded }: Props) {
  const locale = useLocale();
  const currentUserId = useCurrentUserId();
  const viewer = useViewerSummary();
  const { toast } = useToast();
  const [comentarios, setComentarios] = useState<Comment[] | null>(null);
  const [erro, setErro] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [podeResponder, setPodeResponder] = useState(true);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelado = false;
    setComentarios(null);
    setErro(false);
    const load = () => {
      getCommentsForPost(post.id, currentUserId)
        .then((lista) => {
          if (!cancelado) setComentarios(lista);
        })
        .catch((e) => {
          console.error('Teatro de vídeo: falha ao carregar comentários', e);
          if (!cancelado) setErro(true);
        });
    };
    load();
    const q = query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, () => load(), () => undefined);
    return () => {
      cancelado = true;
      unsub();
    };
  }, [post.id, currentUserId]);

  useEffect(() => {
    let cancelado = false;
    void canUserReplyToLoadedPost(post, viewer ? { id: viewer.id, username: viewer.username } : null)
      .then((ok) => {
        if (!cancelado) setPodeResponder(ok);
      })
      .catch(() => {
        if (!cancelado) setPodeResponder(true); // na dúvida, deixa tentar: o servidor decide
      });
    return () => {
      cancelado = true;
    };
  }, [post, viewer]);

  const enviar = async () => {
    const limpo = texto.trim();
    if (!limpo || enviando) return;
    if (!currentUserId) {
      onNeedLogin('comentar');
      return;
    }
    setEnviando(true);
    try {
      const novo = await addCommentToPost(post.id, currentUserId, { text: limpo });
      if (!novo) throw new Error('Não foi possível enviar o comentário. Seu texto foi mantido: tente de novo.');
      setComentarios((anteriores) => [novo, ...(anteriores ?? [])]);
      setTexto('');
      onCommentAdded?.();
    } catch (e) {
      toast({ title: 'Não foi possível comentar', description: friendlyErrorMessage(e, 'Seu texto foi mantido: tente de novo.'), variant: 'destructive' });
    } finally {
      setEnviando(false);
    }
  };

  const semPermissao = !!currentUserId && !podeResponder;
  const visiveis = (comentarios ?? []).filter((c) => !c.isDeleted);

  return (
    <>
      <button type="button" className="absolute inset-0 z-20 cursor-default bg-black/55" aria-label="Fechar comentários" onClick={onClose} tabIndex={-1} />
      <section
        role="dialog"
        aria-label="Comentários"
        data-testid="theater-comments"
        className="absolute inset-x-0 bottom-0 z-30 mx-auto flex max-h-[72dvh] min-h-[44dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-b-0 border-border bg-background text-foreground shadow-2xl"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        <header className="flex items-center justify-between gap-2 px-4 py-2">
          <h2 className="text-sm font-semibold">Comentários · {compactCount(Math.max(post.commentsCount ?? 0, visiveis.length))}</h2>
          <div className="flex items-center gap-1">
            <Link href={`/${locale}/post/${post.id}`} className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Abrir o post
            </Link>
            <button type="button" onClick={onClose} aria-label="Fechar comentários" className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2" aria-live="polite">
          {comentarios === null && !erro && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              <span className="ml-2 text-sm">Carregando…</span>
            </div>
          )}
          {erro && <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar os comentários agora.</p>}
          {comentarios !== null && visiveis.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Ainda não há comentários. Seja o primeiro.</p>}
          <ul className="space-y-4 py-2">
            {visiveis.map((c) => {
              const nome = c.user?.name ?? c.authorDetails?.name ?? '';
              const handle = c.user?.username ?? c.authorDetails?.username ?? '';
              return (
                <li key={c.id} className="flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={c.user?.avatarUrl ?? c.authorDetails?.avatarUrl} alt="" />
                    <AvatarFallback>{(nome || handle || 'U').substring(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{nome || `@${handle}`}</span> @{handle}
                      {quando(c.createdAt, locale) && <span> · {quando(c.createdAt, locale)}</span>}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {semPermissao ? (
            <p className="px-1 text-center text-xs text-muted-foreground">O autor limitou quem pode responder a este post.</p>
          ) : (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
            >
              <textarea
                ref={campoRef}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                onFocus={() => {
                  if (!currentUserId) onNeedLogin('comentar');
                }}
                rows={1}
                maxLength={MAX_LENGTH}
                placeholder="Escreva um comentário"
                aria-label="Escreva um comentário"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <button
                type="submit"
                disabled={enviando || texto.trim().length === 0}
                aria-label="Enviar comentário"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </button>
            </form>
          )}
        </footer>
      </section>
    </>
  );
}
