'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Wifi, ShieldCheck, Lock, Trash2, CheckCircle2, Download, Upload, FileKey2, KeyRound, RefreshCw, EyeOff, AlertTriangle } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  clearAllLocalP2pHistory,
  exportPortabilityBundle,
  getLocalP2pStats,
  getP2pPreferences,
  importPortabilityBundle,
  saveP2pPreferences,
  type ExportParts,
  type P2pPreferences,
} from '@/lib/p2p/p2pPreferences';
import {
  createNewE2eeIdentity,
  e2eeFingerprint,
  getE2eeStatus,
  isWebCryptoSupported,
  rotateE2eeKey,
  type IdentityStatus,
} from '@/lib/crypto/e2ee';
import { describeBundleError, MIN_PASSPHRASE_CHARS } from '@/lib/p2p/p2pBundle';

const DEFAULT_PREFS: P2pPreferences = { defaultZeroDbOnly: false, autoConnectP2p: true, autoConnectScope: 'mutual', relayOnly: false };

type Painel = null | 'exportar' | 'importar';

export default function P2pSettings() {
  const { currentUser } = useCurrentUser();
  const { toast } = useToast();
  const locale = useLocale();
  const userId = currentUser?.id;
  const importInputRef = useRef<HTMLInputElement>(null);

  const [prefs, setPrefs] = useState<P2pPreferences>(DEFAULT_PREFS);
  const [stats, setStats] = useState({ conversations: 0, messages: 0 });
  const [cryptoOk, setCryptoOk] = useState(true);
  const [identity, setIdentity] = useState<IdentityStatus | null>(null);
  const [fingerprint, setFingerprint] = useState('');

  const [painel, setPainel] = useState<Painel>(null);
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [partes, setPartes] = useState<ExportParts>({ preferences: true, keys: true, p2p: true });
  const [arquivo, setArquivo] = useState<{ nome: string; texto: string; cifrado: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const refreshIdentity = useCallback(async () => {
    if (!userId) return;
    try {
      const st = await getE2eeStatus(userId);
      setIdentity(st);
      setFingerprint(st.status === 'ready' ? await e2eeFingerprint(st.publicKeyJson) : '');
    } catch {
      setIdentity(null);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setPrefs(getP2pPreferences(userId));
    setStats(getLocalP2pStats(userId));
    setCryptoOk(isWebCryptoSupported());
    void refreshIdentity();
  }, [userId, refreshIdentity]);

  const updatePref = (patch: Partial<P2pPreferences>) => {
    if (!userId) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveP2pPreferences(userId, next);
    toast({
      title: 'Preferência P2P atualizada',
      description: next.defaultZeroDbOnly
        ? 'Modo P2P (Zero DB) definido como padrão nas suas conversas.'
        : 'Modo híbrido ativo: P2P direto quando online e E2EE via servidor quando offline.',
    });
  };

  const fecharPainel = () => {
    setPainel(null);
    setSenha('');
    setSenha2('');
    setArquivo(null);
  };

  const handleClearHistory = () => {
    if (!userId) return;
    const cleared = clearAllLocalP2pHistory(userId);
    setStats({ conversations: 0, messages: 0 });
    toast({
      title: 'Histórico P2P local apagado',
      description: cleared > 0 ? `${cleared} conversa(s) removida(s) deste aparelho.` : 'Nenhuma mensagem P2P local encontrada.',
    });
  };

  // ─────────── Saída ───────────
  const senhaValida = senha.normalize('NFKC').length >= MIN_PASSPHRASE_CHARS && senha === senha2;
  const handleExport = async () => {
    if (!userId || !senhaValida || ocupado) return;
    setOcupado(true);
    try {
      const texto = await exportPortabilityBundle(userId, senha, partes);
      const blob = new Blob([texto], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exelula-backup-${currentUser?.username || userId}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: 'Backup cifrado exportado',
        description: 'O arquivo só abre com a senha que você acabou de definir. Guarde-a: não existe como recuperá-la.',
      });
      fecharPainel();
    } catch (err: unknown) {
      toast({ title: 'Não foi possível exportar', description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  };

  // ─────────── Entrada ───────────
  const handleChooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: 'Arquivo grande demais', description: describeBundleError('tamanho'), variant: 'destructive' });
      return;
    }
    const texto = await file.text();
    let cifrado = false;
    try {
      cifrado = JSON.parse(texto)?.encrypted === true;
    } catch {
      // o leitor devolve o erro certo ao importar
    }
    setArquivo({ nome: file.name, texto, cifrado });
    setSenha('');
    setPainel('importar');
  };

  const handleImport = async () => {
    if (!userId || !arquivo || ocupado) return;
    setOcupado(true);
    try {
      const res = await importPortabilityBundle(userId, arquivo.texto, arquivo.cifrado ? senha : undefined);
      if (!res.ok) {
        toast({ title: 'Importação recusada', description: describeBundleError(res.error), variant: 'destructive' });
        return;
      }
      const s = res.summary;
      setPrefs(getP2pPreferences(userId));
      setStats(getLocalP2pStats(userId));
      await refreshIdentity();
      toast({
        title: 'Dados restaurados (Entrada)',
        description: [
          `${s.conversationsRestored} conversa(s) e ${s.messagesRestored} mensagem(ns) novas`,
          s.messagesSkipped > 0 ? `${s.messagesSkipped} descartada(s) por formato inválido` : null,
          s.keysRestored ? 'chaves E2EE unidas às deste aparelho' : null,
          s.legacy ? 'arquivo do formato antigo (em claro): faça um backup novo, cifrado' : null,
        ].filter(Boolean).join('; ') + '.',
      });
      fecharPainel();
    } finally {
      setOcupado(false);
    }
  };

  // ─────────── Chaves ───────────
  const handleRotate = async () => {
    if (!userId) return;
    setOcupado(true);
    try {
      await rotateE2eeKey(userId);
      await refreshIdentity();
      toast({ title: 'Chave E2EE trocada', description: 'A chave nova vale a partir de agora. As mensagens antigas continuam legíveis neste aparelho. Faça um backup novo das chaves.' });
    } catch (err: unknown) {
      toast({ title: 'Não foi possível trocar a chave', description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  };

  const handleNewIdentity = async () => {
    if (!userId) return;
    setOcupado(true);
    try {
      await createNewE2eeIdentity(userId);
      await refreshIdentity();
      toast({ title: 'Nova identidade criada', description: 'Este aparelho agora tem a chave da conta. O que foi cifrado para a chave antiga só abre se você restaurar o backup dela.' });
    } catch (err: unknown) {
      toast({ title: 'Não foi possível criar a identidade', description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  };

  if (!currentUser) return null;

  const pronto = identity?.status === 'ready';
  const precisaRestaurar = identity?.status === 'needs-restore';

  return (
    <div className="p-5 sm:p-6 space-y-6">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-emerald-500" />
          <h2 className="text-xl font-bold tracking-tight">Comunicação P2P e criptografia</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Mensagens diretas dispositivo a dispositivo (sem passar pelo banco de dados quando os dois estão online) e criptografia de ponta a ponta (ECDH P-256 + AES-GCM).
        </p>
      </div>

      {/* ───────── E2EE ───────── */}
      <div
        className={`rounded-xl border p-3.5 flex items-start gap-3 ${precisaRestaurar ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/25 bg-emerald-500/5'}`}
      >
        {precisaRestaurar ? <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" /> : <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />}
        <div className="text-xs sm:text-sm space-y-1.5 min-w-0">
          {!cryptoOk || identity?.status === 'unsupported' ? (
            <p className="font-medium text-foreground">Este navegador não oferece criptografia (WebCrypto). O E2EE fica indisponível aqui.</p>
          ) : identity?.status === 'storage-unavailable' ? (
            <p className="font-medium text-foreground">O navegador não deixa guardar a chave (modo privado ou armazenamento bloqueado): o E2EE fica desligado neste aparelho.</p>
          ) : precisaRestaurar ? (
            <>
              <p className="font-medium text-foreground">Sua conta tem uma chave E2EE que este aparelho não possui</p>
              <p className="text-muted-foreground text-xs">
                A chave foi criada em outro aparelho. Restaure o backup das chaves aqui (Importar) para ler e enviar mensagens cifradas. Este aparelho <strong>não</strong> cria outra chave sozinho: isso trocaria a chave da conta e deixaria o outro aparelho sem acesso.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-1 text-destructive border-destructive/40 hover:bg-destructive/10" disabled={ocupado}>
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    Perdi o backup: criar identidade nova
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Criar uma identidade E2EE nova?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A chave da conta passa a ser a deste aparelho. O que foi cifrado para a chave antiga (mensagens que você já recebeu) só volta a abrir se você restaurar o backup dela, e o outro aparelho ficará sem a chave nova até você levar um backup para lá. Não dá para desfazer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleNewIdentity()} className="bg-destructive hover:bg-destructive/90">Criar identidade nova</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : pronto ? (
            <>
              <p className="font-medium text-foreground">Identidade criptográfica ativa neste aparelho</p>
              <p className="text-muted-foreground text-xs break-words">
                Impressão digital da sua chave: <span className="font-mono text-foreground">{fingerprint}</span>. Compare com a que o seu contato vê no outro aparelho para ter certeza de que a chave é mesmo a sua.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={ocupado}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Trocar chave
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Trocar a chave E2EE?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Uma chave nova passa a valer para o que você receber daqui para a frente. A antiga fica guardada neste aparelho e continua abrindo as mensagens antigas. Outros aparelhos seus vão pedir que você leve um backup novo das chaves.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleRotate()}>Trocar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button variant="outline" size="sm" disabled={ocupado} onClick={() => { setPartes({ preferences: false, keys: true, p2p: false }); setPainel('exportar'); }}>
                  <FileKey2 className="mr-1.5 h-3.5 w-3.5" />
                  Backup só das chaves
                </Button>
              </div>
            </>
          ) : (
            <p className="font-medium text-foreground">Verificando a identidade criptográfica…</p>
          )}
        </div>
      </div>

      <Separator />

      {/* ───────── P2P ───────── */}
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="p2p-default-zero-db" className="text-sm font-semibold flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-500" />
              Manter P2P (Zero DB) como padrão
            </Label>
            <p className="text-xs text-muted-foreground">
              Ao abrir uma conversa 1-a-1, o modo estrito Zero DB já vem ativado: nada é gravado no servidor, e a mensagem só sai se o contato estiver conectado por P2P (senão o texto volta para você, não se perde).
            </p>
          </div>
          <Switch id="p2p-default-zero-db" checked={prefs.defaultZeroDbOnly} onCheckedChange={(checked) => updatePref({ defaultZeroDbOnly: checked })} />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="p2p-auto-connect" className="text-sm font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              Conectar P2P automaticamente
            </Label>
            <p className="text-xs text-muted-foreground">
              Abre o túnel direto sozinho quando os dois estão na conversa. O túnel mostra o endereço de rede (IP) de cada lado ao outro: por isso, por padrão, só conecta sozinho com contatos mútuos.
            </p>
          </div>
          <Switch id="p2p-auto-connect" checked={prefs.autoConnectP2p} onCheckedChange={(checked) => updatePref({ autoConnectP2p: checked })} />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="p2p-scope-any" className="text-sm font-semibold">Conectar sozinho com qualquer contato</Label>
            <p className="text-xs text-muted-foreground">
              Desligado: só com quem você segue e que segue você. Ligado: com qualquer pessoa que abra uma conversa com você (ela passa a ver o seu IP).
            </p>
          </div>
          <Switch
            id="p2p-scope-any"
            checked={prefs.autoConnectScope === 'any'}
            disabled={!prefs.autoConnectP2p}
            onCheckedChange={(checked) => updatePref({ autoConnectScope: checked ? 'any' : 'mutual' })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="p2p-relay-only" className="text-sm font-semibold flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              Ocultar meu IP (usar só relay)
            </Label>
            <p className="text-xs text-muted-foreground">
              O tráfego passa por um servidor relay (TURN) em vez de ir direto, e o contato não vê o seu IP. Só funciona se o servidor do Exe. Lula tiver o relay configurado; sem ele, o P2P não conecta com esta opção ligada.
            </p>
          </div>
          <Switch id="p2p-relay-only" checked={prefs.relayOnly} onCheckedChange={(checked) => updatePref({ relayOnly: checked })} />
        </div>
      </div>

      <Separator />

      {/* ───────── Armazenamento e portabilidade ───────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Armazenamento local neste aparelho</p>
            <p className="text-xs text-muted-foreground">
              {stats.messages} mensagem(ns) P2P em {stats.conversations} conversa(s) guardadas apenas neste dispositivo.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Limpar local
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar histórico P2P local?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso remove apenas as mensagens P2P (Zero DB) salvas neste aparelho. Elas não estão em nenhum servidor e não poderão ser recuperadas, a não ser por um backup seu.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearHistory} className="bg-destructive hover:bg-destructive/90">Apagar tudo local</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <FileKey2 className="h-4 w-4 text-primary" />
              Backup e portabilidade (Entrada e Saída)
            </p>
            <p className="text-xs text-muted-foreground">
              O arquivo leva as preferências, as chaves E2EE e o histórico P2P que existem <strong>só neste aparelho</strong>, cifrado com uma senha sua (AES-256). Os dados da sua conta guardados no servidor (perfil, publicações, mensagens cifradas) se pedem em{' '}
              <Link href={`/${locale}/settings/data-rights`} className="underline text-primary">Direitos dos Dados</Link>.
            </p>
          </div>

          {painel === null && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setPartes({ preferences: true, keys: true, p2p: true }); setPainel('exportar'); }}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar backup cifrado
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Importar backup
              </Button>
              <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void handleChooseFile(e)} />
            </div>
          )}

          {painel === 'exportar' && (
            <div className="space-y-2.5 rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium">O que levar no arquivo</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {([['preferences', 'Preferências'], ['keys', 'Chaves E2EE'], ['p2p', 'Histórico P2P']] as const).map(([chave, rotulo]) => (
                  <label key={chave} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={partes[chave]} onChange={(e) => setPartes((p) => ({ ...p, [chave]: e.target.checked }))} />
                    {rotulo}
                  </label>
                ))}
              </div>
              <Input type="password" autoComplete="new-password" placeholder={`Senha do arquivo (mín. ${MIN_PASSPHRASE_CHARS} caracteres)`} value={senha} onChange={(e) => setSenha(e.target.value)} />
              <Input type="password" autoComplete="new-password" placeholder="Repita a senha" value={senha2} onChange={(e) => setSenha2(e.target.value)} />
              {senha2.length > 0 && senha !== senha2 && <p className="text-xs text-destructive">As senhas não são iguais.</p>}
              <p className="text-xs text-muted-foreground">Não existe como recuperar a senha: sem ela, o arquivo não abre. Guarde-a em um gerenciador de senhas.</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => void handleExport()} disabled={!senhaValida || ocupado || (!partes.preferences && !partes.keys && !partes.p2p)}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {ocupado ? 'Cifrando…' : 'Exportar'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={fecharPainel}>Cancelar</Button>
              </div>
            </div>
          )}

          {painel === 'importar' && arquivo && (
            <div className="space-y-2.5 rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-xs font-medium break-all">Arquivo: {arquivo.nome}</p>
              {arquivo.cifrado ? (
                <Input type="password" autoComplete="off" placeholder="Senha do arquivo" value={senha} onChange={(e) => setSenha(e.target.value)} />
              ) : (
                <p className="text-xs text-amber-500">Este arquivo não é cifrado (formato antigo). Importe e, em seguida, faça um backup novo, cifrado.</p>
              )}
              <p className="text-xs text-muted-foreground">As chaves do arquivo são <strong>unidas</strong> às deste aparelho (nenhuma é apagada), e as mensagens são unidas ao histórico atual. O que estiver fora do formato é descartado.</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => void handleImport()} disabled={ocupado || (arquivo.cifrado && senha.length === 0)}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {ocupado ? 'Importando…' : 'Importar'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={fecharPainel}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
