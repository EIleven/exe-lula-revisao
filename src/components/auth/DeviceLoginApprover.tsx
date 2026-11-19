// src/components/auth/DeviceLoginApprover.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { auth } from '@/lib/firebase';
import { getRtdb } from '@/lib/rtdbClient';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { getDeviceFriendlyLabel, getOrCreateDeviceId } from '@/lib/p2p/p2pDevicePairing';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { KeyRound, Loader2, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';

/** O que este aparelho enxerga do pedido. O CÓDIGO não vem junto: quem aprova tem de DIGITAR o que vê no aparelho novo. */
export interface PendingLoginRequest {
  challengeId: string;
  targetUid: string;
  targetUsername: string;
  federatedHandle: string;
  targetName: string;
  targetAvatarUrl: string;
  requesterDeviceId: string;
  requesterDeviceLabel: string;
  requesterIpHint: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';
  createdAt: number;
  expiresAt: number;
}

function formatRemaining(expiresAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}:${String(rem).padStart(2, '0')}`;
}

/** "123456" → "123 456", só dígitos e no máximo 6. */
function formatCode(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** O RTDB entrega o aviso na hora; com ele de pé, a consulta periódica ao servidor vira só uma rede de proteção (30 s). */
const POLL_MS_WITHOUT_RTDB = 3_000;
const POLL_MS_WITH_RTDB = 30_000;

export default function DeviceLoginApprover() {
  const { currentUser } = useCurrentUser();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PendingLoginRequest[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const rtdbLiveRef = useRef(false);

  const uid = currentUser?.id || '';

  const fetchPendingFromServer = useCallback(async () => {
    if (!uid || !auth.currentUser) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth/device-login/pending', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { requests?: PendingLoginRequest[] };
      if (Array.isArray(data.requests)) {
        setRequests(data.requests.filter((r) => r.status === 'pending' && r.expiresAt > Date.now()));
      }
    } catch {
      // Silencioso: o RTDB continua ouvindo em tempo real e a próxima consulta tenta de novo.
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setRequests([]);
      return;
    }

    rtdbLiveRef.current = false;
    let rtdbUnsub: (() => void) | null = null;
    // Sem exceção possível: getRtdb() devolve null se o RTDB não estiver disponível (a consulta periódica cobre).
    const db = getRtdb();
    if (db) {
      try {
        rtdbUnsub = onValue(
          ref(db, `p2pDeviceSync/${uid}/loginRequests`),
          (snap) => {
            rtdbLiveRef.current = true;
            const val = snap.val() as Record<string, PendingLoginRequest> | null;
            if (!val) {
              setRequests([]);
              return;
            }
            const currentNow = Date.now();
            const pending = Object.values(val)
              .filter((r) => r && r.status === 'pending' && r.expiresAt > currentNow)
              .sort((a, b) => b.createdAt - a.createdAt);
            setRequests(pending);
          },
          () => {
            rtdbLiveRef.current = false;
            void fetchPendingFromServer();
          },
        );
      } catch {
        rtdbLiveRef.current = false;
      }
    }

    void fetchPendingFromServer();
    let ticks = 0;
    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      ticks += 1;
      const every = rtdbLiveRef.current ? Math.round(POLL_MS_WITH_RTDB / POLL_MS_WITHOUT_RTDB) : 1;
      if (ticks % every === 0) void fetchPendingFromServer();
    }, POLL_MS_WITHOUT_RTDB);
    const onFocus = () => void fetchPendingFromServer();
    window.addEventListener('focus', onFocus);

    return () => {
      if (rtdbUnsub) rtdbUnsub();
      rtdbLiveRef.current = false;
      clearInterval(pollInterval);
      window.removeEventListener('focus', onFocus);
    };
  }, [uid, fetchPendingFromServer]);

  // Atualiza contagem regressiva enquanto houver solicitação visível
  useEffect(() => {
    if (requests.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [requests.length]);

  // Notificação discreta + Web Notification quando chega uma nova solicitação (sem o código: ele só existe na tela nova).
  useEffect(() => {
    for (const req of requests) {
      if (notifiedIdsRef.current.has(req.challengeId)) continue;
      notifiedIdsRef.current.add(req.challengeId);

      toast({
        title: 'Solicitação de login por dispositivo',
        description: `${req.requesterDeviceLabel} pediu acesso como ${req.federatedHandle}.`,
      });

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('HiperVerso · Solicitação de Acesso', {
            body: `${req.requesterDeviceLabel} quer entrar em ${req.federatedHandle}. Abra o app para responder.`,
          });
        } catch {
          // Ignora bloqueio de notificação em contextos sem suporte
        }
      }
    }
  }, [requests, toast]);

  const activeRequest = requests.find((r) => !dismissedIds.has(r.challengeId) && r.expiresAt > now) || null;
  const activeId = activeRequest?.challengeId ?? null;

  // Cada pedido começa com o campo do código vazio.
  useEffect(() => {
    setTypedCode('');
  }, [activeId]);

  const handleRespond = async (challengeId: string, action: 'approve' | 'reject') => {
    if (!auth.currentUser) return;
    setRespondingId(challengeId);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/auth/device-login/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          challengeId,
          action,
          ...(action === 'approve' ? { verificationCode: typedCode.replace(/\D/g, '') } : {}),
          approverDeviceId: getOrCreateDeviceId(),
          approverDeviceLabel: getDeviceFriendlyLabel(),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        toast({
          title: 'Não foi possível responder',
          description: data.error || 'Tente novamente.',
          variant: 'destructive',
        });
        // 400: o código não confere (a pessoa corrige e tenta de novo). Qualquer outra recusa encerra o pedido.
        if (res.status !== 400) setRequests((prev) => prev.filter((r) => r.challengeId !== challengeId));
        if (res.status === 400) setTypedCode('');
        return;
      }

      setRequests((prev) => prev.filter((r) => r.challengeId !== challengeId));
      toast({
        title: action === 'approve' ? 'Acesso aprovado!' : 'Acesso recusado',
        description:
          action === 'approve'
            ? 'O outro dispositivo foi autenticado com segurança.'
            : 'A tentativa de login foi bloqueada.',
      });
    } catch {
      toast({
        title: 'Erro de rede',
        description: 'Não foi possível enviar sua resposta.',
        variant: 'destructive',
      });
    } finally {
      setRespondingId(null);
    }
  };

  if (!activeRequest) return null;

  const isBusy = respondingId === activeRequest.challengeId;
  const codeComplete = typedCode.replace(/\D/g, '').length === 6;

  return (
    <Dialog
      open={Boolean(activeRequest)}
      onOpenChange={(open) => {
        if (!open && activeRequest) {
          setDismissedIds((prev) => new Set(prev).add(activeRequest.challengeId));
        }
      }}
    >
      <DialogContent className="sm:max-w-md border-primary/40">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <KeyRound className="h-5 w-5" />
            <DialogTitle>Autorizar Login com Dispositivo</DialogTitle>
          </div>
          <DialogDescription>
            Um novo dispositivo está pedindo para entrar na sua conta usando este aparelho conectado como chave.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Conta</span>
              <span className="text-xs font-semibold text-foreground">{activeRequest.federatedHandle}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                Aparelho solicitante
              </span>
              <span className="text-xs font-medium text-foreground">{activeRequest.requesterDeviceLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Origem</span>
              <span className="text-xs text-muted-foreground">{activeRequest.requesterIpHint}</span>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Digite o código de 6 dígitos que aparece na tela do aparelho que está tentando entrar. Se você não pediu para
              entrar, toque em Recusar.
            </p>
            <Input
              value={typedCode}
              onChange={(e) => setTypedCode(formatCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000 000"
              maxLength={7}
              aria-label="Código de verificação"
              disabled={isBusy}
              className="mx-auto h-12 max-w-[11rem] text-center font-mono text-2xl tracking-[0.2em]"
            />
            <Badge variant="outline" className="text-[11px] font-normal">
              Expira em {formatRemaining(activeRequest.expiresAt, now)}
            </Badge>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={isBusy}
            onClick={() => void handleRespond(activeRequest.challengeId, 'reject')}
          >
            <ShieldAlert className="mr-1.5 h-4 w-4" />
            Recusar
          </Button>
          <Button
            type="button"
            disabled={isBusy || !codeComplete}
            onClick={() => void handleRespond(activeRequest.challengeId, 'approve')}
          >
            {isBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
            Aprovar Acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
