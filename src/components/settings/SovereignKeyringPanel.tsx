'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  KeyRound,
  QrCode,
  ShieldCheck,
  ShieldAlert,
  ShieldBan,
  Plus,
  Copy,
  RefreshCw,
  Trash2,
  Ban,
  CheckCircle2,
  Download,
  Upload,
  Camera,
  X,
  Globe,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { PairedDeviceInfo } from '@/lib/p2p/p2pDevicePairing';
import {
  createSignedQrPass,
  createSovereignAccessKey,
  decryptKeyringTransfer,
  encryptKeyringForTransfer,
  loadBlockedProviders,
  loadLocalKeyring,
  mergeKeyrings,
  normalizeProviderDomain,
  saveBlockedProviders,
  saveLocalKeyring,
  verifySignedQrPass,
  type EncryptedKeyringBundle,
  type KeyScope,
  type QrPassPayload,
  type SovereignAccessKey,
  type VerifyQrPassResult,
} from '@/lib/crypto/sovereignKeyring';

interface SovereignKeyringPanelProps {
  userId: string;
  deviceId: string;
  linkedDevices?: PairedDeviceInfo[];
}

export default function SovereignKeyringPanel({
  userId,
  deviceId,
  linkedDevices = [],
}: SovereignKeyringPanelProps) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<SovereignAccessKey[]>([]);
  const [blockedProviders, setBlockedProviders] = useState<string[]>([]);
  const [appName, setAppName] = useState('');
  const [providerDomain, setProviderDomain] = useState('*');
  const [scope, setScope] = useState<KeyScope>('acesso-total');
  const [onlyThisDevice, setOnlyThisDevice] = useState(false);
  const [creating, setCreating] = useState(false);

  const [blockInput, setBlockInput] = useState('');
  const [activePass, setActivePass] = useState<{
    key: SovereignAccessKey;
    token: string;
    payload: QrPassPayload;
    qrDataUrl: string;
  } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [tokenToVerify, setTokenToVerify] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyQrPassResult | null>(null);
  const [scanningCamera, setScanningCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [vaultMode, setVaultMode] = useState<null | 'export' | 'import'>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authorizedDeviceIds = useMemo(() => {
    const ids = new Set<string>([deviceId]);
    for (const d of linkedDevices) {
      if (d.deviceId) ids.add(d.deviceId);
    }
    return ids;
  }, [deviceId, linkedDevices]);

  useEffect(() => {
    setKeys(loadLocalKeyring(userId));
    setBlockedProviders(loadBlockedProviders(userId));
  }, [userId]);

  const persistKeys = useCallback(
    (next: SovereignAccessKey[]) => {
      setKeys(next);
      saveLocalKeyring(userId, next);
    },
    [userId],
  );

  const persistBlocked = useCallback(
    (next: string[]) => {
      const normalized = Array.from(
        new Set(next.map(normalizeProviderDomain).filter((d) => d && d !== '*')),
      );
      setBlockedProviders(normalized);
      saveBlockedProviders(userId, normalized);
    },
    [userId],
  );

  useEffect(() => {
    if (!activePass) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((activePass.payload.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activePass]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanningCamera(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const handleCreateKey = async () => {
    if (!appName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Informe o nome da aplicação',
        description: 'Ex: Painel Pessoal, Git, App Externa, ou Universal.',
      });
      return;
    }
    setCreating(true);
    try {
      const bound = onlyThisDevice ? [deviceId] : undefined;
      const created = await createSovereignAccessKey(appName, scope, providerDomain || '*', bound);
      persistKeys([created, ...keys]);
      setAppName('');
      setProviderDomain('*');
      setOnlyThisDevice(false);
      toast({
        title: 'Chave soberana criada',
        description: `${created.appName} (${created.fingerprint}) vinculada aos seus aparelhos autorizados.`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível criar a chave',
        description: e instanceof Error ? e.message : 'Erro desconhecido.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateQr = async (key: SovereignAccessKey) => {
    try {
      const { token, payload } = await createSignedQrPass({
        key,
        userId,
        deviceId,
        blockedProviders,
        ttlSeconds: 120,
      });
      const qrDataUrl = await QRCode.toDataURL(token, {
        width: 260,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0B0F17', light: '#FFFFFF' },
      });
      const updated = keys.map((k) => (k.id === key.id ? { ...k, lastUsedAt: Date.now() } : k));
      persistKeys(updated);
      setActivePass({ key, token, payload, qrDataUrl });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Acesso bloqueado ou erro ao gerar Passe QR',
        description: e instanceof Error ? e.message : 'Falha na assinatura.',
      });
    }
  };

  const handleToggleRevoke = (keyId: string) => {
    const next = keys.map((k) => (k.id === keyId ? { ...k, revoked: !k.revoked } : k));
    persistKeys(next);
    if (activePass?.key.id === keyId) setActivePass(null);
  };

  const handleDeleteKey = (keyId: string) => {
    persistKeys(keys.filter((k) => k.id !== keyId));
    if (activePass?.key.id === keyId) setActivePass(null);
  };

  const handleBlockProvider = () => {
    const clean = normalizeProviderDomain(blockInput);
    if (!clean || clean === '*') {
      toast({
        variant: 'destructive',
        title: 'Informe um domínio válido',
        description: 'Ex: provedor.com ou app.externo.net',
      });
      return;
    }
    persistBlocked([...blockedProviders, clean]);
    setBlockInput('');
    toast({
      title: 'Provedor bloqueado',
      description: `Qualquer tentativa de login para ${clean} será recusada imediatamente.`,
    });
  };

  const handleVerifyToken = async (rawToken?: string) => {
    const target = (rawToken ?? tokenToVerify).trim();
    if (!target) return;
    const revokedIds = new Set(keys.filter((k) => k.revoked).map((k) => k.id));
    const res = await verifySignedQrPass(target, {
      revokedKeyIds: revokedIds,
      blockedProviders,
      authorizedDeviceIds,
    });
    setVerifyResult(res);
  };

  const startCameraScan = async () => {
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: 'Leitor nativo indisponível',
        description: 'Cole o código do Passe QR abaixo ou use um navegador com BarcodeDetector.',
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
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          const detector = new Detector({ formats: ['qr_code'] });
          const scanLoop = async () => {
            if (!streamRef.current || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              const raw = codes[0]?.rawValue;
              if (raw && raw.startsWith('exelula-pass:v1.')) {
                setTokenToVerify(raw);
                stopCamera();
                await handleVerifyToken(raw);
                return;
              }
            } catch {
              // continua tentando
            }
            if (streamRef.current) requestAnimationFrame(() => void scanLoop());
          };
          void scanLoop();
        }
      }, 100);
    } catch {
      stopCamera();
      toast({
        variant: 'destructive',
        title: 'Câmera indisponível',
        description: 'Permita o acesso à câmera ou cole o código manualmente.',
      });
    }
  };

  const handleExportVault = async () => {
    setVaultBusy(true);
    try {
      const bundle = await encryptKeyringForTransfer(keys, vaultPassphrase);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exelula-chaves-${new Date().toISOString().slice(0, 10)}.exelula-keys.json`;
      a.click();
      URL.revokeObjectURL(url);
      setVaultMode(null);
      setVaultPassphrase('');
      toast({
        title: 'Cofre exportado com AES-GCM-256',
        description: `${keys.length} chave(s) cifrada(s) prontas para importar em outro aparelho vinculado.`,
      });
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Erro ao exportar cofre',
        description: e instanceof Error ? e.message : 'Falha na cifragem.',
      });
    } finally {
      setVaultBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (vaultPassphrase.trim().length < 6) {
      toast({
        variant: 'destructive',
        title: 'Digite a frase-chave antes',
        description: 'Informe a senha usada ao exportar o arquivo do cofre.',
      });
      return;
    }
    setVaultBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as EncryptedKeyringBundle;
      const imported = await decryptKeyringTransfer(bundle, vaultPassphrase);
      const merged = mergeKeyrings(keys, imported);
      persistKeys(merged);
      setVaultMode(null);
      setVaultPassphrase('');
      toast({
        title: 'Chaves importadas localmente',
        description: `${imported.length} chave(s) sincronizada(s) neste aparelho.`,
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Não foi possível abrir o cofre',
        description: err instanceof Error ? err.message : 'Senha incorreta ou arquivo inválido.',
      });
    } finally {
      setVaultBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <KeyRound className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">
              Chaves Soberanas P2P & Passe QR (HiperVerso)
            </h3>
            <Badge variant="outline" className="text-[10px]">
              ECDSA P-256 · Login Universal
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              <Smartphone className="h-3 w-3 mr-1" />
              {authorizedDeviceIds.size} aparelho(s) autorizado(s)
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Use suas chaves vinculadas aos aparelhos permitidos para logar em qualquer aplicação
            via QR Code assinado, salvar localmente entre dispositivos e bloquear qualquer provedor
            quando quiser.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVaultMode(vaultMode === 'export' ? null : 'export')}
            disabled={keys.length === 0}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Exportar Cofre
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVaultMode(vaultMode === 'import' ? null : 'import')}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Importar Cofre
          </Button>
        </div>
      </div>

      {vaultMode && (
        <div className="rounded-lg border border-border bg-background p-3 space-y-2">
          <p className="text-xs font-semibold text-foreground">
            {vaultMode === 'export'
              ? 'Cifrar cofre local (AES-GCM-256 + PBKDF2 250k)'
              : 'Importar cofre cifrado de outro aparelho vinculado'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              value={vaultPassphrase}
              onChange={(e) => setVaultPassphrase(e.target.value)}
              placeholder="Frase-chave (mín. 6 caracteres)"
              className="h-8 text-xs flex-1 min-w-[200px]"
            />
            {vaultMode === 'export' ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleExportVault()}
                disabled={vaultBusy}
              >
                Baixar .exelula-keys.json
              </Button>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => void handleImportFile(e)}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={vaultBusy}
                >
                  Selecionar Arquivo
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="Nome da aplicação (ex: Meu Painel, Login Universal)"
            className="h-9 text-xs flex-1 min-w-[180px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateKey();
            }}
          />
          <Input
            value={providerDomain}
            onChange={(e) => setProviderDomain(e.target.value)}
            placeholder="Domínio (* = onde quiser)"
            className="h-9 text-xs w-44"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Escopo da chave"
            className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
          >
            <option value="acesso-total">Acesso Total</option>
            <option value="leitura">Somente Leitura</option>
            <option value="sessao-unica">Sessão Única</option>
          </select>
          <Button type="button" size="sm" onClick={() => void handleCreateKey()} disabled={creating}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Criar Chave
          </Button>
        </div>
        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={onlyThisDevice}
            onChange={(e) => setOnlyThisDevice(e.target.checked)}
            className="rounded border-border"
          />
          Restringir esta chave apenas a este aparelho atual
        </label>
      </div>

      {keys.length > 0 ? (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">{k.appName}</span>
                  <Badge variant={k.revoked ? 'destructive' : 'secondary'} className="text-[10px]">
                    {k.revoked ? 'Revogada' : k.scope}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Globe className="h-2.5 w-2.5 mr-1" />
                    {k.providerDomain === '*' || !k.providerDomain
                      ? 'Qualquer provedor'
                      : k.providerDomain}
                  </Badge>
                  {k.boundDeviceIds && k.boundDeviceIds.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      Dispositivo exclusivo
                    </Badge>
                  )}
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">{k.fingerprint}</p>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={k.revoked}
                  onClick={() => void handleGenerateQr(k)}
                >
                  <QrCode className="h-3.5 w-3.5 mr-1" />
                  Passe QR
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleRevoke(k.id)}
                  title={k.revoked ? 'Reativar chave' : 'Revogar chave'}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDeleteKey(k.id)}
                  title="Excluir chave localmente"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhuma chave criada ainda neste dispositivo. Crie sua primeira chave acima.
        </p>
      )}

      {activePass && (
        <div className="rounded-xl border border-primary/40 bg-background p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-foreground">
                Passe QR Ativo · {activePass.key.appName} (
                {activePass.payload.providerDomain === '*'
                  ? 'Universal'
                  : activePass.payload.providerDomain}
                )
              </p>
              <p className="text-[11px] text-muted-foreground">
                {secondsLeft > 0
                  ? `Expira em ${secondsLeft}s · Uso único (anti-replay)`
                  : 'Passe expirado — clique em Renovar'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleGenerateQr(activePass.key)}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Renovar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setActivePass(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="rounded-xl bg-white p-2.5 border border-border shadow-sm shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activePass.qrDataUrl}
                alt={`QR Code de acesso para ${activePass.key.appName}`}
                className="h-48 w-48 block"
              />
            </div>

            <div className="flex-1 min-w-0 space-y-2 w-full">
              <p className="text-[11px] font-mono break-all rounded-md bg-muted/50 p-2 text-muted-foreground max-h-24 overflow-y-auto">
                {activePass.token}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(activePass.token);
                  toast({ title: 'Passe QR copiado' });
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copiar Token Assinado
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-border/70 pt-3 space-y-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ShieldBan className="h-4 w-4 text-destructive" />
          Provedores Bloqueados (controle total de onde você NÃO permite login)
        </p>
        <div className="flex gap-2">
          <Input
            value={blockInput}
            onChange={(e) => setBlockInput(e.target.value)}
            placeholder="Bloquear domínio/provedor (ex: app.suspeito.com)"
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBlockProvider();
            }}
          />
          <Button type="button" size="sm" variant="destructive" onClick={handleBlockProvider}>
            Bloquear Provedor
          </Button>
        </div>
        {blockedProviders.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {blockedProviders.map((dom) => (
              <Badge key={dom} variant="destructive" className="text-[11px] gap-1">
                {dom}
                <button
                  type="button"
                  onClick={() => persistBlocked(blockedProviders.filter((x) => x !== dom))}
                  aria-label={`Desbloquear ${dom}`}
                  className="ml-0.5 hover:opacity-80"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/70 pt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Validar Passe QR (100% offline / dispositivos autorizados)
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void startCameraScan()}>
            <Camera className="h-3.5 w-3.5 mr-1.5" />
            Ler Câmera
          </Button>
        </div>

        {scanningCamera && (
          <div className="relative rounded-lg overflow-hidden border border-border bg-black">
            <video ref={videoRef} className="w-full max-h-56 object-cover" muted playsInline />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={stopCamera}
            >
              Fechar Câmera
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={tokenToVerify}
            onChange={(e) => setTokenToVerify(e.target.value)}
            placeholder="Cole aqui um código exelula-pass:v1..."
            className="h-8 text-xs font-mono"
          />
          <Button type="button" size="sm" onClick={() => void handleVerifyToken()}>
            Validar
          </Button>
        </div>

        {verifyResult && (
          <div
            className={`rounded-lg border p-2.5 text-xs flex items-start gap-2 ${
              verifyResult.valid
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            {verifyResult.valid ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <div>
              {verifyResult.valid ? (
                <>
                  <p className="font-bold">
                    PASSE VÁLIDO · {verifyResult.payload.appName} (
                    {verifyResult.payload.providerDomain === '*'
                      ? 'Universal'
                      : verifyResult.payload.providerDomain}
                    )
                  </p>
                  <p className="text-[11px] opacity-90">
                    Escopo: {verifyResult.payload.scope} · Fingerprint:{' '}
                    {verifyResult.payload.fingerprint} · Restam {verifyResult.expiresInSec}s
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold">REJEITADO ({verifyResult.code})</p>
                  <p className="text-[11px] opacity-90">{verifyResult.reason}</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
