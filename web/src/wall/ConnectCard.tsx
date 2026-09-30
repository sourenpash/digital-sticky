import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function ConnectCard({ url }: { url: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let live = true;
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1b1916', light: '#00000000' } })
      .then(markup => live && setSvg(markup))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [url]);

  return (
    <section className="wall-connect">
      <div className="wall-connect-qr" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="wall-connect-text">
        <h3>Connect your phone</h3>
        <p>Point your iPhone camera at the code, or open</p>
        <p className="wall-connect-url">{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </section>
  );
}
