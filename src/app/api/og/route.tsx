import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const title = (searchParams.get('title') || 'HiperVerso · HiperVerso').slice(0, 90);
  const description = (
    searchParams.get('description') ||
    'Rede social brasileira soberana, federação aberta e mensageria P2P.'
  ).slice(0, 170);
  const badge = (searchParams.get('badge') || 'REDE SOBERANA BRASILEIRA').slice(0, 36);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 64px',
          background: 'linear-gradient(135deg, #0b0b0f 0%, #1b0a0e 55%, #3a0d16 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 20px',
              borderRadius: '999px',
              background: 'rgba(239, 68, 68, 0.16)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: '#fca5a5',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '0.06em',
            }}
          >
            {badge}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              fontWeight: 700,
              color: '#f87171',
            }}
          >
            EXE. LULA · HIPERVERSO
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '980px' }}>
          <div
            style={{
              fontSize: 54,
              fontWeight: 800,
              lineHeight: 1.12,
              color: '#ffffff',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 27,
              lineHeight: 1.4,
              color: '#d4d4d8',
            }}
          >
            {description}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            paddingTop: '24px',
            fontSize: 21,
            color: '#a1a1aa',
          }}
        >
          <div>hiperverso.app · hiperverso.social</div>
          <div style={{ color: '#fca5a5', fontWeight: 600 }}>Zero Bots · Sem Big Tech</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}

