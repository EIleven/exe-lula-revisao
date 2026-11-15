'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getUser } from '@/lib/services/userService';
import type { Comment, User } from '@/lib/types';
import UserListItem from '@/components/profile/UserListItem';
import { Loader2, Heart, Repeat2, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

export type CommentInteractionTab = 'likes' | 'reposts' | 'quotes';

interface CommentInteractionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comment: Comment;
  currentUserId: string | null;
  initialTab?: CommentInteractionTab;
}

interface QuotePreview {
  postId: string;
  user: User;
  text: string;
}

export function CommentInteractionsDialog({
  open,
  onOpenChange,
  comment,
  currentUserId,
  initialTab = 'likes',
}: CommentInteractionsDialogProps) {
  const locale = useLocale();
  const { firebaseUser } = useCurrentUser();
  const [tab, setTab] = useState<CommentInteractionTab>(initialTab);
  const [likesUsers, setLikesUsers] = useState<User[]>([]);
  const [repostsUsers, setRepostsUsers] = useState<User[]>([]);
  const [quotesList, setQuotesList] = useState<QuotePreview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRemoteRestricted, setIsRemoteRestricted] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || !comment.parentPostId || !comment.id) return;
    let active = true;
    setIsLoading(true);
    setIsRemoteRestricted(false);

    const isRemoteComment =
      comment.id.startsWith('ap_') ||
      Boolean((comment as Comment & { isRemoteFediverse?: boolean }).isRemoteFediverse);

    const fetchRemoteReactors = async (mode: 'likes' | 'reposts'): Promise<{ users: User[]; restricted: boolean }> => {
      if (!isRemoteComment) {
        return { users: [], restricted: false };
      }
      try {
        const headers: Record<string, string> = {};
        if (firebaseUser) {
          headers.Authorization = `Bearer ${await firebaseUser.getIdToken()}`;
        }
        const res = await fetch(
          `/api/ap/remote-post-interactions?postId=${encodeURIComponent(comment.parentPostId)}&commentId=${encodeURIComponent(comment.id)}&mode=${mode}`,
          { headers }
        );
        if (!res.ok) return { users: [], restricted: false };
        const data = (await res.json()) as { users?: User[]; restricted?: boolean };
        return {
          users: Array.isArray(data.users) ? data.users : [],
          restricted: Boolean(data.restricted),
        };
      } catch {
        return { users: [], restricted: false };
      }
    };

    const mergeUsers = (localUsers: User[], remoteUsers: User[]): User[] => {
      const map = new Map<string, User>();
      for (const u of localUsers) map.set(u.id, u);
      for (const u of remoteUsers) {
        if (!map.has(u.id)) map.set(u.id, u);
      }
      return Array.from(map.values());
    };

    const load = async () => {
      try {
        if (tab === 'likes') {
          const [snap, remote] = await Promise.all([
            getDocs(
              query(
                collection(db, 'posts', comment.parentPostId, 'comments', comment.id, 'likes'),
                limit(50)
              )
            ),
            fetchRemoteReactors('likes'),
          ]);
          const localUsers = (
            await Promise.all(snap.docs.map((d) => getUser(d.id, currentUserId)))
          ).filter((u): u is User => Boolean(u));
          if (active) {
            setLikesUsers(mergeUsers(localUsers, remote.users));
            setIsRemoteRestricted(remote.restricted);
          }
        } else if (tab === 'reposts') {
          const [snap, remote] = await Promise.all([
            getDocs(
              query(
                collection(db, 'posts', comment.parentPostId, 'comments', comment.id, 'reposts'),
                limit(50)
              )
            ),
            fetchRemoteReactors('reposts'),
          ]);
          const localUsers = (
            await Promise.all(snap.docs.map((d) => getUser(d.id, currentUserId)))
          ).filter((u): u is User => Boolean(u));
          if (active) {
            setRepostsUsers(mergeUsers(localUsers, remote.users));
            setIsRemoteRestricted(remote.restricted);
          }
        } else {
          const snap = await getDocs(
            query(
              collection(db, 'posts'),
              where('quotedCommentId', '==', comment.id),
              limit(30)
            )
          );
          const items = (
            await Promise.all(
              snap.docs.map(async (d) => {
                const data = d.data();
                if (data.isDeleted) return null;
                const u = await getUser(data.userId, currentUserId);
                if (!u) return null;
                return { postId: d.id, user: u, text: data.text || '' };
              })
            )
          ).filter((q): q is QuotePreview => Boolean(q));
          if (active) setQuotesList(items);
        }
      } catch (err) {
        console.error('Failed to load comment interactions:', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [open, tab, comment, currentUserId, firebaseUser]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-1.25rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background p-4 sm:p-5">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle className="text-base sm:text-lg font-bold">
            Interações no comentário
          </DialogTitle>
          <DialogDescription className="sr-only">
            Lista de pessoas que curtiram, repostaram ou citaram este comentário.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-1 rounded-full border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setTab('likes')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-colors',
              tab === 'likes'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Heart className="h-3.5 w-3.5" />
            Curtidas
          </button>
          <button
            type="button"
            onClick={() => setTab('reposts')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-colors',
              tab === 'reposts'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Repeat2 className="h-3.5 w-3.5" />
            Reposts
          </button>
          <button
            type="button"
            onClick={() => setTab('quotes')}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-colors',
              tab === 'quotes'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Quote className="h-3.5 w-3.5" />
            Citações
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tab === 'likes' ? (
            likesUsers.length > 0 ? (
              <div className="divide-y divide-border/50">
                {likesUsers.map((u) => (
                  <UserListItem key={u.id} userToList={u} activeUserId={currentUserId} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground px-4">
                {isRemoteRestricted
                  ? 'A instância de origem no Fediverso não expôs publicamente a lista de quem curtiu.'
                  : 'Nenhuma curtida ainda.'}
              </p>
            )
          ) : tab === 'reposts' ? (
            repostsUsers.length > 0 ? (
              <div className="divide-y divide-border/50">
                {repostsUsers.map((u) => (
                  <UserListItem key={u.id} userToList={u} activeUserId={currentUserId} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground px-4">
                {isRemoteRestricted
                  ? 'A instância de origem no Fediverso não expôs publicamente a lista de quem repostou.'
                  : 'Nenhum repost ainda.'}
              </p>
            )
          ) : quotesList.length > 0 ? (
            <div className="divide-y divide-border/50">
              {quotesList.map((q) => (
                <Link
                  key={q.postId}
                  href={`/${locale}/post/${q.postId}`}
                  onClick={() => onOpenChange(false)}
                  className="block rounded-lg p-3 transition-colors hover:bg-muted/30"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {q.user.name}{' '}
                    <span className="font-normal text-muted-foreground">@{q.user.username}</span>
                  </p>
                  {q.text && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{q.text}</p>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma citação ainda.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

