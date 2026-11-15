'use client';

// O que a pessoa publicou/editou/apagou e o que aconteceu com cada envio. Falhou ou desistimos? Tem "tentar de novo".
// Nunca mostra o corpo da atividade nem o endereço completo do servidor de destino: só o domínio, o estado e o motivo.
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getDeliveries, retryDelivery } from '@/lib/federation/client';
import type { DeliveryItem } from '@/lib/federation/client';

const VARIANTE: Record<DeliveryItem['status'], 'secondary' | 'outline' | 'destructive'> = {
  sent: 'secondary', pending: 'outline', cancelled: 'outline', failed: 'destructive', dead: 'destructive',
};

export default function FediverseDeliveries() {
  const t = useTranslations('Fediverse.deliveries');
  const locale = useLocale();
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const [itens, setItens] = useState<DeliveryItem[] | null>(null);
  const [erro, setErro] = useState(false);
  const [tentando, setTentando] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setErro(false);
    try { setItens(await getDeliveries(firebaseUser)); } catch { setErro(true); }
  }, [firebaseUser]);

  useEffect(() => { void load(); }, [load]);

  const repetir = async (id: string) => {
    if (!firebaseUser) return;
    setTentando(id);
    try {
      await retryDelivery(firebaseUser, id);
      toast({ title: t('retried') });
      await load();
    } catch {
      toast({ title: t('retryError'), variant: 'destructive' });
    } finally {
      setTentando(null);
    }
  };

  const quando = (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  if (!itens && !erro) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (erro || !itens) return <Button variant="outline" size="sm" onClick={() => void load()}>{t('tryAgain')}</Button>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('explain')}</p>
        <Button variant="ghost" size="icon" aria-label={t('refresh')} onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {itens.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>}
      <ul className="divide-y rounded-md border">
        {itens.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 p-3" data-testid="fediverse-delivery">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t.has(`ops.${e.op}`) ? t(`ops.${e.op}`) : e.op}</span>
                <Badge variant={VARIANTE[e.status]}>{t(`status.${e.status}`)}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{e.domain} · {quando(e.createdAtMs)}{e.attempts > 0 ? ` · ${t('attempts', { count: e.attempts })}` : ''}</p>
              {e.status === 'dead' && <p className="text-xs text-muted-foreground">{t('deadExplain')}</p>}
            </div>
            {(e.status === 'dead' || e.status === 'failed') && (
              <Button variant="outline" size="sm" disabled={tentando === e.id} onClick={() => void repetir(e.id)}>
                {tentando === e.id && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}{t('retry')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
