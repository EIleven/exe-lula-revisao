// src/components/idp2p/Idp2pUnifiedAccountsCard.tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Check, Copy, GitFork, Globe2, Link2, Plus, Shield, Trash2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface LinkedAccountItem {
  id: string;
  provider: string;
  handle: string;
  label?: string;
  externalUrl?: string;
  trustLevel: 'verified_oauth' | 'declared';
  linkedAt: string;
}

interface Idp2pUnifiedAccountsCardProps {
  userId: string;
  federatedLoginProvider?: string;
  federatedLoginHandle?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  exercitodolula: 'HiperVerso',
  mastodon: 'Mastodon / Fediverso',
  bluesky: 'Bluesky',
  google: 'Google (Privado)',
  github: 'GitHub',
  custom_oidc: 'Outro OIDC / App',
};

export default function Idp2pUnifiedAccountsCard({
  userId,
  federatedLoginProvider,
  federatedLoginHandle,
}: Idp2pUnifiedAccountsCardProps) {
  const locale = useLocale();
  const { toast } = useToast();
  const [idp2pId, setIdp2pId] = useState(`did:idp2p:exercitodolula:${userId}`);
  const [links, setLinks] = useState<LinkedAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [provider, setProvider] = useState('exercitodolula');
  const [handle, setHandle] = useState('');
  const [label, setLabel] = useState('');

  const fetchLinks = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/idp2p/linked-accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { idp2pId?: string; links?: LinkedAccountItem[] };
        if (data.idp2pId) setIdp2pId(data.idp2pId);
        if (Array.isArray(data.links)) setLinks(data.links);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLinks();
  }, [fetchLinks]);

  const handleCopyDid = async () => {
    try {
      await navigator.clipboard.writeText(idp2pId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ title: 'IDP2P copiado!' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch('/api/idp2p/linked-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          handle: handle.trim(),
          label: label.trim() || undefined,
        }),
      });
      if (!res.ok) {
        toast({ title: 'Não foi possível vincular esta conta', variant: 'destructive' });
        return;
      }
      const data = (await res.json()) as { link?: LinkedAccountItem };
      if (data.link) {
        setLinks((prev) => [data.link!, ...prev.filter((item) => item.id !== data.link!.id)]);
      }
      setHandle('');
      setLabel('');
      toast({ title: 'Conta vinculada ao seu IDP2P!' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLink = async (id: string) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    const res = await fetch(`/api/idp2p/linked-accounts?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setLinks((prev) => prev.filter((item) => item.id !== id));
      toast({ title: 'Vínculo removido.' });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Seu Passaporte IDP2P
          </CardTitle>
          <CardDescription className="text-xs">
            Identificador soberano para unificar suas contas na mesma rede, no Fediverso e em provedores privados.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <code className="rounded bg-muted px-2.5 py-1.5 text-xs font-mono break-all">
            {idp2pId}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyDid()}>
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar ID'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Contas Unificadas
          </CardTitle>
          <CardDescription className="text-xs">
            Vincule múltiplas contas (HiperVerso, Mastodon, Bluesky ou provedores privados) sob o mesmo controle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {federatedLoginHandle && (
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{federatedLoginHandle}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {federatedLoginProvider === 'bluesky' ? 'Bluesky' : 'Fediverso'} · OAuth verificado
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Conta federada conectada no seu login atual.</p>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-muted-foreground">Carregando vínculos...</p>
          ) : links.length === 0 && !federatedLoginHandle ? (
            <p className="text-xs text-muted-foreground">Nenhuma conta adicional vinculada ainda.</p>
          ) : (
            <div className="space-y-2">
              {links.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{item.handle}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {PROVIDER_LABELS[item.provider] ?? item.provider}
                      </Badge>
                      {item.label && (
                        <Badge variant="secondary" className="text-[10px]">
                          {item.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${item.handle}`}
                    onClick={() => void handleRemoveLink(item.id)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void handleAddLink(e)} className="grid gap-3 pt-2 border-t sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="idp2p-provider" className="text-xs">Rede / Provedor</Label>
              <select
                id="idp2p-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="exercitodolula">HiperVerso</option>
                <option value="mastodon">Mastodon / Fediverso</option>
                <option value="bluesky">Bluesky</option>
                <option value="google">Google (Privado)</option>
                <option value="github">GitHub</option>
                <option value="custom_oidc">Outro OIDC / App</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="idp2p-handle" className="text-xs">@handle ou e-mail</Label>
              <Input
                id="idp2p-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@voce@mastodon.social ou nome@gmail.com"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="idp2p-label" className="text-xs">Rótulo (opcional)</Label>
              <div className="flex gap-1.5">
                <Input
                  id="idp2p-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Trabalho"
                  className="h-9 text-xs"
                />
                <Button type="submit" size="sm" className="h-9 shrink-0" disabled={saving || !handle.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitFork className="h-4 w-4 text-primary" />
            Projeto P2P Aberto &amp; &ldquo;Entrar com HiperVerso&rdquo;
          </CardTitle>
          <CardDescription className="text-xs">
            Estamos abrindo a camada P2P/IDP2P para a comunidade forkar e evoluir o login soberano em outros sites e apps.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${locale}/dev`}>Acessar Portal DEV / Fork P2P</Link>
          </Button>
          <Badge variant="secondary" className="text-[11px]">
            OIDC / IDP2P em evolução
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}

