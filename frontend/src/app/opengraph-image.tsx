import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const alt = 'GetCito';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function loadLogoDataUrl() {
  const filePath = path.join(process.cwd(), 'public', 'brand', 'icons', 'getcito-icon-512.png');
  const buffer = await readFile(filePath);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export default async function OpengraphImage() {
  const logoSrc = await loadLogoDataUrl();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at top right, #145e4b 0%, #003934 45%, #002723 100%)',
        position: 'relative',
      }}
    >
      {/* Soft glow accent */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          right: -200,
          width: 700,
          height: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(152, 236, 101, 0.25) 0%, rgba(152, 236, 101, 0) 70%)',
          display: 'flex',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        <img src={logoSrc} alt="" width={220} height={220} />
        <span style={{ color: '#fff', fontSize: 120, fontWeight: 700, letterSpacing: -5 }}>
          GetCito
        </span>
      </div>
    </div>,
    { ...size },
  );
}
