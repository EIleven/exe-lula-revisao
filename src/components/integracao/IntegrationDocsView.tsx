'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import BackButton from '@/components/shared/BackButton';

interface IntegrationDocsViewProps {
  baseUrl: string;
  host: string;
}

interface EndpointRow {
  method: string;
  path: string;
  spec: string;
  notes: string;
}

const DISCOVERY_ENDPOINTS: EndpointRow[] = [
  {
    method: 'GET',
    path: '/.well-known/webfinger?resource=acct:<handle>@<host>',
    spec: 'RFC 7033',
    notes: 'Resolve contas ativas e o ator da instância (acct:<host>@<host>) para Authorized Fetch.',
  },
  {
    method: 'GET',
    path: '/.well-known/nodeinfo',
    spec: 'NodeInfo 2.1',
    notes: 'Índice de metadados da instância apontando para /nodeinfo/2.1.',
  },
  {
    method: 'GET',
    path: '/nodeinfo/2.1',
    spec: 'NodeInfo 2.1',
    notes: 'Software, versão, protocolo ActivityPub, uso e política de registro aberto.',
  },
  {
    method: 'GET',
    path: '/.well-known/host-meta',
    spec: 'RFC 6415',
    notes: 'Template XRD/JRD de descoberta para instâncias legadas.',
  },
  {
    method: 'GET',
    path: '/.well-known/nostr.json',
    spec: 'NIP-05',
    notes: 'Mapeamento público de identidades Nostr quando habilitado pelo usuário.',
  },
  {
    method: 'GET',
    path: '/.well-known/matrix/client',
    spec: 'Matrix',
    notes: 'Descoberta de servidor Matrix para interoperabilidade de mensageria.',
  },
];

const AP_ENDPOINTS: EndpointRow[] = [
  {
    method: 'GET',
    path: '/ap/actor',
    spec: 'ActivityPub',
    notes: 'Ator da instância (Application) com chave RSA pública para assinatura de buscas autorizadas.',
  },
  {
    method: 'GET',
    path: '/ap/users/<handle>',
    spec: 'ActivityPub',
    notes: 'Objeto Person em application/activity+json com publicKeyPem (main-key).',
  },
  {
    method: 'POST',
    path: '/ap/inbox',
    spec: 'ActivityPub',
    notes: 'Shared inbox da instância. Exige HTTP Signature (rsa-sha256) e Digest SHA-256 válidos.',
  },
  {
    method: 'POST',
    path: '/ap/users/<handle>/inbox',
    spec: 'ActivityPub',
    notes: 'Inbox individual da conta para entregas diretas e atividades de seguimento.',
  },
  {
    method: 'GET',
    path: '/ap/users/<handle>/outbox',
    spec: 'ActivityPub',
    notes: 'OrderedCollection pública com as notas recentes da conta.',
  },
  {
    method: 'GET',
    path: '/ap/users/<handle>/followers | /following',
    spec: 'ActivityPub',
    notes: 'Coleções federadas de seguidores e contas seguidas.',
  },
  {
    method: 'GET',
    path: '/ap/notes/<id>',
    spec: 'ActivityPub',
    notes: 'Representação Note/Article dereferenciável (inclui comentários em /ap/notes/<id>/comments/<cid>).',
  },
  {
    method: 'GET',
    path: '/ap/users/<handle>/feed.xml',
    spec: 'Atom / RSS',
    notes: 'Feed XML público por conta para agregadores e leitores independentes.',
  },
];

function CopySnippetButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignora erro de clipboard bloqueado
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs gap-1.5"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label || (copied ? 'Copiado' : 'Copiar')}
    </Button>
  );
}

export default function IntegrationDocsView({ baseUrl, host }: IntegrationDocsViewProps) {
  const curlCommands = `# 1. WebFinger (ator da instancia)
curl -fsSL "${baseUrl}/.well-known/webfinger?resource=acct:${host}@${host}"

# 2. NodeInfo 2.1
curl -fsSL "${baseUrl}/nodeinfo/2.1"

# 3. Ator da instancia (Application + publicKeyPem)
curl -fsSL -H "Accept: application/activity+json" "${baseUrl}/ap/actor"

# 4. Ator de usuario (substitua <handle>)
curl -fsSL -H "Accept: application/activity+json" "${baseUrl}/ap/users/<handle>"`;

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
      <BackButton />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">ActivityPub</Badge>
            <Badge variant="secondary">WebFinger RFC 7033</Badge>
            <Badge variant="secondary">NodeInfo 2.1</Badge>
            <Badge variant="secondary">HTTP Signatures RSA-SHA256</Badge>
            <Badge variant="outline">AGPL-3.0</Badge>
            <Badge variant="outline">Escopo Regional: BR</Badge>
          </div>
          <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
            Integração Técnica, Federação e Pesquisa
          </CardTitle>
          <CardDescription className="text-sm sm:text-base leading-relaxed">
            Especificação dos endpoints públicos, contratos ActivityPub, assinatura criptográfica e código auditável do HiperVerso (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{host}</code>) para administradores de instâncias brasileiras, desenvolvedores e grupos de pesquisa acadêmica.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Descoberta e Identidade</CardTitle>
          <CardDescription>
            Pontos de entrada públicos para resolução de contas, metadados de instância e verificação de chaves.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Método</th>
                <th className="py-2 pr-3 font-medium">Rota</th>
                <th className="py-2 pr-3 font-medium">Padrão</th>
                <th className="py-2 font-medium">Comportamento</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {DISCOVERY_ENDPOINTS.map((row) => (
                <tr key={row.path} className="align-top">
                  <td className="py-2.5 pr-3 font-mono text-xs text-primary">{row.method}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs break-all">
                    {row.path.replaceAll('<host>', host)}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-muted-foreground">{row.spec}</td>
                  <td className="py-2.5 text-muted-foreground">{row.notes.replaceAll('<host>', host)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Endpoints ActivityPub e Feeds</CardTitle>
          <CardDescription>
            Compatibilidade direta com Mastodon, Misskey/Sharkey, Pleroma/Akkoma, Lemmy e leitores Atom.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Método</th>
                  <th className="py-2 pr-3 font-medium">Rota</th>
                  <th className="py-2 font-medium">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {AP_ENDPOINTS.map((row) => (
                  <tr key={row.path} className="align-top">
                    <td className="py-2.5 pr-3 font-mono text-xs text-primary">{row.method}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs break-all">{row.path}</td>
                    <td className="py-2.5 text-muted-foreground">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
            <p className="font-semibold">Contratos de segurança e semântica de objetos</p>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>
                <strong>Assinatura obrigatória no Inbox:</strong> entregas em <code className="text-xs bg-muted px-1 rounded">/ap/inbox</code> exigem cabeçalhos <code className="text-xs bg-muted px-1 rounded">Signature</code> (<code className="text-xs bg-muted px-1 rounded">rsa-sha256</code>) e <code className="text-xs bg-muted px-1 rounded">Digest: SHA-256</code> validados contra a chave pública do ator remetente.
              </li>
              <li>
                <strong>Atividades processadas:</strong> <code className="text-xs bg-muted px-1 rounded">Create</code>, <code className="text-xs bg-muted px-1 rounded">Update</code>, <code className="text-xs bg-muted px-1 rounded">Delete</code>, <code className="text-xs bg-muted px-1 rounded">Announce</code>, <code className="text-xs bg-muted px-1 rounded">Like</code>, <code className="text-xs bg-muted px-1 rounded">Follow</code>, <code className="text-xs bg-muted px-1 rounded">Accept</code>, <code className="text-xs bg-muted px-1 rounded">Reject</code> e <code className="text-xs bg-muted px-1 rounded">Undo</code>.
              </li>
              <li>
                <strong>Extensões interoperáveis:</strong> suporte a citações (<code className="text-xs bg-muted px-1 rounded">quoteUri</code> / <code className="text-xs bg-muted px-1 rounded">_misskey_quote</code>), texto alternativo de mídia (<code className="text-xs bg-muted px-1 rounded">attachment[].name</code>), sinalização de conteúdo sensível (<code className="text-xs bg-muted px-1 rounded">sensitive</code> e <code className="text-xs bg-muted px-1 rounded">summary</code>) e sincronização de bloqueios/remoções.
              </li>
              <li>
                <strong>Authorized Fetch (Secure Mode):</strong> instâncias que exigem fetch autenticado podem verificar as requisições assinadas pelo ator de instância <code className="text-xs bg-muted px-1 rounded">{baseUrl}/ap/actor</code>.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">3. Pesquisa Acadêmica, Auditoria e Política de Acesso</CardTitle>
          <CardDescription>
            Transparência de implementação, reprodutibilidade e separação entre federação legítima e coleta automatizada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            <strong>Código aberto sob AGPL-3.0:</strong> a implementação do servidor, das rotas ActivityPub, das regras de validação e do motor de busca está disponível para auditoria, ensino e replicação em laboratório.
          </p>
          <p>
            <strong>Zero Bots & Anti-IA vs. Federação:</strong> crawlers de treinamento de modelos e scrapers agressivos sem identificação são bloqueados ativamente. Instâncias federadas, leitores RSS/Atom e indexadores transparentes que respeitam <code className="text-xs bg-muted px-1 rounded">/robots.txt</code> e <code className="text-xs bg-muted px-1 rounded">/sitemap.xml</code> operam normalmente dentro dos limites de taxa.
          </p>
          <p>
            <strong>Escopo regional desta documentação:</strong> esta central técnica e seus exemplos de integração são mantidos especificamente para administradores de instâncias, desenvolvedores e instituições de pesquisa localizados no Brasil.
          </p>
          <div className="pt-2 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="https://github.com/EIleven/hiperverso" target="_blank" rel="noopener noreferrer" className="gap-1.5">
                Repositório Público (AGPL-3.0)
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${baseUrl}/nodeinfo/2.1`} target="_blank" rel="noopener noreferrer" className="gap-1.5">
                NodeInfo 2.1 ao vivo
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              4. Verificação Rápida via Terminal
            </CardTitle>
            <CardDescription>
              Comandos prontos para validar descoberta e entrega a partir da sua instância ou ambiente de estudo.
            </CardDescription>
          </div>
          <CopySnippetButton value={curlCommands} label="Copiar comandos" />
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg border bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-x-auto leading-relaxed">
            {curlCommands}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
