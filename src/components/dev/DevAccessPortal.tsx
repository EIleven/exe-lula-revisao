'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Code2, ShieldAlert, GitBranch, KeyRound, CheckCircle2, XCircle, Clock, Copy, Send, Lock, Share2, ExternalLink } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DevAccessItem {
  id: string;
  uid: string | null;
  requesterUsername: string;
  requesterName: string;
  githubHandle: string;
  contactEmail: string;
  focusArea: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string;
  createdAt: string;
}

const FOCUS_OPTIONS = [
  'Federação ActivityPub / ATProto',
  'WebRTC P2P & E2EE (Zero DB)',
  'Segurança / Anti-Abuso / Regras',
  'Frontend / Player / UX',
  'Auditoria Geral',
];

export function DevAccessPortal() {
  const { currentUser } = useCurrentUser();
  const { toast } = useToast();

  const [githubHandle, setGithubHandle] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [focusArea, setFocusArea] = useState(FOCUS_OPTIONS[0]);
  const [reason, setReason] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [items, setItems] = useState<DevAccessItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setIsLoadingList(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dev-access', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { isAdmin?: boolean; items?: DevAccessItem[] };
      setIsAdmin(Boolean(data.isAdmin));
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      void loadRequests();
    }
  }, [currentUser?.id, loadRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      const res = await fetch('/api/dev-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          githubHandle,
          contactEmail,
          focusArea,
          reason,
          acceptedTerms,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message || 'Não foi possível enviar a solicitação.');
      }
      toast({
        title: 'Solicitação enviada',
        description: data.message || 'Os administradores foram notificados no HiperVerso.',
      });
      setReason('');
      await loadRequests();
    } catch (err: unknown) {
      toast({
        title: 'Erro ao solicitar acesso',
        description: err instanceof Error ? err.message : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    setUpdatingId(id);
    try {
      const res = await fetch('/api/dev-access', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar status.');
      toast({
        title: status === 'approved' ? 'Acesso aprovado' : 'Solicitação recusada',
        description: 'O solicitante foi notificado no HiperVerso.',
      });
      await loadRequests();
    } catch (err: unknown) {
      toast({
        title: 'Erro',
        description: err instanceof Error ? err.message : 'Não foi possível atualizar.',
        variant: 'destructive',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const renderStatusBadge = (status: DevAccessItem['status']) => {
    if (status === 'approved') {
      return (
        <Badge className="gap-1 bg-emerald-600/20 text-emerald-400 border-emerald-500/40">
          <CheckCircle2 className="h-3 w-3" /> Aprovado
        </Badge>
      );
    }
    if (status === 'rejected') {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Recusado
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" /> Pendente
      </Badge>
    );
  };

  const shareUrl = async (targetUrl: string, title: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url: targetUrl });
        return;
      }
    } catch {
      // Usuário cancelou ou Web Share indisponível; cai no clipboard
    }
    try {
      await navigator.clipboard.writeText(targetUrl);
      toast({
        title: 'Link copiado',
        description: targetUrl,
      });
    } catch {
      toast({
        title: 'Copie o link',
        description: targetUrl,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/70 bg-card/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">HiperVerso DEV &amp; Revisão Técnica</h1>
              <p className="text-sm text-muted-foreground">
                Especificações abertas de federação, diretrizes de segurança e acesso ao repositório público.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                void shareUrl(
                  typeof window !== 'undefined' ? window.location.href : 'https://hiperverso.app/pt-BR/dev',
                  'HiperVerso DEV & Revisão Técnica',
                  'Confira a página DEV, especificações e repositório público do HiperVerso.'
                )
              }
            >
              <Share2 className="h-4 w-4" />
              Compartilhar página
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="repo" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="repo">Repositório & Acesso</TabsTrigger>
          <TabsTrigger value="api">Arquitetura & Política Anti-Bot</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="gap-1.5">
              Aprovações ({items.filter((i) => i.status === 'pending').length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="repo" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Repositório Público (`hiperverso`)
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() =>
                      void shareUrl(
                        'https://github.com/EIleven/hiperverso',
                        'Repositório Público — HiperVerso',
                        'Repositório público sob licença AGPL-3.0 para auditoria técnica e contribuições.'
                      )
                    }
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Compartilhar repo
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
                    <a
                      href="https://github.com/EIleven/hiperverso"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir no GitHub
                    </a>
                  </Button>
                </div>
              </div>
              <CardDescription>
                Espelho sanitizado (sem credenciais, sem dados de produção e sem chaves privadas) para auditoria técnica e envio de Pull Requests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground space-y-2">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-primary" />
                  Licença Open Source (AGPL-3.0) &amp; Governança
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>O repositório público adota a licença <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong>, a mesma usada em projetos referência do Fediverso.</li>
                  <li>Qualquer modificação executada em servidor público ou rede derivada deve manter o código aberto sob a mesma licença.</li>
                  <li>Modelos complementares de governança e licenciamento seguem em avaliação após apresentação a professores do <strong>IFTM</strong> e reuniões com institutos de pesquisa voltados à soberania digital do Brasil.</li>
                  <li>Vulnerabilidades sensíveis devem ser reportadas de forma responsável e privada à administração antes da divulgação pública.</li>
                </ul>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Usuário do GitHub *</label>
                    <Input
                      placeholder="ex: seu-usuario"
                      value={githubHandle}
                      onChange={(e) => setGithubHandle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">E-mail de contato (opcional)</label>
                    <Input
                      type="email"
                      placeholder="dev@exemplo.com"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Área técnica de foco</label>
                  <select
                    value={focusArea}
                    onChange={(e) => setFocusArea(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {FOCUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Objetivo da análise / contribuição *</label>
                  <Textarea
                    rows={3}
                    placeholder="Explique brevemente o que deseja auditar, testar ou melhorar no sistema..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </div>

                <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-3 text-xs cursor-pointer">
                  <Checkbox
                    checked={acceptedTerms}
                    onCheckedChange={(v) => setAcceptedTerms(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Li e concordo com a licença <strong>AGPL-3.0</strong> e com as diretrizes de divulgação responsável de segurança do repositório <code>hiperverso</code>.
                  </span>
                </label>

                <Button type="submit" disabled={isSubmitting || !acceptedTerms} className="gap-2">
                  <Send className="h-4 w-4" />
                  {isSubmitting ? 'Enviando solicitação...' : 'Solicitar Acesso ao Repositório'}
                </Button>
              </form>

              {currentUser && items.length > 0 && !isAdmin && (
                <div className="pt-3 border-t border-border/60 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Suas solicitações</p>
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-xs">
                      <div>
                        <span className="font-semibold">@{item.githubHandle}</span> · {item.focusArea}
                      </div>
                      {renderStatusBadge(item.status)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                Política Anti-Bot, Anti-Scraping & Proteção Própria contra DDoS
              </CardTitle>
              <CardDescription>
                A rede HiperVerso é operada para pessoas reais e instâncias federadas legítimas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Zero Bots &amp; Anti-IA:</strong> não disponibilizamos API pública para automação de contas, disparo automatizado ou coleta/treinamento de modelos de IA (`GPTBot`, `ClaudeBot`, `CCBot`, `Bytespider`, `Google-Extended` e scrapers similares são bloqueados na aplicação).
              </p>
              <p>
                <strong className="text-foreground">Defesa própria em código:</strong> aplicamos limitação de taxa por IP e identidade, validação criptográfica de assinaturas HTTP (ActivityPub), verificação de origem/provas e bloqueio ativo contra enxames e DDoS diretamente na aplicação.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                Endpoints Públicos de Interoperabilidade
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs font-mono">
              <div className="rounded-md bg-muted/40 p-2.5">GET /.well-known/webfinger?resource=acct:usuario@hiperverso.social</div>
              <div className="rounded-md bg-muted/40 p-2.5">GET /ap/users/[username] · GET /ap/actor (ActivityPub Actor + Chave Pública)</div>
              <div className="rounded-md bg-muted/40 p-2.5">POST /ap/inbox · POST /ap/users/[username]/inbox (Entrega assinada via HTTP Signatures)</div>
              <div className="rounded-md bg-muted/40 p-2.5">GET /feed.json · GET /feed.xml · GET /.well-known/nodeinfo</div>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin" className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Solicitações de Acesso (`hiperverso`)</CardTitle>
                <CardDescription>
                  Aprove ou recuse pedidos recebidos pelo portal DEV. O solicitante recebe notificação automática no HiperVerso.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoadingList && <p className="text-xs text-muted-foreground">Carregando solicitações...</p>}
                {!isLoadingList && items.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma solicitação recebida até o momento.</p>
                )}
                {items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/70 p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        GitHub: @{item.githubHandle}{' '}
                        {item.requesterUsername ? (
                          <span className="text-xs font-normal text-muted-foreground">
                            (HiperVerso: @{item.requesterUsername})
                          </span>
                        ) : null}
                      </div>
                      {renderStatusBadge(item.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong>Foco:</strong> {item.focusArea}
                      {item.contactEmail ? ` · ${item.contactEmail}` : ''}
                    </p>
                    <p className="text-xs leading-relaxed">{item.reason}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          void navigator.clipboard?.writeText(item.githubHandle);
                          toast({ title: `@${item.githubHandle} copiado` });
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copiar @GitHub
                      </Button>
                      {item.status !== 'approved' && (
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={updatingId === item.id}
                          onClick={() => void handleReview(item.id, 'approved')}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Aprovar
                        </Button>
                      )}
                      {item.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs gap-1"
                          disabled={updatingId === item.id}
                          onClick={() => void handleReview(item.id, 'rejected')}
                        >
                          <XCircle className="h-3 w-3" /> Recusar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

