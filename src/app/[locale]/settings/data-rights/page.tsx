// src/app/[locale]/settings/data-rights/page.tsx
// Canal interno de atendimento ao titular (LGPD, art. 18 e 19).
//
// Por que existe, se já há e-mail: o canal dá protocolo, prazo visível e acompanhamento — três coisas que e-mail não
// dá. Mas ele NÃO substitui o e-mail: quem excluiu a conta, quem nunca teve conta, quem perdeu a senha e quem está
// suspenso precisam de uma porta que não dependa de login, e o art. 41 pede contato divulgado publicamente.
//
// Texto em pt-BR fixo, como as outras páginas legais (privacy, terms, cookies). Tradução para en é lacuna conhecida.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import BackButton from '@/components/shared/BackButton';
import ContactEmail from '@/components/shared/ContactEmail';
import PrivacyPreferencesButton from '@/components/consent/PrivacyPreferencesButton';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { useToast } from '@/hooks/use-toast';
import { createDataRequest, listMyDataRequests, type DataRequestView } from '@/lib/services/dataRequestService';
import {
  DATA_REQUEST_DEADLINE_DAYS,
  DATA_REQUEST_MESSAGE_MAX,
  SELF_SERVICE_HINT,
  daysRemaining,
  isOpen,
  protocolFor,
  type DataRequestKind,
} from '@/lib/rights/dataRequest';
import { siteConfig } from '@/config/site';

const TIPOS: { kind: DataRequestKind; titulo: string; descricao: string }[] = [
  {
    kind: 'confirmacao-e-acesso',
    titulo: 'Confirmação e acesso',
    descricao: 'Saber se tratamos seus dados e quais são.',
  },
  { kind: 'correcao', titulo: 'Correção', descricao: 'Corrigir dado incompleto, desatualizado ou errado.' },
  { kind: 'exclusao', titulo: 'Exclusão', descricao: 'Apagar dados ou a conta inteira.' },
  { kind: 'portabilidade', titulo: 'Portabilidade', descricao: 'Receber seus dados em formato que outro serviço leia.' },
  {
    kind: 'compartilhamento',
    titulo: 'Com quem compartilhamos',
    descricao: 'Saber com quais empresas ou órgãos seus dados foram compartilhados.',
  },
  {
    kind: 'revogacao-consentimento',
    titulo: 'Revogar consentimento',
    descricao: 'Retirar uma autorização que você deu antes.',
  },
  {
    kind: 'oposicao',
    titulo: 'Oposição',
    descricao: 'Discordar de um tratamento que fazemos com base em legítimo interesse.',
  },
];

const ROTULO_TIPO = new Map(TIPOS.map((t) => [t.kind, t.titulo]));

const ROTULO_STATUS: Record<DataRequestView['status'], string> = {
  recebido: 'Recebido',
  'em-analise': 'Em análise',
  respondido: 'Respondido',
  recusado: 'Recusado',
};

export default function DataRightsPage() {
  const locale = useLocale();
  const { currentUser, isLoading } = useCurrentUser();
  const { toast } = useToast();

  const [tipo, setTipo] = useState<DataRequestKind | ''>('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [protocoloNovo, setProtocoloNovo] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<DataRequestView[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      setPedidos(await listMyDataRequests());
    } catch {
      setPedidos([]); // Sem permissão ou offline: a lista fica vazia, o formulário continua servindo.
    }
  }, []);

  useEffect(() => {
    if (currentUser) void carregar();
  }, [currentUser, carregar]);

  const enviar = async () => {
    if (!tipo) return;
    setEnviando(true);
    try {
      const id = await createDataRequest(tipo, mensagem);
      setProtocoloNovo(protocolFor(id));
      setTipo('');
      setMensagem('');
      await carregar();
    } catch (erro: unknown) {
      toast({
        title: 'Não foi possível abrir o pedido',
        description: erro instanceof Error ? erro.message : 'Tente de novo em instantes.',
        variant: 'destructive',
      });
    } finally {
      setEnviando(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <BackButton />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const atalho = tipo ? SELF_SERVICE_HINT[tipo] : undefined;

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <BackButton />
      <Card>
        <CardHeader>
          <CardTitle>Seus direitos sobre seus dados</CardTitle>
          <CardDescription>
            Abra um pedido e acompanhe aqui. Respondemos em até {DATA_REQUEST_DEADLINE_DAYS} dias, sem cobrar nada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertTitle>Três coisas você resolve agora, sem abrir pedido</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                <li>
                  <Link href={`/${locale}/settings/account`} className="text-primary hover:underline">
                    Exportar seus dados
                  </Link>{' '}
                  em arquivo estruturado, ou <strong>excluir sua conta</strong> — Configurações &rsaquo; Conta.
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <span>Mudar ou revogar o consentimento de cookies:</span>
                  <PrivacyPreferencesButton variant="outline" />
                </li>
              </ul>
            </AlertDescription>
          </Alert>

          {!currentUser && (
            <Alert>
              <AlertTitle>Você não está logado</AlertTitle>
              <AlertDescription>
                Para abrir pedido por aqui é preciso entrar na conta — é assim que confirmamos que o pedido é seu. Se
                você não tem conta, perdeu o acesso ou já a excluiu, escreva para{' '}
                <ContactEmail channel="privacy" className="text-primary hover:underline" fallback={null} />, que
                atende do mesmo jeito.
              </AlertDescription>
            </Alert>
          )}

          {protocoloNovo && (
            <Alert>
              <AlertTitle>Pedido aberto — protocolo {protocoloNovo}</AlertTitle>
              <AlertDescription>
                Anote o protocolo. Ele também aparece na lista abaixo, com o prazo.
              </AlertDescription>
            </Alert>
          )}

          {currentUser && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base">O que você quer pedir?</Label>
                <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as DataRequestKind)} className="space-y-2">
                  {TIPOS.map((t) => (
                    <div key={t.kind} className="flex items-start gap-2 rounded-lg border p-3">
                      <RadioGroupItem value={t.kind} id={`tipo-${t.kind}`} className="mt-1" />
                      <Label htmlFor={`tipo-${t.kind}`} className="cursor-pointer font-normal">
                        <span className="font-medium">{t.titulo}</span>
                        <span className="block text-sm text-muted-foreground">{t.descricao}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {atalho && (
                <Alert>
                  <AlertDescription className="text-sm">
                    {atalho === 'exportar' &&
                      'Isso você já consegue sozinho: a exportação em Configurações › Conta entrega seus dados na hora. Abrir pedido aqui também funciona, se preferir.'}
                    {atalho === 'excluir-conta' &&
                      'A exclusão da conta está em Configurações › Conta e é imediata. Use este pedido se quiser apagar algo específico em vez da conta toda.'}
                    {atalho === 'preferencias' &&
                      'Consentimento de cookies você revoga no botão acima, na hora. Use este pedido para revogar outro consentimento.'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="mensagem">Quer explicar? (opcional)</Label>
                <Textarea
                  id="mensagem"
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  maxLength={DATA_REQUEST_MESSAGE_MAX}
                  rows={4}
                  placeholder="Não é obrigatório justificar para exercer um direito."
                />
                <p className="text-xs text-muted-foreground">
                  {mensagem.length}/{DATA_REQUEST_MESSAGE_MAX}. Não escreva senha nem dado de terceiro aqui.
                </p>
              </div>

              <Button onClick={enviar} disabled={!tipo || enviando}>
                {enviando ? 'Abrindo…' : 'Abrir pedido'}
              </Button>
            </div>
          )}

          <Separator />

          <section className="space-y-2">
            <h3 className="text-base font-semibold">Como confirmamos que o pedido é seu</h3>
            <p className="text-sm text-muted-foreground">
              Três coisas diferentes, e vale saber qual delas fazemos:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                <strong>Controle da conta:</strong> você está logado. É o que basta para pedido sobre a sua própria
                conta.
              </li>
              <li>
                <strong>Controle do e-mail:</strong> o endereço da conta recebe as confirmações.
              </li>
              <li>
                <strong>Identidade civil:</strong> <strong>não verificamos.</strong> Não pedimos CPF, documento,
                selfie nem biometria, e por isso não afirmamos saber quem você é na vida real.
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              Para exclusão e correção, o app pede sua senha de novo no momento da ação — proteção contra sessão
              esquecida aberta, não verificação de identidade.
            </p>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-base font-semibold">Seus pedidos</h3>
            {pedidos === null && currentUser && <Skeleton className="h-16 w-full" />}
            {pedidos !== null && pedidos.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum pedido aberto.</p>
            )}
            {pedidos?.map((p) => {
              const restam = daysRemaining(p.createdAtMs, Date.now());
              const aberto = isOpen(p.status);
              return (
                <div key={p.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{protocolFor(p.id)}</span>
                    <span className="text-muted-foreground">{ROTULO_STATUS[p.status]}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {ROTULO_TIPO.get(p.kind) ?? p.kind} &middot;{' '}
                    {new Date(p.createdAtMs).toLocaleDateString('pt-BR')}
                  </p>
                  {aberto && (
                    <p className="mt-1 text-muted-foreground">
                      {restam >= 0
                        ? `Prazo de resposta: ${restam} dia(s) restante(s).`
                        : `Prazo vencido há ${Math.abs(restam)} dia(s). Cobre em ${siteConfig.contact.privacy}.`}
                    </p>
                  )}
                  {p.message && <p className="mt-2 whitespace-pre-wrap">{p.message}</p>}
                  {p.response && (
                    <div className="mt-2 rounded border-l-2 border-primary pl-3">
                      <p className="whitespace-pre-wrap">{p.response}</p>
                      {p.respondedAtMs && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Respondido em {new Date(p.respondedAtMs).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <Separator />

          <p className="text-sm text-muted-foreground">
            Se discordar de uma resposta, você pode reclamar à <strong>ANPD</strong>, que é independente desta
            plataforma. Quem atende aqui é {siteConfig.controller.name}, a mesma pessoa que decide a moderação — está
            dito na{' '}
            <Link href={`/${locale}/privacy`} className="text-primary hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
