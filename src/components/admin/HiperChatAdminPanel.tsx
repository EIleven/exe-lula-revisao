'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Globe, Loader2, Lock, MessageSquare, RefreshCw, Save, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';

interface HiperChatAdminData {
  config: {
    enabled: boolean;
    allowFederatedDms: boolean;
    allowGroupCreation: boolean;
    maxGroupParticipants: number;
    notice: string;
  };
  metrics: {
    totalConversations: number;
    directConversations: number;
    groupConversations: number;
    dmPreferences: {
      everyone: number;
      following: number;
      none: number;
    };
  };
  appRelease: {
    packageName: string;
    versionName: string;
    apkUrl: string;
    sha256: string;
  };
  recentConversations: {
    id: string;
    isGroup: boolean;
    groupName: string | null;
    participantsCount: number;
    isEncrypted: boolean;
    updatedAt: string | null;
  }[];
}

export default function HiperChatAdminPanel() {
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const [data, setData] = useState<HiperChatAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [allowFederatedDms, setAllowFederatedDms] = useState(true);
  const [allowGroupCreation, setAllowGroupCreation] = useState(true);
  const [maxGroupParticipants, setMaxGroupParticipants] = useState('1000');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/hiperchat', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar dados do HiperChat');
      const json = (await res.json()) as HiperChatAdminData;
      setData(json);
      setEnabled(json.config.enabled);
      setAllowFederatedDms(json.config.allowFederatedDms);
      setAllowGroupCreation(json.config.allowGroupCreation);
      setMaxGroupParticipants(String(json.config.maxGroupParticipants));
      setNotice(json.config.notice || '');
    } catch (err) {
      toast({
        title: 'Erro ao carregar HiperChat',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || saving) return;
    setSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/hiperchat', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled,
          allowFederatedDms,
          allowGroupCreation,
          maxGroupParticipants: Number(maxGroupParticipants) || 1000,
          notice,
        }),
      });
      if (!res.ok) throw new Error('Falha ao salvar configurações');
      toast({ title: 'HiperChat atualizado!' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Erro ao salvar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Painel de Controle · HiperChat
          </h2>
          <p className="text-xs text-muted-foreground">
            Métricas em tempo real, governança de conversas e distribuição do app independente (`app.hiperverso.chat`).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl border-border/80">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Conversas Totais</p>
            <p className="mt-1 text-2xl font-bold">{data?.metrics.totalConversations ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/80">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Chats Diretos (1:1)</p>
            <p className="mt-1 text-2xl font-bold">{data?.metrics.directConversations ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/80">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Grupos Ativos</p>
            <p className="mt-1 text-2xl font-bold">{data?.metrics.groupConversations ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/80">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">DMs Abertas / Seguindo / Bloq.</p>
            <p className="mt-1 text-sm font-bold">
              {data?.metrics.dmPreferences.everyone ?? 0} / {data?.metrics.dmPreferences.following ?? 0} /{' '}
              {data?.metrics.dmPreferences.none ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Governança &amp; Limites do HiperChat</CardTitle>
            <CardDescription className="text-xs">
              Controles aplicados globalmente às conversas e ao aplicativo HiperChat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
                <div>
                  <Label className="text-sm">Serviço HiperChat ativo</Label>
                  <p className="text-xs text-muted-foreground">Habilita o app independente e novas mensagens</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <Label className="text-sm">DMs federadas (ActivityPub)</Label>
                    <p className="text-xs text-muted-foreground">Troca de mensagens diretas com contas externas</p>
                  </div>
                </div>
                <Switch checked={allowFederatedDms} onCheckedChange={setAllowFederatedDms} />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <Label className="text-sm">Criação de grupos</Label>
                    <p className="text-xs text-muted-foreground">Permite criar novos chats em grupo</p>
                  </div>
                </div>
                <Switch checked={allowGroupCreation} onCheckedChange={setAllowGroupCreation} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Máx. participantes por grupo</Label>
                  <Input
                    type="number"
                    min={2}
                    max={5000}
                    value={maxGroupParticipants}
                    onChange={(e) => setMaxGroupParticipants(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Aviso operacional (opcional)</Label>
                  <Input
                    value={notice}
                    onChange={(e) => setNotice(e.target.value)}
                    placeholder="Ex.: Beta aberto de mensagens"
                    className="mt-1"
                  />
                </div>
              </div>

              <Button type="submit" disabled={saving} className="w-full rounded-xl">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar Configurações do HiperChat
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Distribuição APK · HiperChat</CardTitle>
                <Badge variant="secondary">v{data?.appRelease.versionName ?? '1.5.0'}</Badge>
              </div>
              <CardDescription className="text-xs">
                Pacote: <span className="font-mono">{data?.appRelease.packageName ?? 'app.hiperverso.chat'}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl bg-muted/40 p-2.5 text-[11px] font-mono break-all text-muted-foreground">
                SHA-256: {data?.appRelease.sha256}
              </div>
              <Button asChild variant="outline" size="sm" className="w-full rounded-xl">
                <a href={data?.appRelease.apkUrl ?? '/downloads/HiperChat-1.5.0.apk'} download>
                  <Download className="mr-2 h-4 w-4" />
                  Baixar HiperChat APK ({data?.appRelease.versionName ?? '1.5.0'})
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Conversas Recentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-60 overflow-y-auto">
              {(data?.recentConversations || []).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {c.isGroup ? c.groupName || 'Grupo sem nome' : `Chat Direto · ${c.id.slice(0, 10)}…`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.participantsCount} participantes
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.isEncrypted && <Lock className="h-3.5 w-3.5 text-emerald-500" />}
                    <Badge variant="outline" className="text-[10px]">
                      {c.isGroup ? 'Grupo' : '1:1'}
                    </Badge>
                  </div>
                </div>
              ))}
              {!loading && (data?.recentConversations?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma conversa registrada.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
