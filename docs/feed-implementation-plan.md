**Título:** Plano de Implementação da Lógica de Feed

**Introdução:**
Este documento detalha o plano de implementação para a lógica de feed, baseado nas especificações fornecidas. O plano aborda a estrutura de dados, cache, atualizações em tempo real, performance e outros aspectos cruciais para criar uma experiência de usuário robusta e fluida.

---

### 1. Estrutura de Dados do Feed

A estrutura de dados para cada item do feed será baseada no tipo `Post` já existente em `src/lib/types.ts`. Este tipo já inclui a maioria dos campos necessários:

```typescript
// src/lib/types.ts
export interface Post {
  id: string;
  authorId: string;
  author: User; // Dados do autor
  content: string;
  createdAt: Timestamp | string | number; // `timestamp`
  media?: Media[]; // Metadados de mídia
  // O cursor será gerenciado pelo hook `useInfiniteFeed` e não precisa ser parte do objeto Post.
}
```

Manteremos o estado local de cada feed separadamente. O hook `useInfiniteFeed` já é reutilizável, o que nos permite instanciar feeds distintos para "Following", "Explore" e "Articles" simplesmente passando diferentes funções de fetch.

### 2. Estado Local e Store Reativo

Atualmente, o estado do feed é gerenciado localmente dentro do `useInfiniteFeed` com `useState`. Para centralizar o estado e facilitar o compartilhamento entre componentes, especialmente com a introdução do cache, propomos a criação de um `FeedContext`.

**Plano de Ação:**

1.  **Criar `src/contexts/FeedContext.tsx`**: Este contexto irá prover o estado dos feeds (`posts`, `isLoading`, `hasNewItems`, etc.) e as ações para interagir com eles (`loadMore`, `refresh`).
2.  **Estrutura do Contexto**: O estado será um objeto onde as chaves são os identificadores dos feeds (ex: `following`, `explore`).
    ```typescript
    interface FeedState {
      posts: Post[];
      isLoading: boolean;
      isLoadingMore: boolean;
      hasMore: boolean;
      hasNewItems: boolean;
      error: Error | null;
    }

    interface FeedsState {
      [feedId: string]: FeedState;
    }
    ```
3.  O `FeedProvider` irá encapsular a lógica que hoje está em `useInfiniteFeed`, mas permitindo que múltiplos feeds coexistam.

### 3. Cache e Persistência com IndexedDB

Esta é uma adição crucial para a performance e experiência offline. Usaremos a biblioteca `Dexie.js` para simplificar a interação com o IndexedDB.

**Plano de Ação:**

1.  **Adicionar Dexie**: `npm install dexie`
2.  **Criar um serviço de cache `src/lib/services/cacheService.ts`**:
    *   Definir o schema do banco de dados: uma tabela (object store) para os posts, indexada por `id` e `feedId`.
    *   Criar métodos para:
        *   `getFeedFromCache(feedId)`: Carrega posts de um feed específico.
        *   `saveFeedToCache(feedId, posts)`: Salva/atualiza posts no cache.
        *   `getLastTimestamp(feedId)`: Pega o `createdAt` do post mais recente no cache.
        *   `clearFeedCache(feedId)`: Limpa o cache de um feed.

3.  **Modificar `useInfiniteFeed.ts` (ou a nova lógica no `FeedContext`)**:
    *   **Ao carregar**:
        1.  Primeiro, chamar `getFeedFromCache` para popular o feed imediatamente. Isso melhora o "Time to First Render".
        2.  Marcar o feed como "não obsoleto" ( `isStale = false`).
        3.  Em segundo plano, disparar o fetch de rede.
    *   **Fetch incremental**:
        1.  O fetch de rede usará o `getLastTimestamp` do cache para buscar apenas posts mais novos (`since_time > último_timestamp`).
        2.  O backend precisa suportar essa query (ex: `...where('createdAt', '>', lastTimestamp)` no Firestore).
        3.  Após o fetch, mesclar os novos dados com os existentes (evitando duplicatas) e atualizar o estado.
    *   **Persistência**:
        1.  Após cada fetch de rede bem-sucedido, chamar `saveFeedToCache` para persistir os novos itens.

**Exemplo de fluxo em `useInfiniteFeed`**:

```typescript
// Dentro do hook...
useEffect(() => {
  const loadInitial = async () => {
    // 1. Carregar do cache
    const cachedPosts = await cacheService.getFeedFromCache(options.feedId);
    if (cachedPosts.length > 0) {
      setPosts(cachedPosts);
    }

    // 2. Fetch em background
    setIsLoading(true);
    try {
      const lastTimestamp = await cacheService.getLastTimestamp(options.feedId);
      // A função de fetch precisa suportar um parâmetro 'since'
      const result = await fetchPostsFunction(/*... Trazendo apenas novos ...*/);
      
      // 3. Mesclar e salvar no cache
      const updatedPosts = mergePosts(cachedPosts, result.posts);
      setPosts(updatedPosts);
      await cacheService.saveFeedToCache(options.feedId, updatedPosts);
    } finally {
      setIsLoading(false);
    }
  };
  loadInitial();
}, [options.feedId]);
```

### 4. Paginação Infinita

A base já existe em `useInfiniteFeed` com `loadMorePosts`. O gatilho de scroll (80%) deve ser implementado no componente de UI que renderiza a lista.

**Plano de Ação:**

1.  No componente de feed (ex: `FeedList.tsx`), usar um `IntersectionObserver` ou um listener de scroll para detectar quando o final da lista está próximo.
2.  Ao atingir o limiar, chamar a função `loadMorePosts` retornada pelo hook. O estado `isLoadingMore` já previne chamadas duplicadas.

### 5. Atualizações em Tempo Real vs. Polls

Usaremos os listeners em tempo real do Firestore, que são mais eficientes que WebSockets manuais ou polling para o nosso backend.

**Plano de Ação:**

1.  **Criar `src/lib/services/postRealtimeService.ts`**:
    *   Este serviço irá configurar um listener `onSnapshot` do Firestore.
    *   A query do listener observará novos posts (`where('createdAt', '>', newestPostTimestampRef.current)`).
    *   Quando novos documentos são recebidos, o serviço emitirá um evento ou chamará um callback.

2.  **Integrar com o `FeedContext` / `useInfiniteFeed`**:
    *   O hook irá se inscrever neste serviço.
    *   Ao receber o evento `new_post`:
        *   Adicionar o(s) novo(s) post(s) ao topo do array `posts`.
        *   Definir o estado `hasNewItems = true`.

3.  **Fallback para Polling**:
    *   Se a conexão em tempo real falhar (o SDK do Firestore pode informar isso) ou para ambientes onde não é suportada, podemos implementar um poll.
    *   Usar `useEffect` com `setInterval` para chamar a função de fetch incremental periodicamente (ex: a cada 30 segundos).
    *   O polling só deve ser ativado se a aba do navegador estiver ativa (`document.visibilityState === 'visible'`).

### 6. Estados de UI

Vamos adicionar os estados necessários ao hook/contexto para controlar a UI.

*   `isRefreshing`: Ativado pela ação de "pull-to-refresh". A função de refresh deve chamar `loadItemsInternal(true)`, que já limpa o feed e busca do zero, e também deve limpar o cache correspondente com `cacheService.clearFeedCache(feedId)`.
*   `hasNewItems`: Um booleano. É definido como `true` pelo listener em tempo real. A UI exibirá um botão "Ver novos posts". Ao clicar, os posts são exibidos e o estado volta para `false`. Ele também volta para `false` se o usuário rolar para o topo.
*   `isOffline`: Usar `navigator.onLine` e os eventos `online`/`offline` do `window` para detectar o estado da rede. Quando offline, desabilitar fetches e exibir um indicador na UI. O SDK do Firestore já tem um cache offline robusto, então a leitura dos dados cacheados continuará funcionando.

### 7. Sincronização e Consistência

O SDK do Firestore cuida da maior parte da sincronização.

*   **Cache do Firestore**: O SDK já usa um cache offline e sincroniza eficientemente com o backend, evitando downloads desnecessários. Não precisamos gerenciar ETags manualmente.
*   **Reconciliação**: O listener `onSnapshot` informa sobre alterações em documentos (`added`, `modified`, `removed`). Nossa lógica de state update deve tratar esses casos:
    *   `added`: Adicionar novo post.
    *   `modified`: Encontrar e substituir o post no estado local.
    *   `removed`: Filtrar e remover o post do estado local.
*   **Versão de Schema**: No nosso `cacheService`, podemos armazenar uma versão do schema no IndexedDB. Ao iniciar o app, comparamos a versão. Se for diferente, executamos uma migração ou simplesmente limpamos o cache para evitar inconsistências.

### 8. Personalização e Custom Feeds

A arquitetura proposta com `FeedContext` e `cacheService` já suporta isso.

*   Cada feed customizado ("Following", "Explore", ou `tag/react`) será identificado por um `feedId`.
*   O `FeedContext` armazenará o estado de cada feed em `state[feedId]`.
*   O `cacheService` usará o `feedId` para particionar os dados no IndexedDB.
*   Trocar de feed na UI significará simplesmente pedir dados para um `feedId` diferente ao nosso sistema de feed.

### 9. Performance e Otimizações

*   **Debounce**: Aplicar debounce na chamada de `loadMorePosts` no evento de scroll para evitar disparos excessivos. O hook `use-debounce` já existe no projeto.
*   **LRU Cache para Mídia**: Para imagens, podemos implementar um cache LRU simples em memória para os URLs ou usar o cache do navegador, configurando cabeçalhos `Cache-Control` adequados nos nossos assets de mídia no Firebase Storage.
*   **Batch de Atualizações**: O listener `onSnapshot` do Firestore já pode entregar múltiplas alterações de uma vez (`docChanges()`). Podemos iterar sobre elas e disparar uma única atualização de estado no React, que já faz o batch por padrão.

### 10. Logs e Métricas

Instrumentar os pontos chave para monitorar a saúde do sistema.

*   **Eventos de Fetch**: No `useInfiniteFeed`, dentro dos blocos `try`/`catch`/`finally`, podemos logar:
    *   Início do fetch (`feed_fetch_start`).
    *   Sucesso (`feed_fetch_success`, com `duration`, `item_count`).
    *   Erro (`feed_fetch_error`, com detalhes do erro).
*   **Métricas de Performance**:
    *   **Time to First Render (TTFR)**: Medir o tempo desde o início do carregamento do componente até a renderização dos primeiros itens (vindos do cache).
    *   **Time to Ready (TTR)**: Medir o tempo até que o fetch de background termine e o feed esteja totalmente atualizado.

### 11. Fallbacks e Recovery

*   **Retry Exponencial**: Em caso de erro de rede no `fetchPostsFunction`, implementar um mecanismo de retry.
    ```typescript
    async function fetchWithRetry(fn, retries = 3, delay = 1000) {
      try {
        return await fn();
      } catch (error) {
        if (retries > 0) {
          await new Promise(res => setTimeout(res, delay));
          return fetchWithRetry(fn, retries - 1, delay * 2); // Backoff exponencial
        }
        throw error;
      }
    }
    ```
*   **Cache Corrompido**: Ao interagir com o `cacheService` (Dexie), envolver as chamadas em `try...catch`. Se um erro persistente for detectado (ex: falha ao abrir o DB), podemos acionar uma função para limpar o cache (`db.delete()`) e forçar um recarregamento completo da rede.
