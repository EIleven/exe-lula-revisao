// src/components/admin/OfficialAccountAdminCard.tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, Globe, Loader2, Megaphone, Save } from 'lucide-react';

interface OfficialAccountState {
  profile: {
    id: string;
    name?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    website?: string;
  };
  federation: {
    enabled: boolean;
    paused: boolean;
    acct: string | null;
    followersCount?: number;
  };
  /** Saúde das entregas para o Fediverso; `null` se o servidor não conseguiu consultar. */
  deliveries?: {
    total: number;
    byStatus: Record<string, number>;
    dead: { id: string; domain: string; op: string; attempts: number; detail: string | null }[];
    signatureRejected: number;
    domainsWithTrouble: { domain: string; failing: number }[];
  } | null;
}

export default function OfficialAccountAdminCard() {
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const locale = useLocale();
  const [data, setData] = useState<OfficialAccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [website, setWebsite] = useState('');

  const loadAccount = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/official-account', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar conta oficial');
      const json = (await res.json()) as OfficialAccountState;
      setData(json);
      setName(json.profile?.name || 'HiperVerso');
      setBio(json.profile?.bio || '');
      setAvatarUrl(json.profile?.avatarUrl || '');
      setWebsite(json.profile?.website || 'https://hiperverso.app');
    } catch (err) {
      console.error(err);
      toast({
        title: 'Erro ao carregar conta oficial',
        description: 'Não foi possível carregar ou ativar o perfil oficial.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/official-account', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, bio, avatarUrl, website }),
      });
      if (!res.ok) {
        // A rota explica a recusa (ex.: imagem que não aparece no Fediverso): mostrar o motivo, não só "erro".
        const erro = (await res.json().catch(() => null)) as { detail?: unknown } | null;
        throw new Error(typeof erro?.detail === 'string' && erro.detail ? erro.detail : 'Falha ao salvar perfil');
      }
      const json = (await res.json()) as OfficialAccountState;
      setData(json);
      toast({ title: 'Perfil oficial atualizado!' });
    } catch (err) {
      toast({
        title: 'Erro ao salvar',
        description: err instanceof Error && err.message !== 'Falha ao salvar perfil' ? err.message : 'Não foi possível atualizar o perfil oficial.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">
              Conta Oficial {data?.profile?.username ? `@${data.profile.username}` : '@HiperVerso'}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {data?.federation?.enabled && (
              <Badge variant="secondary" className="gap-1 text-primary">
                <Globe className="h-3.5 w-3.5" />
                {data.federation.acct ? `@${data.federation.acct}` : '@hiperverso@hiperverso.social'}
              </Badge>
            )}
            {data?.profile?.id && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/profile/${data.profile.id}`}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Ver perfil
                </Link>
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          Perfil institucional controlado por administradores para comunicados, campanhas e novidades.
          Use o seletor <strong>&quot;Como @{data?.profile?.username || 'HiperVerso'}&quot;</strong> no botão <strong>Postar</strong> para publicar por esta conta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando / ativando conta oficial no Fediverso...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Nome de exibição</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Site / URL</label>
                <Input value={website} onChange={(e) => setWebsite(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Bio oficial</label>
              <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">URL do Avatar</label>
              <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="mt-1" />
            </div>
            {data?.deliveries && data.deliveries.total > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1" data-testid="official-deliveries">
                <p className="font-medium">
                  Entregas ao Fediverso (últimas {data.deliveries.total}): {data.deliveries.byStatus.sent ?? 0} enviadas,{' '}
                  {data.deliveries.byStatus.pending ?? 0} na fila, {data.deliveries.byStatus.dead ?? 0} com falha definitiva
                </p>
                {data.deliveries.signatureRejected > 0 && (
                  <p className="text-destructive">
                    {data.deliveries.signatureRejected} entrega(s) recusada(s) por assinatura (HTTP 401): confira a chave e o relógio do servidor.
                  </p>
                )}
                {data.deliveries.dead.slice(0, 3).map((d) => (
                  <p key={d.id} className="text-muted-foreground">
                    {d.domain}: {d.detail ?? 'sem detalhe'} (após {d.attempts} tentativa(s))
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar Perfil Oficial
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

