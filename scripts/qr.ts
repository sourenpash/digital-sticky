// Prints a QR code in the terminal, for scanning a link with a phone:
//   node scripts/qr.ts https://login.tailscale.com/a/…
import QRCode from 'qrcode';

const text = process.argv[2];
if (!text) {
  console.error('Usage: node scripts/qr.ts TEXT');
  process.exit(2);
}
process.stdout.write(await QRCode.toString(text, { type: 'terminal', small: true }));
