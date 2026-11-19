// src/components/idp2p/Idp2pAuthenticatorCard.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, KeyRound, Plus, QrCode, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { haptics } from '@/lib/haptics';

export interface TotpVaultEntry {
  id: string;
  issuer: string;
  label: string;
  secretBase32: string;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
  addedAt: string;
}

const VAULT_STORAGE_PREFIX = 'exelula_totp_vault_v1_';

function normalizeAlgorithm(raw: string | null): 'SHA-1' | 'SHA-256' | 'SHA-512' {
  const upper = (raw || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'SHA256') return 'SHA-256';
  if (upper === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

function base32ToBytes(input: string): Uint8Array | null {
  const clean = input.toUpperCase().replace(/[\s=-]+/g, '');
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length > 0 ? new Uint8Array(out) : null;
}

export function parseOtpAuthInput(
  raw: string,
  fallbackIssuer?: string,
  fallbackLabel?: string,
): Omit<TotpVaultEntry, 'id' | 'addedAt'> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const normalized = trimmed.replace(/^otpauth:\/\//i, 'https://');
      const url = new URL(normalized);
      const type = url.hostname.toLowerCase();
      if (type !== 'totp') return null;

      const secret = url.searchParams.get('secret')?.trim();
      if (!secret || !base32ToBytes(secret)) return null;

      const rawPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const colonIdx = rawPath.indexOf(':');
      const pathIssuer = colonIdx >= 0 ? rawPath.slice(0, colonIdx).trim() : '';
      const pathLabel = colonIdx >= 0 ? rawPath.slice(colonIdx + 1).trim() : rawPath.trim();

      const issuer = (url.searchParams.get('issuer') || pathIssuer || fallbackIssuer || 'Conta').trim();
      const label = (pathLabel || fallbackLabel || issuer).trim();
      const digitsRaw = Number(url.searchParams.get('digits') || 6);
      const periodRaw = Number(url.searchParams.get('period') || 30);

      return {
        issuer,
        label,
        secretBase32: secret.toUpperCase().replace(/[\s=-]+/g, ''),
        digits: digitsRaw === 8 ? 8 : 6,
        period: Number.isFinite(periodRaw) && periodRaw >= 10 && periodRaw <= 120 ? periodRaw : 30,
        algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
      };
    } catch {
      return null;
    }
  }

  const secretBytes = base32ToBytes(trimmed);
  if (!secretBytes) return null;

  return {
    issuer: (fallbackIssuer || 'Conta externa').trim(),
    label: (fallbackLabel || 'Código 2FA').trim(),
    secretBase32: trimmed.toUpperCase().replace(/[\s=-]+/g, ''),
    digits: 6,
    period: 30,
    algorithm: 'SHA-1',
  };
}

async function generateTotpFromKeyBytes(
  keyBytes: ArrayBuffer | Uint8Array,
  options?: { period?: number; digits?: number; algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512' },
): Promise<{ code: string; remainingSec: number; period: number }> {
  const period = options?.period ?? 30;
  const digits = options?.digits ?? 6;
  const algorithm = options?.algorithm ?? 'SHA-1';

  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / period);
  const remainingSec = period - (nowSec % period);

  const rawBuffer = keyBytes instanceof Uint8Array ? (keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer) : keyBytes;
  const hmacKey = await crypto.subtle.importKey('raw', rawBuffer, { name: 'HMAC', hash: algorithm }, false, ['sign']);

  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(4, counter, false);

  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, counterBuf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const mod = Math.pow(10, digits);
  const code = String(bin % mod).padStart(digits, '0');
  return { code, remainingSec, period };
}

async function generateTotpCode(seed: string, timeStepSec = 30): Promise<{ code: string; remainingSec: number }> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(seed));
  const res = await generateTotpFromKeyBytes(keyHash, { period: timeStepSec, digits: 6, algorithm: 'SHA-1' });
  return { code: res.code, remainingSec: res.remainingSec };
}

function loadVault(userId: string): TotpVaultEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${VAULT_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveVault(userId: string, entries: TotpVaultEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${VAULT_STORAGE_PREFIX}${userId}`, JSON.stringify(entries));
  } catch {
    // ignore storage quota errors
  }
}

export default function Idp2pAuthenticatorCard({ userId, username }: { userId: string; username: string }) {
  const { toast } = useToast();
  const [vault, setVault] = useState<TotpVaultEntry[]>([]);
  const [codes, setCodes] = useState<Record<string, { code: string; remainingSec: number; period: number }>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [scanningCamera, setScanningCamera] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualIssuer, setManualIssuer] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setVault(loadVault(userId));
  }, [userId]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanningCamera(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    let active = true;
    const ownSeed = `idp2p-totp-v1:${userId}:${username}`;

    const tick = async () => {
      if (typeof crypto === 'undefined' || !crypto.subtle) return;
      const next: Record<string, { code: string; remainingSec: number; period: number }> = {};

      const ownRes = await generateTotpCode(ownSeed).catch(() => null);
      if (ownRes) {
        next.__exelula__ = { ...ownRes, period: 30 };
      }

      for (const item of vault) {
        const bytes = base32ToBytes(item.secretBase32);
        if (!bytes) continue;
        const itemRes = await generateTotpFromKeyBytes(bytes, {
          period: item.period,
          digits: item.digits,
          algorithm: item.algorithm,
        }).catch(() => null);
        if (itemRes) {
          next[item.id] = itemRes;
        }
      }

      if (active) setCodes(next);
    };

    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [userId, username, vault]);

  const addParsedAccount = useCallback(
    (parsed: Omit<TotpVaultEntry, 'id' | 'addedAt'>) => {
      const duplicate = vault.find(
        (v) => v.secretBase32 === parsed.secretBase32 && v.issuer.toLowerCase() === parsed.issuer.toLowerCase(),
      );
      if (duplicate) {
        toast({ title: `${parsed.issuer} já está no seu cofre.` });
        setAddingOpen(false);
        stopCamera();
        return;
      }
      const nextEntry: TotpVaultEntry = {
        ...parsed,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        addedAt: new Date().toISOString(),
      };
      const updated = [nextEntry, ...vault];
      setVault(updated);
      saveVault(userId, updated);
      haptics.select();
      toast({
        title: `${parsed.issuer} adicionado ao cofre!`,
        description: `Códigos de ${parsed.label} prontos em 1 toque.`,
      });
      setManualInput('');
      setManualIssuer('');
      setAddingOpen(false);
      stopCamera();
    },
    [stopCamera, toast, userId, vault],
  );

  const handleStartQrScan = async () => {
    setAddingOpen(true);
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: 'Câmera indisponível neste navegador',
        description: 'Cole o código ou a chave secreta abaixo.',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanningCamera(true);
      window.setTimeout(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({ formats: ['qr_code'] });
        const scanLoop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const detected = await detector.detect(videoRef.current);
            const raw = detected[0]?.rawValue;
            if (raw) {
              const parsed = parseOtpAuthInput(raw);
              if (parsed) {
                addParsedAccount(parsed);
                return;
              }
            }
          } catch {
            // continua lendo os próximos quadros
          }
          if (streamRef.current) requestAnimationFrame(() => void scanLoop());
        };
        void scanLoop();
      }, 100);
    } catch {
      stopCamera();
      toast({
        variant: 'destructive',
        title: 'Sem acesso à câmera',
        description: 'Libere a câmera ou cole a chave secreta abaixo.',
      });
    }
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseOtpAuthInput(manualInput, manualIssuer || undefined);
    if (!parsed) {
      toast({
        variant: 'destructive',
        title: 'Código inválido',
        description: 'Cole o link otpauth:// ou a chave secreta (letras e números).',
      });
      return;
    }
    addParsedAccount(parsed);
  };

  const handleRemove = (id: string) => {
    const updated = vault.filter((v) => v.id !== id);
    setVault(updated);
    saveVault(userId, updated);
    haptics.select();
    toast({ title: 'Conta removida do cofre.' });
  };

  const handleCopy = async (id: string, rawCode: string) => {
    try {
      await navigator.clipboard.writeText(rawCode);
      haptics.select();
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
      toast({ title: 'Código copiado!' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const renderCodeRow = (params: {
    id: string;
    issuer: string;
    label: string;
    removable?: boolean;
  }) => {
    const entry = codes[params.id];
    const code = entry?.code ?? '------';
    const remaining = entry?.remainingSec ?? 30;
    const period = entry?.period ?? 30;
    const formatted = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
    const isCopied = copiedId === params.id;

    return (
      <div key={params.id} className="rounded-xl border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span className="text-xs font-semibold truncate">{params.issuer}</span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{params.label}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-muted-foreground tabular-nums">{remaining}s</span>
            {params.removable && (
              <button
                type="button"
                onClick={() => handleRemove(params.id)}
                aria-label={`Remover ${params.issuer}`}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-2xl font-bold tracking-widest tabular-nums font-mono">{formatted}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy(params.id, code)}>
            {isCopied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {isCopied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>

        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round((remaining / period) * 100)}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Cofre de Códigos (2FA)
            </CardTitle>
            <CardDescription className="text-xs">
              Guarde seus códigos da Microsoft, Google, GitHub e HiperVerso em um só lugar.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (addingOpen) {
                stopCamera();
                setAddingOpen(false);
              } else {
                void handleStartQrScan();
              }
            }}
            data-testid="vault-scan-qr-btn"
          >
            {addingOpen ? (
              <>
                <X className="mr-1.5 h-3.5 w-3.5" /> Fechar
              </>
            ) : (
              <>
                <QrCode className="mr-1.5 h-3.5 w-3.5" /> Ler QR Code
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {addingOpen && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-3">
            {scanningCamera ? (
              <div className="space-y-2">
                <div className="relative overflow-hidden rounded-lg bg-black aspect-video max-h-56 w-full">
                  <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-primary" />
                    Aponte para o QR Code da conta
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={stopCamera}>
                    Parar câmera
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void handleStartQrScan()}>
                <Camera className="mr-1.5 h-4 w-4" /> Abrir câmera para ler QR
              </Button>
            )}

            <form onSubmit={handleManualAdd} className="space-y-2 pt-1 border-t border-border/60">
              <p className="text-[11px] text-muted-foreground">Ou cole a chave secreta / link otpauth://</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  placeholder="Serviço (ex: Microsoft)"
                  value={manualIssuer}
                  onChange={(e) => setManualIssuer(e.target.value)}
                  className="h-9 text-xs"
                />
                <Input
                  placeholder="Link otpauth:// ou chave"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="h-9 text-xs sm:col-span-2"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="w-full">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Salvar no Cofre
              </Button>
            </form>
          </div>
        )}

        <div className="space-y-2.5">
          {vault.map((item) =>
            renderCodeRow({
              id: item.id,
              issuer: item.issuer,
              label: item.label,
              removable: true,
            }),
          )}
          {renderCodeRow({
            id: '__exelula__',
            issuer: 'HiperVerso',
            label: `@${username}`,
            removable: false,
          })}
        </div>
      </CardContent>
    </Card>
  );
}
