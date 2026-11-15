'use client';

// Moderação de quem segue de fora e bloqueios, por conta da própria pessoa. Não depende de a plataforma ou de outro
// servidor concordar: bloquear um servidor remove os seguidores dele sem contatá-lo.
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, Loader2, UserMinus } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FederationApiError, addBlock, getBlocks, getFollowers, removeBlock, removeFollower,
} from '@/lib/federation/client';
import type { BlockItem, FollowerItem } from '@/lib/federation/client';

export default function FediverseModeration({ onChanged }: { onChanged: () => void }) {
  const t = useTranslations('Fediverse.moderation');
  const te = useTranslations('Fediverse');
  const { firebaseUser } = useCurrentUser();
  const { toast } = useToast();
  const [seguidores, setSeguidores] = useState<FollowerItem[] | null>(null);
  const [proxima, setProxima] = useState<string | null>(null);
  const [bloqueios, setBloqueios] = useState<BlockItem[] | null>(null);
  const [dominio, setDominio] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const [s, b] = await Promise.all([getFollowers(firebaseUser), getBlocks(firebaseUser)]);
      setSeguidores(s.items); setProxima(s.next); setBloqueios(b);
    } catch {
      setSeguidores([]); setBloqueios([]);
    }
  }, [firebaseUser]);

  useEffect(() => { void carregar(); }, [carregar]);

  const falha = (erro: unknown) => {
    const codigo = erro instanceof FederationApiError ? erro.code : 'erro-desconhecido';
    toast({ title: te('errorTitle'), description: te.has(`errors.${codigo}`) ? te(`errors.${codigo}`) : te('errors.erro-desconhecido'), variant: 'destructive' });
  };

  const agir = async (chave: string, acao: () => Promise<void>, aviso: string) => {
    setOcupado(chave);
    try { await acao(); toast({ title: aviso }); await carregar(); onChanged(); } catch (e) { falha(e); } finally { setOcupado(null); }
  };

  const maisSeguidores = async () => {
    if (!firebaseUser || !proxima) return;
    setOcupado('mais');
    try { const s = await getFollowers(firebaseUser, proxima); setSeguidores((atual) => [...(atual ?? []), ...s.items]); setProxima(s.next); } catch (e) { falha(e); } finally { setOcupado(null); }
  };

  if (!seguidores || !bloqueios) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="font-semibold">{t('followersTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('followersExplain')}</p>
        {seguidores.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t('followersEmpty')}</p>}
        <ul className="divide-y rounded-md border">
          {seguidores.map((s) => (
            <li key={s.actorId} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="fediverse-follower">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name ?? s.handle ?? s.domain}</p>
                <p className="truncate text-xs text-muted-foreground">{s.handle ? `@${s.handle}` : s.domain}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={ocupado !== null} onClick={() => void agir(`r:${s.actorId}`, async () => { await removeFollower(firebaseUser!, s.actorId); }, t('removed'))}>
                  <UserMinus className="mr-2 h-3 w-3" />{t('remove')}
                </Button>
                <Button variant="outline" size="sm" disabled={ocupado !== null} onClick={() => void agir(`b:${s.actorId}`, async () => { await addBlock(firebaseUser!, 'actor', s.actorId); }, t('blockedActor'))}>
                  <Ban className="mr-2 h-3 w-3" />{t('block')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {proxima && <Button variant="ghost" size="sm" disabled={ocupado !== null} onClick={() => void maisSeguidores()}>{t('loadMore')}</Button>}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">{t('blocksTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('blocksExplain')}</p>
        <div className="space-y-2">
          <Label htmlFor="fediverse-block-domain">{t('blockServer')}</Label>
          <div className="flex gap-2">
            <Input id="fediverse-block-domain" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="servidor.exemplo.org" autoCapitalize="none" autoCorrect="off" />
            <Button disabled={ocupado !== null || !dominio.trim()} onClick={() => void agir('dom', async () => { await addBlock(firebaseUser!, 'domain', dominio); setDominio(''); }, t('blockedServer'))}>
              {t('blockAction')}
            </Button>
          </div>
        </div>
        {bloqueios.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t('blocksEmpty')}</p>}
        <ul className="divide-y rounded-md border">
          {bloqueios.map((b) => (
            <li key={`${b.scope}:${b.value}`} className="flex items-center justify-between gap-2 p-3" data-testid="fediverse-block">
              <div className="min-w-0">
                <p className="truncate text-sm">{b.value}</p>
                <p className="text-xs text-muted-foreground">{b.scope === 'domain' ? t('scopeDomain') : t('scopeActor')}</p>
              </div>
              <Button variant="outline" size="sm" disabled={ocupado !== null} onClick={() => void agir(`u:${b.value}`, async () => { await removeBlock(firebaseUser!, b.scope, b.value); }, t('unblocked'))}>{t('unblock')}</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
