import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatPairCode, pairUrl } from '../../../shared/pairing.ts';

/** A QR code for `text`, as SVG markup ('' until it's made). */
export function useQrSvg(text: string, color = '#1b1916'): string {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: color, light: '#00000000' } })
      .then(markup => live && setSvg(markup))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [text, color]);
  return svg;
}

/**
 * "Connect your phone" on the wall. With a sign-in code, scanning it also signs the
 * phone in, and the code is shown for typing in (in a Home Screen app, say).
 */
export function ConnectCard({ url, code = null }: { url: string; code?: string | null }) {
  const svg = useQrSvg(code ? pairUrl(url, code) : url);
  return (
    <section className="wall-connect">
      <div className="wall-connect-qr" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="wall-connect-text">
        <h3>Connect your phone</h3>
        <p>Point your iPhone camera at the code, or open</p>
        <p className="wall-connect-url">{url.replace(/^https?:\/\//, '')}</p>
        {code && (
          <p className="wall-connect-code">
            Code <strong>{formatPairCode(code)}</strong>
          </p>
        )}
      </div>
    </section>
  );
}
