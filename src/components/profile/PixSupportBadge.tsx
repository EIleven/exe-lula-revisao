'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Bell, BellRing, Check, Copy, QrCode, Share2, Sparkles } from 'lucide-react';
import { useLocale } from 'next-intl';
import { doc, deleteDoc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCurrentUserId } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { describePixKeyType, generatePixPayload } from '@/lib/pix/brCode';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PixSupportBadgeProps {
  user: User;
  compact?: boolean;
  defaultOpen?: boolean;
}

const PRESET_AMOUNTS = [0, 5, 10, 25, 50];
const REMINDER_DAYS = [5, 10, 15, 20, 25];

export default function PixSupportBadge({
  user,
  compact = false,
  defaultOpen = false,
}: PixSupportBadgeProps) {
  const pixKey = user.pixKey?.trim() || '';
  const locale = useLocale();
  const activeUserId = useCurrentUserId();
  const { toast } = useToast();

  const [open, setOpen] = useState(defaultOpen);
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const [monthlyReminder, setMonthlyReminder] = useState(false);
  const [reminderDay, setReminderDay] = useState<number>(() => Math.min(25, Math.max(1, new Date().getDate())));
  const [isSavingReminder, setIsSavingReminder] = useState(false);

  const effectiveAmount = useMemo(() => {
    const parsed = Number(customAmount.replace(',', '.'));
    if (customAmount.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return selectedAmount > 0 ? selectedAmount : null;
  }, [customAmount, selectedAmount]);

  const pixPayload = useMemo(() => {
    if (!pixKey) return '';
    return generatePixPayload({
      pixKey,
      merchantName: user.name || user.username,
      merchantCity: user.pixCity || user.location || 'Brasil',
      amount: effectiveAmount,
      description: user.pixDescription || undefined,
    });
  }, [pixKey, user.name, user.username, user.pixCity, user.location, user.pixDescription, effectiveAmount]);

  useEffect(() => {
    if (!open || !pixPayload) return;
    let cancelled = false;
    QRCode.toDataURL(pixPayload, {
      width: 240,
      margin: 2,
      color: { dark: '#09090b', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, pixPayload]);

  useEffect(() => {
    if (!open || !activeUserId || !user.id || activeUserId === user.id) return;
    let cancelled = false;
    getDoc(doc(db, 'users', activeUserId, 'pixReminders', user.id))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as { active?: boolean; dayOfMonth?: number };
        setMonthlyReminder(data.active !== false);
        if (typeof data.dayOfMonth === 'number' && data.dayOfMonth >= 1 && data.dayOfMonth <= 28) {
          setReminderDay(data.dayOfMonth);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, activeUserId, user.id]);

  if (!pixKey) return null;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${locale}/profile/${user.id}?pix=1`
      : `https://exercitodolula.app/${locale}/profile/${user.id}?pix=1`;

  const copyText = async (text: string, which: 'code' | 'key') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
        toast({ title: 'Código Pix copiado!', description: 'Cole no app do seu banco em Pix Copia e Cola.' });
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
        toast({ title: 'Chave Pix copiada!', description: text });
      }
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const persistMonthlyReminder = async (enabled: boolean, day: number) => {
    if (!activeUserId) {
      toast({
        title: 'Entre na sua conta',
        description: 'Faça login para ativar lembretes mensais de apoio via Pix.',
      });
      return;
    }
    setIsSavingReminder(true);
    try {
      const ref = doc(db, 'users', activeUserId, 'pixReminders', user.id);
      if (!enabled) {
        await deleteDoc(ref);
        setMonthlyReminder(false);
        toast({ title: 'Lembrete mensal desativado' });
      } else {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, day, 10, 0, 0);
        await setDoc(
          ref,
          {
            targetUserId: user.id,
            targetName: user.name,
            targetUsername: user.username,
            pixKey,
            dayOfMonth: day,
            active: true,
            nextReminderAt: nextMonth.toISOString(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setMonthlyReminder(true);
        setReminderDay(day);
        toast({
          title: 'Lembrete mensal ativado!',
          description: `Todo dia ${day} você poderá lembrar de apoiar @${user.username} com o valor que quiser.`,
        });
      }
    } catch {
      toast({
        title: 'Erro ao salvar lembrete',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingReminder(false);
    }
  };

  const handleShareExternal = async () => {
    const shareText = `Apoie ${user.name} (@${user.username}) via Pix no Exe. Lula:`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Apoiar ${user.name} via Pix`, text: shareText, url: shareUrl });
        return;
      } catch {
        // Fallback para copiar link
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: 'Link de apoio copiado!', description: 'Compartilhe onde quiser.' });
    } catch {
      toast({ title: 'Não foi possível compartilhar', variant: 'destructive' });
    }
  };

  const handleShareInNetwork = async () => {
    const postDraft = `Apoie ${user.name} (@${user.username}) via Pix 💚\n${shareUrl}`;
    try {
      await navigator.clipboard.writeText(postDraft);
      toast({
        title: 'Texto pronto para postar copiado!',
        description: 'Cole no compositor de post para divulgar este apoio na rede.',
      });
    } catch {
      toast({ title: 'Não foi possível copiar o texto', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-400/60 transition-all cursor-pointer font-medium',
            compact ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
          )}
          title="Apoiar via Pix"
        >
          <QrCode className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          <span>Pix</span>
          {!compact && <Sparkles className="h-3 w-3 opacity-80" />}
        </button>
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-md rounded-2xl border-border/80 bg-card/95 backdrop-blur-xl p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-emerald-500/15 via-primary/10 to-transparent px-6 pt-6 pb-4 border-b border-border/60">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Avatar className="h-11 w-11 ring-2 ring-emerald-500/40">
                <AvatarImage src={user.avatarUrl} alt={user.name} />
                <AvatarFallback>{user.name?.slice(0, 1) || 'U'}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 text-left">
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span className="truncate">{user.name}</span>
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 rounded-full text-[11px]">
                    Pix
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs truncate">
                  @{user.username} · Apoio via Pix
                </DialogDescription>
              </div>
            </div>
            {user.pixDescription && (
              <p className="mt-3 text-sm text-foreground/90 text-left">{user.pixDescription}</p>
            )}
          </DialogHeader>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Valor opcional */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Escolha um valor (opcional)</span>
              <span>Você decide quanto enviar</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_AMOUNTS.map((val) => {
                const isSelected = customAmount.trim() === '' && selectedAmount === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setCustomAmount('');
                      setSelectedAmount(val);
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                        : 'bg-secondary/50 border-border/70 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {val === 0 ? 'Livre' : `R$ ${val}`}
                  </button>
                );
              })}
              <Input
                type="text"
                inputMode="decimal"
                placeholder="Outro R$"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="h-7 w-24 rounded-full text-xs px-3"
              />
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
            {qrDataUrl ? (
              <div className="rounded-2xl bg-white p-3 shadow-md">
                <img src={qrDataUrl} alt={`QR Code Pix de ${user.name}`} className="h-44 w-44" />
              </div>
            ) : (
              <div className="h-44 w-44 rounded-2xl bg-muted animate-pulse" />
            )}

            <div className="w-full space-y-2">
              <Button
                type="button"
                onClick={() => void copyText(pixPayload, 'code')}
                className="w-full rounded-full bg-emerald-600 hover:bg-emerald-500 text-white"
                size="sm"
              >
                {copiedCode ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copiedCode ? 'Copia e Cola copiado' : 'Copiar Pix Copia e Cola'}
              </Button>
            </div>
          </div>

          {/* Lembrete mensal opcional */}
          {activeUserId !== user.id && (
            <div className="rounded-2xl border border-border/70 bg-secondary/25 p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    {monthlyReminder ? (
                      <BellRing className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    )}
                    Assinar lembrete mensal de Pix
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Opcional e sem compromisso: receba uma notificação mensal caso queira apoiar com o valor que desejar.
                  </p>
                </div>
                <Switch
                  checked={monthlyReminder}
                  disabled={isSavingReminder}
                  onCheckedChange={(checked) => void persistMonthlyReminder(checked, reminderDay)}
                />
              </div>
              {monthlyReminder && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground mr-1">Melhor dia:</span>
                  {REMINDER_DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      disabled={isSavingReminder}
                      onClick={() => void persistMonthlyReminder(true, day)}
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-[11px] border transition-colors',
                        reminderDay === day
                          ? 'bg-primary/20 border-primary/60 text-primary font-medium'
                          : 'border-border/70 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Dia {day}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Compartilhar */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 rounded-full"
              onClick={() => void handleShareInNetwork()}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Postar na rede
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 rounded-full"
              onClick={() => void handleShareExternal()}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Compartilhar fora
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

