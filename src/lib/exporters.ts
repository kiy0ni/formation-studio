import { uid } from './id';
import { IS_ANDROID_APP } from './platform';
import type { Choreo, Vec } from './types';

export async function download(name: string, blob: Blob) {
  if (IS_ANDROID_APP) {
    const { saveAndShare } = await import('./nativeFiles');
    return saveAndShare(name, blob);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safe = (s: string) => s.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-') || 'choregraphie';

export function exportJson(doc: Choreo) {
  const { collab: _c, ...rest } = doc;
  const payload = { format: 'formation-studio', version: 1, choreo: rest };
  download(`${safe(doc.name)}.formation.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
}

export async function importJson(file: File): Promise<Choreo> {
  const data = JSON.parse(await file.text());
  const doc: Choreo = data?.format === 'formation-studio' ? data.choreo : data;
  if (!doc || typeof doc !== 'object' || !doc.dancers || !doc.formations || !doc.stage) throw new Error('Fichier non reconnu');
  const now = Date.now();
  return { ...doc, id: uid(), createdAt: now, updatedAt: now, collab: null, folderId: null };
}

/** Rasterizes an on-screen SVG to PNG. */
export async function exportSvgAsPng(svg: SVGSVGElement, name: string, scale = 2) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  // inline the CSS variables used by stage classes
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(sheet.cssRules)) if (r.cssText.includes('.stage-') || r.cssText.includes('.dancer')) rules.push(r.cssText);
    } catch {
      /* cross-origin sheet */
    }
  }
  const vars = ['--bg', '--surface', '--text', '--muted', '--accent', '--line', '--border'].map((v) => `${v}:${cs.getPropertyValue(v)}`).join(';');
  style.textContent = `svg{${vars};font-family:system-ui,sans-serif} ${rules.join('\n')}`;
  clone.insertBefore(style, clone.firstChild);
  clone.setAttribute('width', String(box.width * scale));
  clone.setAttribute('height', String(box.height * scale));
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = box.width * scale;
  canvas.height = box.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = cs.getPropertyValue('--bg') || '#0f0d17';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((b) => b && download(`${safe(name)}.png`, b), 'image/png');
}

/** K-pop style stage reading: "2 D · 1.5 devant". */
export function describePos(p: Vec): string {
  const fmt = (v: number) => (Math.round(Math.abs(v) * 10) / 10).toString().replace('.', ',');
  const x = Math.abs(p.x) < 0.05 ? 'Centre' : `${fmt(p.x)} ${p.x < 0 ? 'G' : 'D'}`;
  const y = Math.abs(p.y) < 0.05 ? 'milieu' : `${fmt(p.y)} ${p.y > 0 ? 'devant' : 'fond'}`;
  return `${x} · ${y}`;
}
