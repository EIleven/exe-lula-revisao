#!/usr/bin/env node
// Gera uma chave privada ES256 para o OAuth do Bluesky. A saída deve ir DIRETO para o Secret Manager; nunca salve-a
// no repositório ou em um arquivo de ambiente versionado.
import { JoseKey } from '@atproto/oauth-client-node';

const key = await JoseKey.generate(['ES256'], 'social-1');
process.stdout.write(JSON.stringify(key.privateJwk));
