// src/lib/rtdbUrl.ts
// Qual é o endereço do Realtime Database do app. PURO (sem Firebase): o ambiente entra por parâmetro e e2e/device-login-check.mjs
// prova cada caso.
//
// Por que existe: o App Hosting entrega a configuração do Firebase com `databaseURL: ""` (texto vazio, não ausente). O SDK só
// deduz o endereço padrão a partir do `projectId` quando o valor é `undefined`; com "" ele tenta interpretar a string vazia e
// LANÇA ("Cannot parse Firebase url"), o que, dentro de um efeito do React, derruba a página inteira no cliente. E quem
// escrevia `process.env.X || app.options.databaseURL || ''` e depois "se tem URL, ouve o RTDB" simplesmente NUNCA ouvia em
// produção (a URL era sempre vazia) e caía no polling de 3 em 3 segundos.

const limpa = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const URL_VALIDA = /^https?:\/\/[^\s/]+/i;
const PROJETO_VALIDO = /^[a-z0-9][a-z0-9-]{3,60}$/;

export function resolveRtdbUrl(input: {
  envUrl?: unknown;
  optionsUrl?: unknown;
  envProjectId?: unknown;
  optionsProjectId?: unknown;
}): string | null {
  const configurada = limpa(input.envUrl) || limpa(input.optionsUrl);
  if (configurada && URL_VALIDA.test(configurada)) return configurada.replace(/\/+$/, '');
  const projectId = limpa(input.envProjectId) || limpa(input.optionsProjectId);
  return PROJETO_VALIDO.test(projectId) ? `https://${projectId}-default-rtdb.firebaseio.com` : null;
}
