import { CapacitorConfig } from '@capacitor/cli';
import { siteConfig } from './src/config/site';

// O app abre EXCLUSIVAMENTE o domínio oficial (siteConfig.officialOrigin).
// Única exceção, só para desenvolvimento: CAP_DEV_URL (ex.: http://10.0.2.2:9002 no emulador Android).
// Ela só é aceita se apontar para a própria máquina ou rede local; qualquer outro valor é recusado
// para que um site de terceiros nunca seja embutido no WebView (que expõe a ponte nativa do Capacitor).
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function resolveServerUrl(): string {
  const devUrl = process.env.CAP_DEV_URL?.trim();
  if (!devUrl) return siteConfig.officialOrigin;
  const parsed = new URL(devUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOCAL_HOST.test(parsed.host)) {
    throw new Error(
      `CAP_DEV_URL recusada: "${devUrl}". Use apenas localhost, 10.0.2.2 ou um IP de rede local.`,
    );
  }
  return parsed.origin;
}

const serverUrl = resolveServerUrl();
const isDevServer = serverUrl !== siteConfig.officialOrigin;

const config: CapacitorConfig = {
  appId: 'app.hiperverso',
  appName: 'HiperVerso',
  webDir: 'out', // Diretório de build estático do Next.js
  // Fundo do WebView enquanto o site carrega: a cor da marca, a mesma da abertura e das barras (o padrão é branco).
  backgroundColor: '#0B0F14',
  server: {
    url: serverUrl,
    // Somente o host exato, sem curinga: subdomínios abandonados ou de terceiros não entram no WebView.
    allowNavigation: [new URL(serverUrl).host],
    // HTTP em claro só para o servidor de desenvolvimento local.
    cleartext: isDevServer && serverUrl.startsWith('http://'),
  },
  android: {
    // Não permitir conteúdo misto (HTTP em um app HTTPS)
    allowMixedContent: false,
  },
  plugins: {
    // Login com Google NATIVO no app (o popup não funciona em WebView). skipNativeAuth: o plugin só devolve o idToken e
    // quem entra no Firebase é o JavaScript do site (signInWithCredential em src/lib/services/googleSignIn.ts).
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
