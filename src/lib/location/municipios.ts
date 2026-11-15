// src/lib/location/municipios.ts
// Busca de municípios do Brasil (IBGE) para a localização do post. A lista fica em src/data/municipios-ibge.json (gerada por
// scripts/gerar-municipios.mjs) e só é carregada quando alguém procura.

export type Municipality = { id: number; name: string; state: string };
type Row = [number, string, string];
type Indexed = Municipality & { key: string };

let cache: Promise<Indexed[]> | null = null;

/** Sem acento e em minúsculas: "São Paulo" e "sao paulo" são a mesma busca. */
export const normalizeSearch = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const load = (): Promise<Indexed[]> => {
  if (!cache) {
    cache = import('@/data/municipios-ibge.json').then((module) => {
      const rows = (module.default ?? module) as Row[];
      return rows.map(([id, name, state]) => ({ id, name, state, key: normalizeSearch(name) }));
    });
  }
  return cache;
};

/**
 * Procura por nome (começo da palavra primeiro, depois em qualquer parte) e, se o texto terminar com a sigla de um estado
 * ("campinas sp"), só naquele estado. Sem texto, devolve as capitais mais conhecidas para a pessoa ver como funciona.
 */
export async function searchMunicipalities(query: string, limit = 40): Promise<Municipality[]> {
  const all = await load();
  const text = normalizeSearch(query);
  if (!text) {
    const featured = ['sao paulo|SP', 'rio de janeiro|RJ', 'brasilia|DF', 'salvador|BA', 'fortaleza|CE', 'belo horizonte|MG', 'manaus|AM', 'curitiba|PR', 'recife|PE', 'porto alegre|RS'];
    return featured.map((entry) => all.find((m) => `${m.key}|${m.state}` === entry)).filter((m): m is Indexed => !!m).slice(0, limit).map(strip);
  }
  const parts = text.split(' ');
  const last = parts[parts.length - 1];
  const stateFilter = parts.length > 1 && last.length === 2 ? last.toUpperCase() : null;
  const name = stateFilter ? parts.slice(0, -1).join(' ') : text;
  const starts: Indexed[] = [];
  const contains: Indexed[] = [];
  for (const municipality of all) {
    if (stateFilter && municipality.state !== stateFilter) continue;
    if (municipality.key.startsWith(name)) starts.push(municipality);
    else if (municipality.key.includes(` ${name}`) || municipality.key.includes(name)) contains.push(municipality);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit).map(strip);
}

const strip = ({ id, name, state }: Indexed): Municipality => ({ id, name, state });
