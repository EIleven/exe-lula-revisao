// src/lib/security/antiBotGuard.ts
// Núcleo autoral interno de proteção Anti-Bot, Anti-Scraping, Anti-QA Não Autorizado e Anti-Pentest/Recon.
// Calibrado para zero falso-positivo em navegadores reais (inclusive em aba anônima).

export type GuardAction = 'allow' | 'throttle' | 'challenge' | 'block';

export interface GuardVerdict {
  allowed: boolean;
  action: GuardAction;
  riskScore: number;
  reasons: string[];
  retryAfterSec: number;
}

export interface GuardRequestSignals {
  ip: string;
  path: string;
  query?: string | null;
  method?: string;
  userAgent?: string | null;
  acceptLanguage?: string | null;
  acceptHeader?: string | null;
  secChUa?: string | null;
  secFetchMode?: string | null;
  secFetchSite?: string | null;
  secFetchDest?: string | null;
  webdriverHeader?: string | null;
  ownerQaToken?: string | null;
  expectedOwnerQaToken?: string | null;
  hasHumanCookie?: boolean;
  isAuthenticated?: boolean;
  hasValidProof?: boolean;
  nowMs?: number;
}

interface BucketState {
  hits: number[];
  burstHits: number[];
  blockedUntilMs: number;
  strikes: number;
}

const MAX_BUCKETS = 12_000;
const SHORT_WINDOW_MS = 10_000;
const LONG_WINDOW_MS = 60_000;
const SHORT_BURST_LIMIT = 28;
const LONG_RATE_LIMIT = 180;

// Scanners de rede, recon, pentest não autorizado e exploração
const PENTEST_AND_RECON_UA =
  /\b(nmap|nse|masscan|zgrab|zmap|nuclei|nikto|sqlmap|gobuster|ffuf|dirbuster|dirb|feroxbuster|wfuzz|wpscan|burpsuite|zaproxy|acunetix|nessus|openvas|qualys|arachni|w3af|skipfish|commix|dalfox|xsstrike|hydra|medusa|patator|metasploit|shodan|censys|httpx|subfinder|amass|katana|hakrawler|gospider|jaeles|xray|afrog)\b/i;

// Motores de QA não autorizado, agentes autônomos de navegador, scrapers de texto e crawlers de IA
const KNOWN_AUTOMATION_UA =
  /\b(python-requests|python-urllib|python-httpx|aiohttp|curl|wget|libcurl|httpie|scrapy|colly|mechanize|playwright|puppeteer|selenium|webdriver|chromedriver|geckodriver|headlesschrome|phantomjs|slimerjs|casperjs|nightmarejs|cypress|testcafe|watir|stagehand|browseruse|browser-use|skyvern|firecrawl|crawl4ai|trafilatura|newspaper3k|beautifulsoup|jsoup|cheerio|htmlunit|apify|brightdata|scrapingbee|zenrows|oxylabs|scraperapi|zyte|diffbot|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|ccbot|bytespider|google-extended|perplexitybot|meta-externalagent|amazonbot|applebot-extended|cohere-ai|youbot|omgili|imagesiftbot|friendlycrawler|timpibot|velenpublicwebcrawler|webzio-extended|ai2bot|imsr-bot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|BLEXBot|dataforseobot|httpclient|go-http-client|axios|node-fetch|undici|libwww-perl|okhttp|apache-httpclient|rust-reqwest)\b/i;

// Clientes federados legítimos (apenas em rotas ActivityPub / WebFinger / NodeInfo)
const LEGIT_FEDIVERSE_UA =
  /\b(mastodon|pleroma|akkoma|misskey|catodon|sharkey|wafrn|lemmy|pixelfed|peertube|friendica|calckey|firefish|iceshrimp|snac|gotosocial|bluesky|atproto|fedify|orka|kbin|mbin|bookwyrm|funkwhale|writefreely|castopod|mobilizon|owncast)\b/i;

// Armadilhas de varredura de portas/arquivos/exploits (nmap http-enum, nuclei, pentest)
const RECON_TRAP_PATH_REGEX =
  /(?:^|\/)(?:\.env(?:\..+)?|\.git(?:\/|$)|\.svn(?:\/|$)|\.hg(?:\/|$)|\.DS_Store|wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer|actuator(?:\/|$)|server-status|server-info|cgi-bin|vendor\/phpunit|_ignition|_profiler|debug\/pprof|config\.(?:php|yml|yaml|bak|inc)|backup\.(?:sql|zip|tar|gz)|db\.sql|dump\.sql|\.aws|\.ssh|\.kube|\.docker|id_rsa|web\.config|elmah\.axd|trace\.axd|solr\/|jenkins\/|hudson\/|boaform\/|HNAP1|evox\/|shell\.php|cmd\.php|eval-stdin\.php)(?:\/|$|\?)/i;

// Assinaturas de injeção explícita (SQLi, XSS, Path Traversal, JNDI/Log4Shell, Command Injection)
const EXPLOIT_PAYLOAD_REGEX =
  /(?:\bunion\s+(?:all\s+)?select\b|\bselect\b.+\bfrom\b.+\binformation_schema\b|\bwaitfor\s+delay\b|\bbenchmark\s*\(|\bsleep\s*\(\s*\d+\s*\)|\.\.\/|\.\.%2f|\.\.\\|\/etc\/passwd|\/etc\/shadow|c:\\windows\\win\.ini|\$\{jndi:(?:ldap|rmi|dns|nis|iiop|corba|nds|http):|<script\b|javascript:|onerror\s*=|onload\s*=|;\s*(?:cat|ls|whoami|id|uname|curl|wget|bash|sh|nc|netcat|powershell|cmd\.exe)\b)/i;

const buckets = new Map<string, BucketState>();

function pruneBucketsIfNeeded(nowMs: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, state] of buckets.entries()) {
    const lastHit = state.hits[state.hits.length - 1] ?? 0;
    if (state.blockedUntilMs < nowMs && nowMs - lastHit > LONG_WINDOW_MS * 2) {
      buckets.delete(key);
    }
    if (buckets.size < MAX_BUCKETS * 0.8) break;
  }
}

export function resetAntiBotBuckets(): void {
  buckets.clear();
}

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function evaluateRequestSecurity(signals: GuardRequestSignals): GuardVerdict {
  const nowMs = signals.nowMs ?? Date.now();
  const ip = (signals.ip || 'unknown').trim() || 'unknown';
  const rawPath = signals.path || '/';
  const pathOnly = rawPath.split('?')[0] || '/';
  const queryPart = signals.query ?? (rawPath.includes('?') ? rawPath.slice(rawPath.indexOf('?') + 1) : '');
  const fullTarget = queryPart ? `${pathOnly}?${queryPart}` : pathOnly;
  const ua = (signals.userAgent || '').trim();
  const secChUa = (signals.secChUa || '').trim();

  // 0. Bypass exclusivo do proprietário (QA / automação interna autorizada com chave secreta)
  const expectedOwnerToken =
    signals.expectedOwnerQaToken ??
    (typeof process !== 'undefined' ? process.env?.SOBERAN_OWNER_QA_KEY : undefined) ??
    '';
  if (
    expectedOwnerToken &&
    expectedOwnerToken.length >= 16 &&
    signals.ownerQaToken &&
    constantTimeEquals(signals.ownerQaToken.trim(), expectedOwnerToken.trim())
  ) {
    return {
      allowed: true,
      action: 'allow',
      riskScore: 0,
      reasons: ['owner-authorized-qa'],
      retryAfterSec: 0,
    };
  }

  pruneBucketsIfNeeded(nowMs);

  const key = `${ip}:${pathOnly.split('/').slice(0, 4).join('/')}`;
  const state: BucketState = buckets.get(key) ?? {
    hits: [],
    burstHits: [],
    blockedUntilMs: 0,
    strikes: 0,
  };

  if (state.blockedUntilMs > nowMs) {
    return {
      allowed: false,
      action: 'block',
      riskScore: 100,
      reasons: ['cooldown-ativo'],
      retryAfterSec: Math.max(1, Math.ceil((state.blockedUntilMs - nowMs) / 1000)),
    };
  }

  state.burstHits = state.burstHits.filter((t) => nowMs - t <= SHORT_WINDOW_MS);
  state.hits = state.hits.filter((t) => nowMs - t <= LONG_WINDOW_MS);
  state.burstHits.push(nowMs);
  state.hits.push(nowMs);

  let riskScore = 0;
  const reasons: string[] = [];

  // 1. Detecção imediata de Pentest / Nmap / Recon / Exploit Payload
  if (PENTEST_AND_RECON_UA.test(ua)) {
    riskScore += 100;
    reasons.push('scanner-pentest-detectado');
  }
  if (RECON_TRAP_PATH_REGEX.test(pathOnly)) {
    riskScore += 100;
    reasons.push('sondagem-rota-proibida');
  }
  let decodedTarget = fullTarget;
  try {
    decodedTarget = decodeURIComponent(fullTarget);
  } catch {
    // ignora erro de decode parcial em URLs normais
  }
  if (EXPLOIT_PAYLOAD_REGEX.test(decodedTarget)) {
    riskScore += 100;
    reasons.push('payload-exploracao-detectado');
  }

  // 2. Burst e flood por rota específica (DDoS)
  if (state.burstHits.length > SHORT_BURST_LIMIT) {
    riskScore += state.burstHits.length > Math.ceil(SHORT_BURST_LIMIT * 1.1) ? 85 : 55;
    reasons.push('burst-excessivo');
  }
  if (state.hits.length > LONG_RATE_LIMIT) {
    riskScore += 45;
    reasons.push('rate-limit-excedido');
  }

  // 3. Assinatura de automação, agentes autônomos e QA não autorizado (respeitando Fediverso legítimo)
  const isFederatedRoute =
    pathOnly.startsWith('/ap/') ||
    pathOnly.startsWith('/.well-known/') ||
    pathOnly.startsWith('/nodeinfo') ||
    pathOnly.startsWith('/api/v1/instance') ||
    pathOnly.startsWith('/api/v2/instance');
  const isFederatedClient = LEGIT_FEDIVERSE_UA.test(ua) && isFederatedRoute;

  if (!ua) {
    riskScore += 30;
    reasons.push('user-agent-ausente');
  } else if (!isFederatedClient && KNOWN_AUTOMATION_UA.test(ua)) {
    riskScore += 80;
    reasons.push('user-agent-automacao');
  }

  if (
    /HeadlessChrome|PhantomJS|Playwright|Puppeteer|Cypress/i.test(secChUa) ||
    signals.webdriverHeader === '1' ||
    signals.webdriverHeader === 'true'
  ) {
    riskScore += 85;
    reasons.push('headless-ou-webdriver');
  }

  // 4. Ausência de cabeçalhos básicos (apenas sinal leve, nunca bloqueia navegador em aba anônima sozinho)
  if (!isFederatedClient && !signals.isAuthenticated && !signals.acceptLanguage && !isFederatedRoute) {
    riskScore += 15;
    reasons.push('sem-accept-language');
  }

  // 5. Atenuantes de confiança (humano real, sessão autenticada ou prova criptográfica)
  const isHardViolation =
    reasons.includes('scanner-pentest-detectado') ||
    reasons.includes('sondagem-rota-proibida') ||
    reasons.includes('payload-exploracao-detectado') ||
    reasons.includes('headless-ou-webdriver') ||
    reasons.includes('user-agent-automacao');

  if (!isHardViolation) {
    if (signals.isAuthenticated) {
      riskScore = Math.max(0, riskScore - 25);
    }
    if (signals.hasValidProof) {
      riskScore = Math.max(0, riskScore - 25);
    }
    if (signals.hasHumanCookie) {
      riskScore = Math.max(0, riskScore - 20);
    }
  }

  let action: GuardAction = 'allow';
  let retryAfterSec = 0;

  if (riskScore >= 80) {
    action = 'block';
    state.strikes += 1;
    const baseCooldown = isHardViolation ? 120_000 : 30_000;
    const cooldownMs = Math.min(
      15 * 60_000,
      baseCooldown * Math.pow(2, Math.min(4, state.strikes - 1))
    );
    state.blockedUntilMs = nowMs + cooldownMs;
    retryAfterSec = Math.ceil(cooldownMs / 1000);
  } else if (riskScore >= 55) {
    action = 'challenge';
    retryAfterSec = 10;
  } else if (riskScore >= 35) {
    action = 'throttle';
    retryAfterSec = 3;
  }

  buckets.set(key, state);

  return {
    allowed: action === 'allow',
    action,
    riskScore,
    reasons,
    retryAfterSec,
  };
}
