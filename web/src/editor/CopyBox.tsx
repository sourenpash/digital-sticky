import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { showToast } from '../store/toasts.ts';

// Text to copy, like a link or a command, with its Copy button.

/** Copies text, with a fallback for browsers that don't allow the clipboard API (plain http). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } else {
          showToast({ text: 'Couldn’t copy. Select the text and copy it yourself.' });
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Text to copy (a link, a command), with its Copy button beside the label so the text gets the full width. */
export function CopyBox({ label, text, multiline = false }: { label: string; text: string; multiline?: boolean }) {
  return (
    <div className="copy-box">
      <div className="copy-head">
        <span className="field-label">{label}</span>
        <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {multiline ? <pre className="copy-text is-block">{text}</pre> : <code className="copy-text">{text}</code>}
    </div>
  );
}
