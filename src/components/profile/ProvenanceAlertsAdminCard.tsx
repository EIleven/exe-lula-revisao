// src/components/profile/ProvenanceAlertsAdminCard.tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, Trash2, Globe, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';

interface ProvenanceAlert {
  id: string;
  hostname: string;
  origin?: string;
  provenanceId: string;
  channel: string;
  buildTag?: string;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastPathname?: string;
  lastReferrer?: string;
  lastRequestIp?: string;
  lastUserAgent?: string;
  country?: string;
  region?: string;
  city?: string;
  samplePaths?: string[];
}

export default function ProvenanceAlertsAdminCard() {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<ProvenanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await fetch('/api/system/provenance-alert', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar alertas');
      const data = await res.json();
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    } catch {
      toast({
        title: 'Erro ao carregar proveniência',
        description: 'Não foi possível consultar os alertas de cópias não autorizadas.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`/api/system/provenance-alert?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao remover alerta');
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast({ title: 'Alerta removido' });
    } catch {
      toast({ title: 'Erro ao remover alerta', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            Proveniência e Cópias em Domínios Não Autorizados
          </CardTitle>
          <CardDescription>
            Registra automaticamente metadados técnicos legais (domínio, URL pública, país/IP da requisição HTTP,
            User-Agent e identificador de origem) caso uma cópia do sistema seja implantada fora dos domínios oficiais.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAlerts()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Consultando registros de proveniência...</p>
        ) : alerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Nenhuma implantação não autorizada detectada até o momento.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Globe className="h-4 w-4 text-amber-500" />
                    <span className="font-semibold text-foreground">{alert.hostname}</span>
                    <Badge variant="outline">{alert.channel}</Badge>
                    <Badge variant="secondary">{alert.provenanceId}</Badge>
                    <Badge variant="destructive">{alert.hitCount} acesso(s)</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(alert.id)}
                    disabled={deletingId === alert.id}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>
                    <strong className="text-foreground">Origem:</strong> {alert.origin || alert.hostname}
                  </p>
                  <p>
                    <strong className="text-foreground">IP da requisição:</strong> {alert.lastRequestIp || 'n/d'}
                    {alert.country ? ` (${[alert.city, alert.region, alert.country].filter(Boolean).join(', ')})` : ''}
                  </p>
                  <p>
                    <strong className="text-foreground">Primeira detecção:</strong>{' '}
                    {new Date(alert.firstSeenAt).toLocaleString('pt-BR')}
                  </p>
                  <p>
                    <strong className="text-foreground">Última detecção:</strong>{' '}
                    {new Date(alert.lastSeenAt).toLocaleString('pt-BR')}
                  </p>
                  <p className="sm:col-span-2 truncate">
                    <strong className="text-foreground">Rotas acessadas:</strong>{' '}
                    {(alert.samplePaths && alert.samplePaths.length > 0
                      ? alert.samplePaths.join(', ')
                      : alert.lastPathname) || '/'}
                  </p>
                  {alert.lastUserAgent && (
                    <p className="sm:col-span-2 truncate">
                      <strong className="text-foreground">User-Agent:</strong> {alert.lastUserAgent}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

