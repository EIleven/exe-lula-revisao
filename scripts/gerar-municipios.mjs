// scripts/gerar-municipios.mjs
// Gera src/data/municipios-ibge.json: os municípios do Brasil (código do IBGE, nome e UF) para o seletor de localização do
// compositor de posts. A lista vem da API pública de localidades do IBGE (sem chave) e é GRAVADA no repositório: o app não
// consulta o IBGE em tempo de uso, nem a pessoa precisa dar acesso ao GPS (a localização do post é só a cidade que ela escolhe).
//
// Uso:  node scripts/gerar-municipios.mjs          (reescreve o arquivo; rode de novo se o IBGE criar municípios)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';

const resposta = await fetch(URL_IBGE, { headers: { accept: 'application/json' } });
if (!resposta.ok) throw new Error(`IBGE respondeu HTTP ${resposta.status}`);
const lista = await resposta.json();

// A UF fica em lugares diferentes conforme o município (alguns, criados depois, não têm microrregião).
const ufDe = (m) => m?.microrregiao?.mesorregiao?.UF?.sigla ?? m?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ?? null;

const municipios = lista
  .map((m) => [Number(m.id), String(m.nome), ufDe(m)])
  .filter(([id, nome, uf]) => Number.isInteger(id) && nome && uf);

if (municipios.length < 5500) throw new Error(`Só ${municipios.length} municípios válidos: o formato da API mudou?`);
if (municipios.length !== lista.length) console.warn(`Atenção: ${lista.length - municipios.length} municípios sem UF foram ignorados.`);

const ufs = [...new Set(municipios.map(([, , uf]) => uf))].sort();
if (ufs.length !== 27) throw new Error(`Esperava 27 UFs e vieram ${ufs.length}: ${ufs.join(',')}`);

municipios.sort((a, b) => a[1].localeCompare(b[1], 'pt-BR') || a[2].localeCompare(b[2]));
const destino = path.join(root, 'src', 'data', 'municipios-ibge.json');
fs.mkdirSync(path.dirname(destino), { recursive: true });
// Uma linha por município, para o diff do Git ficar legível quando o IBGE criar ou renomear algum.
fs.writeFileSync(destino, `[\n${municipios.map((m) => JSON.stringify(m)).join(',\n')}\n]\n`);
console.log(`${municipios.length} municípios em ${ufs.length} UFs gravados em ${path.relative(root, destino)}`);
