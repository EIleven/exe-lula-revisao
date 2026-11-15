'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Post, PostPoll } from '@/lib/types';
import { db, functions } from '@/lib/firebase';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/haptics';
import { pollResults, pollTimeLeft } from '@/lib/poll';

interface PostPollProps {
  postId: string;
  poll: PostPoll;
  initialCounts?: Post['pollCounts'];
  initialTotal?: number | null;
  initialVote?: string | null;
}

type VoteResponse = {
  optionId: string;
  pollCounts: Record<string, number>;
  pollTotal: number;
};

const voteOnPoll = httpsCallable<{ postId: string; optionId: string }, VoteResponse>(functions, 'voteOnPoll');

// Um relógio compartilhado para todas as enquetes. Antes cada cartão criava o próprio setInterval e dezenas de enquetes
// podiam produzir dezenas de commits separados a cada 30 s durante a rolagem.
const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const getClockSnapshot = () => clockNow;
const subscribeClock = (listener: () => void) => {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      unstable_batchedUpdates(() => clockListeners.forEach((notify) => notify()));
    }, 30_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
};

const timestampMillis = (value: PostPoll['endsAt']): number => {
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const raw = value as unknown as { seconds?: number; _seconds?: number };
  return Number(raw?.seconds ?? raw?._seconds ?? 0) * 1000;
};

/** Enquete imutável do post. O voto e os contadores só são gravados pela Function transacional. */
export default function PostPoll({ postId, poll, initialCounts, initialTotal, initialVote }: PostPollProps) {
  const t = useTranslations('Poll');
  const currentUserId = useCurrentUserId();
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts ?? {});
  const [total, setTotal] = useState(Math.max(0, initialTotal ?? 0));
  const [myVote, setMyVote] = useState<string | null>(initialVote ?? null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
  const endsAt = timestampMillis(poll.endsAt);
  const time = pollTimeLeft(endsAt, now);

  useEffect(() => {
    setCounts(initialCounts ?? {});
    setTotal(Math.max(0, initialTotal ?? 0));
  }, [initialCounts, initialTotal, postId]);

  useEffect(() => {
    setMyVote(initialVote ?? null);
    if (!currentUserId || !postId || postId.startsWith('http')) return;
    let alive = true;
    void getDoc(doc(db, 'posts', postId, 'pollVotes', currentUserId)).then((snapshot) => {
      if (alive && snapshot.exists()) setMyVote(String(snapshot.data().optionId ?? '') || null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [currentUserId, initialVote, postId]);

  const rows = useMemo(() => pollResults(poll.options, counts, total), [poll.options, counts, total]);
  const showResults = !!myVote || time.ended;
  const timeLabel = time.ended
    ? t('ended')
    : time.days > 0
      ? t('remainingDays', { days: time.days, hours: time.hours })
      : time.hours > 0
        ? t('remainingHours', { hours: time.hours, minutes: time.minutes })
        : t('remainingMinutes', { minutes: Math.max(1, time.minutes) });

  const vote = async (optionId: string) => {
    if (!currentUserId) {
      toast({ title: t('loginRequired'), variant: 'destructive' });
      return;
    }
    if (myVote || time.ended || submitting) return;
    setSubmitting(optionId);
    try {
      const result = await voteOnPoll({ postId, optionId });
      setCounts(result.data.pollCounts);
      setTotal(result.data.pollTotal);
      setMyVote(result.data.optionId);
      haptics.success();
    } catch (error: unknown) {
      const code = String((error as { code?: string })?.code ?? '');
      toast({ title: code.includes('already-exists') ? t('alreadyVoted') : t('voteError'), variant: 'destructive' });
      if (code.includes('already-exists')) setMyVote(optionId);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section className="mb-3 space-y-2 rounded-lg border border-border p-3" aria-label={t('title')} data-testid="post-poll" onClick={(event) => event.stopPropagation()}>
      {rows.map((row) => {
        const selected = myVote === row.id;
        return (
          <button
            key={row.id}
            type="button"
            className={cn(
              'relative flex min-h-11 w-full overflow-hidden rounded-md border px-3 py-2 text-left [touch-action:manipulation]',
              !showResults && 'hover:border-primary hover:bg-primary/5',
              selected && 'border-primary',
            )}
            aria-label={t('vote', { option: row.text })}
            aria-pressed={selected}
            disabled={!!myVote || time.ended || !!submitting}
            onClick={() => void vote(row.id)}
            data-testid={`poll-option-${row.id}`}
          >
            {showResults && <span className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-300" style={{ width: `${row.percent}%` }} aria-hidden="true" />}
            <span className="relative z-10 flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-medium">{selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}{row.text}</span>
              {submitting === row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : showResults && <span className="text-sm font-semibold">{row.percent}%</span>}
            </span>
          </button>
        );
      })}
      <footer className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('votes', { count: total })}</span>
        <span>{timeLabel}</span>
      </footer>
    </section>
  );
}
