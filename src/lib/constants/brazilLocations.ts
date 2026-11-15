export interface PinnedExploreTopic {
  id: string;
  label: string;
  query: string;
}

export interface ExplorePreferences {
  useLocalLocation: boolean;
  stateCode: string; // 'BR' for Todo o Brasil, or UF like 'MG', 'SP', 'BA', 'MA', 'ES'...
  city: string;
  communityType: string;
  communityName: string;
  pinnedTopics?: PinnedExploreTopic[];
  hiddenCommunityIds?: string[];
}

export const DEFAULT_EXPLORE_PREFERENCES: ExplorePreferences = {
  useLocalLocation: true,
  stateCode: 'BR',
  city: '',
  communityType: 'all',
  communityName: '',
  pinnedTopics: [],
  hiddenCommunityIds: [],
};

export const BRAZIL_STATES: { code: string; name: string }[] = [
  { code: 'BR', name: 'Todo o Brasil' },
  { code: 'AC', name: 'Acre (AC)' },
  { code: 'AL', name: 'Alagoas (AL)' },
  { code: 'AP', name: 'Amapá (AP)' },
  { code: 'AM', name: 'Amazonas (AM)' },
  { code: 'BA', name: 'Bahia (BA)' },
  { code: 'CE', name: 'Ceará (CE)' },
  { code: 'DF', name: 'Distrito Federal (DF)' },
  { code: 'ES', name: 'Espírito Santo (ES)' },
  { code: 'GO', name: 'Goiás (GO)' },
  { code: 'MA', name: 'Maranhão (MA)' },
  { code: 'MT', name: 'Mato Grosso (MT)' },
  { code: 'MS', name: 'Mato Grosso do Sul (MS)' },
  { code: 'MG', name: 'Minas Gerais (MG)' },
  { code: 'PA', name: 'Pará (PA)' },
  { code: 'PB', name: 'Paraíba (PB)' },
  { code: 'PR', name: 'Paraná (PR)' },
  { code: 'PE', name: 'Pernambuco (PE)' },
  { code: 'PI', name: 'Piauí (PI)' },
  { code: 'RJ', name: 'Rio de Janeiro (RJ)' },
  { code: 'RN', name: 'Rio Grande do Norte (RN)' },
  { code: 'RS', name: 'Rio Grande do Sul (RS)' },
  { code: 'RO', name: 'Rondônia (RO)' },
  { code: 'RR', name: 'Roraima (RR)' },
  { code: 'SC', name: 'Santa Catarina (SC)' },
  { code: 'SP', name: 'São Paulo (SP)' },
  { code: 'SE', name: 'Sergipe (SE)' },
  { code: 'TO', name: 'Tocantins (TO)' },
];

export const BRAZIL_COMMUNITY_TYPES: { id: string; label: string; keywords: string[] }[] = [
  { id: 'all', label: 'Todas as comunidades', keywords: [] },
  { id: 'mst', label: 'MST / Assentamento Rural', keywords: ['mst', 'sem terra', 'assentamento', 'reforma agrária', 'reforma agraria'] },
  { id: 'mtst', label: 'MTST / Ocupação Urbana', keywords: ['mtst', 'sem-teto', 'sem teto', 'ocupação', 'ocupacao', 'moradia'] },
  { id: 'quilombo', label: 'Quilombo / Comunidade Quilombola', keywords: ['quilombo', 'quilombola'] },
  { id: 'indigena', label: 'Aldeia / Povo Indígena', keywords: ['indígena', 'indigena', 'aldeia', 'tribo', 'demarcação', 'demarcacao'] },
  { id: 'periferia', label: 'Periferia / Favela / Comunidade', keywords: ['periferia', 'favela', 'comunidade', 'quebrada'] },
  { id: 'agricultura', label: 'Agricultura Familiar / Cooperativa', keywords: ['agricultura familiar', 'cooperativa', 'agroecologia', 'sindicato'] },
  { id: 'outro', label: 'Outro território / comunidade', keywords: [] },
];

export function formatExploreLocationLabel(prefs: ExplorePreferences): string {
  if (!prefs.useLocalLocation) return 'Brasil';
  const parts: string[] = [];
  if (prefs.communityName.trim()) {
    parts.push(prefs.communityName.trim());
  } else if (prefs.communityType !== 'all') {
    const found = BRAZIL_COMMUNITY_TYPES.find((c) => c.id === prefs.communityType);
    if (found) parts.push(found.label.split(' / ')[0]);
  }
  if (prefs.city.trim()) {
    parts.push(prefs.city.trim());
  }
  if (prefs.stateCode && prefs.stateCode !== 'BR') {
    const st = BRAZIL_STATES.find((s) => s.code === prefs.stateCode);
    parts.push(st ? st.name.replace(/\s*\([A-Z]{2}\)$/, '') : prefs.stateCode);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Brasil';
}

