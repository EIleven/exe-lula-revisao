// src/app/api/extract-article/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { JSDOM, VirtualConsole } from 'jsdom';
import { assertSafeUrl, safeFetchText, UnsafeUrlError } from '@/lib/security/safe-fetch';
import { takeRateLimit, verifyRequestUser } from '@/lib/server/requestAuth';

const EXTRACTIONS_PER_WINDOW = 20;
const EXTRACTION_WINDOW_MS = 10 * 60 * 1000;

// Function to clean up the article content for FINAL output
const cleanArticleContent = (element: Element): string => {
    // Clone the element to avoid modifying the original during iteration
    const content = element.cloneNode(true) as Element;
    
    // Remove unwanted tags like scripts, styles, navigation, forms, etc.
    const unwantedTags = ['script', 'style', 'nav', 'footer', 'aside', 'form', 'button', 'iframe', 'header'];
    unwantedTags.forEach(tag => {
        content.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Remove elements that are likely ads, social sharing, comments, subscription boxes, etc.
    const unwantedSelectors = [
        '.outpost-pub-container', // Specific to 404media.co
        '.kg-bookmark-card', // Specific related content card
        '[class*="bookmark"]',
        '[class*="ad"]', '[id*="ad"]',
        '[class*="social"]', '[id*="social"]',
        '[class*="comment"]', '[id*="comment"]',
        '[class*="subscribe"]', '[id*="subscribe"]',
        '[class*="related"]', '[id*="related"]',
        '[class*="popup"]', '[id*="popup"]',
        '[class*="share"]', '[id*="share"]',
        '[class*="sidebar"]',
        '[class*="meta"]', 
        '[class*="author-box"]',
        '[id*="author"]',
        '[class*="newsletter"]',
        '[class*="pagination"]',
        '[class*="nav"]',
        '[class*="next-prev"]', 
        'footer',
    ];
    unwantedSelectors.forEach(selector => {
         content.querySelectorAll(selector).forEach(el => el.remove());
    });

    return content.innerHTML;
};


export async function POST(request: NextRequest) {
  try {
    // Só quem está logado, e com limite de ritmo: antes qualquer pessoa, sem conta, usava o servidor para buscar
    // páginas da internet.
    const uid = await verifyRequestUser(request);
    if (!uid) {
      return NextResponse.json({ message: 'Entre na sua conta para extrair artigos.' }, { status: 401 });
    }
    if (!takeRateLimit(`extract:${uid}`, EXTRACTIONS_PER_WINDOW, EXTRACTION_WINDOW_MS)) {
      return NextResponse.json({ message: 'Muitas extrações em pouco tempo. Tente de novo em alguns minutos.' }, { status: 429 });
    }

    const { url } = await request.json();

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return NextResponse.json({ message: 'A valid URL is required.' }, { status: 400 });
    }

    let hostname: string;
    try {
      hostname = assertSafeUrl(url).hostname;
    } catch (error) {
      if (error instanceof UnsafeUrlError) return NextResponse.json({ message: 'Esta URL não é permitida.' }, { status: 400 });
      return NextResponse.json({ message: 'A valid URL is required.' }, { status: 400 });
    }

    // A busca passa por safeFetchText: recusa endereços internos (SSRF), segue redirecionamentos conferindo cada
    // salto e limita tempo, tamanho e tipo de conteúdo. Veja src/lib/security/safe-fetch.ts.
    let response;
    try {
      response = await safeFetchText(url, {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
      });
    } catch (error) {
      if (error instanceof UnsafeUrlError) return NextResponse.json({ message: 'Esta URL não é permitida.' }, { status: 400 });
      throw error;
    }

    if (!response.ok) {
      if (response.status === 403) {
        return NextResponse.json({ message: `Não foi possível extrair o conteúdo. O site (${hostname}) está bloqueando o acesso automatizado.` }, { status: 403 });
      }
      return NextResponse.json({ message: `Falha ao buscar a URL. O servidor respondeu com o status: ${response.status}` }, { status: response.status });
    }

    const html = response.text;
    // Console silencioso: o jsdom despeja no log do servidor cada folha de estilo que não consegue interpretar.
    const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
    const document = dom.window.document;

    // 1. Extract the title
    const title = document.querySelector('title')?.textContent || 
                  document.querySelector('h1')?.textContent || 
                  document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                  'Title not found';

    // 2. Extract the main image (prioritize og:image)
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    let mainImageUrl = ogImage || null;
    
    if (!mainImageUrl) {
        const firstImg = document.querySelector('article img, main img');
        if (firstImg) {
            mainImageUrl = firstImg.getAttribute('src');
            if (mainImageUrl && !mainImageUrl.startsWith('http')) {
                mainImageUrl = new URL(mainImageUrl, url).href;
            }
        }
    }

    // 3. IMPROVED: Extract main content by scoring candidates
    const selectors = [
      'article',
      '.post',
      '.entry',
      '.post__content', // Specific selector for 404media.co
      'div.post-content', 
      '[class*="post-body"]', 
      '[role="article"]',
      '[itemprop*="articleBody"]',
      '[class*="article-body"]',
      '[class*="story-body"]',
      '[data-component-name*="article-body"]',
      '[class*="entry-content"]',
      '[class*="main-content"]',
      'main',
    ];
    
    let bestCandidate: Element | null = null;
    let maxScore = 0;

    // Self-contained scoring function that cleans the element before scoring.
    const calculateScore = (el: Element) => {
        const elClone = el.cloneNode(true) as Element;

        // Perform a pre-cleaning step on the clone before scoring
        const unwantedSelectors = [
            '.outpost-pub-container', '.kg-bookmark-card', 'script', 'style', 'noscript', 'iframe', 'button', 'form', 'footer', 'nav', 'header',
            '[class*="ad-"]', '[id*="ad-"]', '[class*="social"]', '[id*="social"]', '[class*="comment"]', '[id*="comment"]',
            '[class*="subscribe"]', '[id*="subscribe"]', '[class*="related"]', '[id*="related"]', '[class*="popup"]',
            '[id*="popup"]', '[class*="share"]', '[id*="share"]', '[class*="sidebar"]', '[class*="pagination"]',
            '[class*="nav"]', '[class*="next-prev"]',
        ];
        unwantedSelectors.forEach(selector => {
            elClone.querySelectorAll(selector).forEach(e => e.remove());
        });

        const text = elClone.textContent || '';
        const textLength = text.trim().length;
        const pCount = elClone.querySelectorAll('p').length;
        
        if (pCount < 1 && textLength < 100) {
            return 0;
        }
        
        const linkCount = elClone.querySelectorAll('a').length;
        const linkDensity = linkCount / (textLength || 1);
        
        if (linkDensity > 0.15) { // Slightly more lenient
            return 0;
        }

        let score = textLength + (pCount * 100);

        if (/\b(comment|share|social|related|popup|nav|footer|sidebar|ad-|widget|menu)\b/i.test(el.className || '')) {
            score *= 0.2;
        }
        
        if (el.tagName === 'ARTICLE') {
            score *= 1.8;
        }
        if (el.getAttribute('role') === 'article' || el.classList.contains('post') || el.classList.contains('entry')) {
            score *= 1.5;
        }

        return score;
    };

    // First pass: check specific, high-quality selectors
    document.querySelectorAll(selectors.join(', ')).forEach(candidate => {
        const score = calculateScore(candidate);
        if (score > maxScore) {
            maxScore = score;
            bestCandidate = candidate;
        }
    });

    // Fallback pass: If score from specific selectors is still low, check all divs.
    if (maxScore < 500) { 
        document.querySelectorAll('div').forEach(candidate => {
            if (candidate.parentElement?.tagName === 'BODY' || candidate.id === 'root' || candidate.id === '__next') {
                return; 
            }
            const score = calculateScore(candidate);
            if (score > maxScore) {
                maxScore = score;
                bestCandidate = candidate;
            }
        });
    }

    const textContent = bestCandidate ? cleanArticleContent(bestCandidate) : 'Content not found.';
    
    // 4. Extract the source hostname
    const source = new URL(url).hostname;

    return NextResponse.json({
      title,
      textContent,
      mainImageUrl,
      source,
    });

  } catch (error: any) {
    console.error('Article extraction error:', error);
    // Sem detalhes internos na resposta (a mensagem do erro pode expor caminhos e endereços do servidor).
    return NextResponse.json({ message: 'Ocorreu um erro ao extrair o artigo.' }, { status: 500 });
  }
}
