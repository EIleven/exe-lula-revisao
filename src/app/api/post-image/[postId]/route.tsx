// src/app/api/post-image/[postId]/route.tsx
// Imagem do post no visual do Exe. Lula, para a prévia do link nas outras redes (X, Bluesky, WhatsApp, Telegram...) e
// para compartilhar no Instagram (feed e story). Gerada no servidor, sem login: por isso só monta a imagem de post
// PÚBLICO — post só para seguidores devolve a imagem genérica da marca, senão o conteúdo restrito vazaria para
// qualquer pessoa com o endereço.
//
//   /api/post-image/<id>              1200x630  (prévia de link)
//   /api/post-image/<id>?formato=quadrado   1080x1080 (feed do Instagram)
//   /api/post-image/<id>?formato=story      1080x1920 (story e reels)
import { ImageResponse } from 'next/og';
import { getPostById } from '@/lib/services/postReadService';
import { siteConfig } from '@/config/site';
import { htmlToPlainText } from '@/lib/security/sanitizeHtml';

export const runtime = 'nodejs';
export const revalidate = 300; // a prévia não precisa ser recriada a cada acesso

const FUNDO = '#0B0F14';
const VERMELHO = '#E3202F';
const FORMATOS = {
  og: { largura: 1200, altura: 630 },
  quadrado: { largura: 1080, altura: 1080 },
  story: { largura: 1080, altura: 1920 },
} as const;
type Formato = keyof typeof FORMATOS;

const limitar = (texto: string, maximo: number) =>
  texto.length > maximo ? `${texto.slice(0, maximo - 1).trimEnd()}…` : texto;

export async function GET(request: Request, { params }: { params: { postId: string } }) {
  const url = new URL(request.url);
  const pedido = url.searchParams.get('formato');
  const formato: Formato = pedido === 'quadrado' || pedido === 'story' ? pedido : 'og';
  const { largura, altura } = FORMATOS[formato];
  const alto = formato === 'story';

  // Sem login: só post público. Qualquer falha cai na imagem da marca.
  const post = await getPostById(params.postId, null).catch(() => undefined);
  if (!post || post.isDeleted) {
    return Response.redirect(`${url.origin}/exe-lula-og.png`, 307);
  }

  const autor = post.user;
  const nome = autor?.name ?? 'Exe. Lula';
  const arroba = autor?.username ? `@${autor.username}` : '';
  const avatar = autor?.avatarUrl && /^https?:\/\//.test(autor.avatarUrl) ? autor.avatarUrl : null;
  const ehArtigo = post.category === 'news' && !!post.headline;
  const titulo = ehArtigo ? limitar(post.headline ?? '', 140) : '';
  const corpo = limitar(htmlToPlainText(post.text ?? '').replace(/\s+/g, ' ').trim(), alto ? 420 : 280);
  const imagem = post.media?.find((m) => m.type === 'image')?.url ?? null;
  // Do PRÓPRIO servidor que está respondendo (e não do endereço oficial): assim a imagem também sai certa em teste.
  const marca = `${url.origin}/brand/lula.png`;

  // As medidas são pensadas em 1200 de largura; no formato alto (story) tudo cresce para preencher a tela.
  const escala = largura / 1200;
  const px = (valor: number) => Math.round(valor * escala);
  const F = alto
    ? { nome: 52, arroba: 40, titulo: 78, corpo: ehArtigo ? 46 : 60, avatar: 120, pad: 60, gap: 34, cartao: 40 }
    : { nome: 42, arroba: 32, titulo: 56, corpo: ehArtigo ? 34 : 44, avatar: 96, pad: 48, gap: 28, cartao: 36 };

  return new ImageResponse(
    (
      <div
        style={{
          width: largura,
          height: altura,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: px(40),
          background: FUNDO,
          backgroundImage: `radial-gradient(${Math.round(largura * 0.9)}px ${Math.round(largura * 0.9)}px at 50% 38%, #5a0912 0%, rgba(26,10,16,0) 72%)`,
          padding: px(56),
          fontFamily: 'sans-serif',
          color: '#fff',
        }}
      >
        {/* Cartão do post, como ele aparece no Exe. Lula */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: px(F.gap),
            background: 'rgba(18,22,28,0.82)',
            border: `${Math.max(1, px(2))}px solid rgba(255,255,255,0.10)`,
            borderRadius: px(F.cartao),
            padding: px(F.pad),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: px(24) }}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} width={px(F.avatar)} height={px(F.avatar)} style={{ borderRadius: px(F.avatar), objectFit: 'cover' }} alt="" />
            ) : (
              <div style={{ width: px(F.avatar), height: px(F.avatar), borderRadius: px(F.avatar), background: '#2a2f38', display: 'flex' }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: px(F.nome), fontWeight: 700 }}>{limitar(nome, 28)}</div>
              <div style={{ fontSize: px(F.arroba), color: '#9aa4b2' }}>{arroba}</div>
            </div>
          </div>

          {ehArtigo && <div style={{ fontSize: px(F.titulo), fontWeight: 800, lineHeight: 1.15 }}>{titulo}</div>}
          {corpo && (
            <div style={{ fontSize: px(F.corpo), lineHeight: 1.35, color: ehArtigo ? '#c7cedb' : '#fff' }}>{corpo}</div>
          )}
          {imagem && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imagem}
              width={largura - px(208)}
              height={px(alto ? 560 : 240)}
              style={{ borderRadius: px(24), objectFit: 'cover' }}
              alt=""
            />
          )}
        </div>

        {/* Marca */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: px(8), paddingRight: px(8) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: px(18) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={marca} width={px(80)} height={px(80)} alt="" />
            <div style={{ display: 'flex', fontSize: px(44), fontWeight: 800, letterSpacing: px(1) }}>
              <span>EXE.&nbsp;</span>
              <span style={{ color: VERMELHO }}>LULA</span>
            </div>
          </div>
          <div style={{ fontSize: px(30), color: '#9aa4b2' }}>{siteConfig.baseUrl.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
    ),
    { width: largura, height: altura },
  );
}
