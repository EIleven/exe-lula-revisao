'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowRight, Globe, Search, Settings2, Share2 } from 'lucide-react';
import BackButton from '@/components/shared/BackButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export default function FediverseIndexPage() {
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [handleInput, setHandleInput] = useState('');

  const handleOpenProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = handleInput.trim().replace(/^@+/, '');
    if (!cleaned || !cleaned.includes('@')) {
      toast({
        title: 'Informe um @ completo',
        description: 'Exemplo: usuario@mastodon.social ou jornal@fosstodon.org',
        variant: 'destructive',
      });
      return;
    }
    router.push(`/${locale}/fediverse/${encodeURIComponent(cleaned)}`);
  };

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : `https://hiperverso.app/${locale}/fediverse`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Fediverso no HiperVerso',
          text: 'Busque e acompanhe perfis do Mastodon e Fediverso direto pelo HiperVerso.',
          url,
        });
        return;
      }
    } catch {
      // Fallback para área de transferência
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link copiado',
        description: 'Endereço do Fediverso copiado para compartilhar.',
      });
    } catch {
      toast({
        title: 'Copie o link',
        description: url,
      });
    }
  };

  return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        <div className="flex items-center justify-between gap-2">
          <BackButton />
          <Button type="button" variant="outline" size="sm" onClick={handleShare} className="gap-1.5">
            <Share2 className="h-4 w-4" />
            Compartilhar
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Fediverso (ActivityPub)</CardTitle>
                <CardDescription>
                  Conecte-se com pessoas do Mastodon, Pixelfed e outras redes abertas sem sair do HiperVerso.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleOpenProfile} className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  placeholder="Ex.: @usuario@mastodon.social"
                  className="pl-9"
                  aria-label="Buscar perfil no Fediverso"
                />
              </div>
              <Button type="submit" className="gap-1.5">
                Abrir perfil
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/${locale}/settings/fediverse`}>
                  <Settings2 className="mr-1.5 h-4 w-4" />
                  Configurar minha federação
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/explore`}>Explorar rede</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}

