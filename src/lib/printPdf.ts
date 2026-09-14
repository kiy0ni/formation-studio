import { describePos } from './exporters';
import { initials, textOn } from './geometry';
import { formatTime, sortedDancers, sortedFormations, timeline, totalDuration } from './model';
import { canvasesToPdf } from './pdf';
import type { Choreo } from './types';

/** A4 at 150 dpi. */
const W = 1240;
const H = 1754;
const M = 76;
const GAP = 28;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans JP", "Noto Sans", sans-serif';
const INK = '#15121f';
const MUTED = '#5b5670';
const FAINT = '#8a8599';
const LINE = '#e5e2ea';

/** Paper colors for the stage drawings (the screen version of the page is dark). */
const PAPER: Record<string, string> = {
  'p-floor': 'fill:#f6f4f9;stroke:#15121f;stroke-width:0.04',
  'p-grid': 'stroke:#dcd8e4;stroke-width:0.015',
  'p-center': 'stroke:#ff4d8d;stroke-width:0.03;stroke-dasharray:0.15 0.1',
  'p-num': 'fill:#5b5670;text-anchor:middle;font-weight:700;font-family:sans-serif',
  'p-path': 'fill:none;stroke-width:0.05;opacity:0.6;stroke-dasharray:0.12 0.08',
  'p-init': 'text-anchor:middle;font-weight:800;font-family:sans-serif',
};

interface StageImage {
  img: HTMLImageElement;
  ratio: number;
}

async function stageImage(svg: SVGSVGElement): Promise<StageImage> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const el of Array.from(clone.querySelectorAll('[class]'))) {
    const cls = el.getAttribute('class') ?? '';
    const key = cls.split(' ').find((c) => PAPER[c]);
    if (key) el.setAttribute('style', cls.includes('strong') ? 'fill:none;stroke-width:0.05;opacity:0.9' : PAPER[key]);
  }
  const vb = svg.viewBox.baseVal;
  const ratio = vb.height / vb.width;
  clone.setAttribute('width', '1200');
  clone.setAttribute('height', String(Math.round(1200 * ratio)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('stage image'));
      img.src = url;
    });
    return { img, ratio };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const setFont = (ctx: CanvasRenderingContext2D, size: number, weight = 400, style = 'normal') => {
  ctx.font = `${style} ${weight} ${size}px ${FONT}`;
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width <= maxWidth) {
        line = attempt;
        continue;
      }
      if (line) lines.push(line);
      // a single word wider than the column: cut it
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Pages {
  canvases: HTMLCanvasElement[] = [];
  ctx!: CanvasRenderingContext2D;
  y = M;

  constructor(private title: string) {
    this.newPage();
  }

  newPage() {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top';
    this.canvases.push(canvas);
    this.ctx = ctx;
    this.y = M;
    setFont(ctx, 18);
    ctx.fillStyle = FAINT;
    ctx.fillText(`Lineup · ${this.title}`.slice(0, 90), M, H - 48);
    ctx.textAlign = 'right';
    ctx.fillText(String(this.canvases.length), W - M, H - 48);
    ctx.textAlign = 'left';
  }

  /** Starts a new page when the next block does not fit. */
  fit(height: number) {
    if (this.y + height > H - M - 24 && this.y > M) this.newPage();
  }
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, label: string) {
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  setFont(ctx, Math.round(r * 0.8), 800);
  ctx.fillStyle = textOn(color);
  ctx.textAlign = 'center';
  ctx.fillText(label, x + r, y + r * 0.58);
  ctx.textAlign = 'left';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** PDF of the print sheet: formations (two per row), then one page per dancer. */
export async function choreographyPdf(doc: Choreo, stages: { formations: SVGSVGElement[]; routes: SVGSVGElement[] }, options: { sheets: boolean }): Promise<Blob> {
  const items = timeline(doc);
  const dancers = sortedDancers(doc);
  const formationImages = await Promise.all(stages.formations.map(stageImage));
  const routeImages = options.sheets ? await Promise.all(stages.routes.map(stageImage)) : [];
  const pages = new Pages(doc.name);
  const { ctx } = pages;
  const contentW = W - 2 * M;

  /* header */
  const draw = () => pages.ctx;
  setFont(ctx, 50, 800);
  ctx.fillStyle = INK;
  for (const line of wrap(ctx, doc.name, contentW)) {
    ctx.fillText(line, M, pages.y);
    pages.y += 60;
  }
  setFont(ctx, 23);
  ctx.fillStyle = MUTED;
  const meta = [
    `${dancers.length} membres`,
    `${sortedFormations(doc).length} formations`,
    formatTime(totalDuration(doc), false),
    doc.music.name ? `♪ ${doc.music.name}` : '',
    doc.music.bpm ? `${doc.music.bpm} BPM` : '',
    `Scène ${doc.stage.width} × ${doc.stage.depth} m`,
  ]
    .filter(Boolean)
    .join(' · ');
  for (const line of wrap(ctx, meta, contentW)) {
    ctx.fillText(line, M, pages.y);
    pages.y += 32;
  }
  pages.y += 10;
  let x = M;
  for (const d of dancers) {
    setFont(ctx, 22);
    const label = d.group ? `${d.name} · ${d.group}` : d.name;
    const w = 36 + 8 + ctx.measureText(label).width + 26;
    if (x + w > W - M) {
      x = M;
      pages.y += 46;
    }
    badge(ctx, x, pages.y, 18, d.color, initials(d.name));
    setFont(ctx, 22);
    ctx.fillStyle = INK;
    ctx.fillText(label, x + 44, pages.y + 7);
    x += w;
  }
  pages.y += 70;

  /* formations, two per row */
  const colW = (contentW - GAP) / 2;
  const pad = 16;
  const textW = colW - 2 * pad;
  const measureCard = (i: number) => {
    const it = items[i];
    const c = draw();
    const stageH = textW * formationImages[i].ratio;
    setFont(c, 26, 700);
    const title = wrap(c, `${it.index + 1}. ${it.f.name}`, textW);
    setFont(c, 19);
    const times = wrap(c, `${formatTime(it.start)} → ${formatTime(it.holdEnd)} · tenue ${it.f.duration.toFixed(2)} s${it.index < items.length - 1 ? ` · transition ${it.f.transition.toFixed(2)} s` : ''}`, textW);
    setFont(c, 19, 400, 'italic');
    const note = it.f.note ? wrap(c, it.f.note, textW) : [];
    setFont(c, 18);
    const comments = dancers
      .filter((d) => it.f.positions[d.id]?.comment)
      .map((d) => ({ d, lines: wrap(c, `${d.name} — ${it.f.positions[d.id].comment}`, textW) }));
    const height = pad + stageH + 12 + title.length * 34 + times.length * 26 + note.length * 26 + comments.reduce((s, cm) => s + cm.lines.length * 24, 0) + pad + 4;
    return { it, stageH, title, times, note, comments, height };
  };
  const drawCard = (card: ReturnType<typeof measureCard>, i: number, left: number, top: number, rowH: number) => {
    const c = draw();
    roundRect(c, left, top, colW, rowH, 14);
    c.strokeStyle = LINE;
    c.lineWidth = 2;
    c.stroke();
    let y = top + pad;
    c.drawImage(formationImages[i].img, left + pad, y, textW, card.stageH);
    y += card.stageH + 12;
    setFont(c, 26, 700);
    c.fillStyle = INK;
    for (const line of card.title) {
      c.fillText(line, left + pad, y);
      y += 34;
    }
    setFont(c, 19);
    c.fillStyle = MUTED;
    for (const line of card.times) {
      c.fillText(line, left + pad, y);
      y += 26;
    }
    setFont(c, 19, 400, 'italic');
    c.fillStyle = INK;
    for (const line of card.note) {
      c.fillText(line, left + pad, y);
      y += 26;
    }
    setFont(c, 18);
    for (const { d, lines } of card.comments) {
      lines.forEach((line, k) => {
        c.fillStyle = k === 0 ? INK : MUTED;
        c.fillText(line, left + pad, y);
        y += 24;
      });
      c.fillStyle = d.color;
      c.fillRect(left + pad - 8, y - lines.length * 24, 3, lines.length * 24 - 4);
    }
  };
  for (let i = 0; i < items.length; i += 2) {
    const a = measureCard(i);
    const b = i + 1 < items.length ? measureCard(i + 1) : null;
    const rowH = Math.max(a.height, b?.height ?? 0);
    pages.fit(rowH);
    drawCard(a, i, M, pages.y, rowH);
    if (b) drawCard(b, i + 1, M + colW + GAP, pages.y, rowH);
    pages.y += rowH + GAP;
  }

  /* one page per dancer */
  if (options.sheets) {
    const cols = [
      { label: '#', w: 56 },
      { label: 'Formation', w: 270 },
      { label: 'Temps', w: 130 },
      { label: 'Position', w: 240 },
      { label: 'Notes', w: contentW - 696 },
    ];
    dancers.forEach((d, di) => {
      pages.newPage();
      const c = draw();
      badge(c, M, pages.y, 34, d.color, initials(d.name));
      setFont(c, 38, 800);
      c.fillStyle = INK;
      c.fillText(d.name, M + 88, pages.y + 4);
      setFont(c, 22);
      c.fillStyle = MUTED;
      c.fillText(d.group ? `${doc.name} · ${d.group}` : doc.name, M + 88, pages.y + 50);
      pages.y += 100;

      const route = routeImages[di];
      if (route) {
        const w = Math.min(contentW, 760);
        const h = Math.min(w * route.ratio, 640);
        const drawW = h / route.ratio;
        c.drawImage(route.img, M, pages.y, drawW, h);
        pages.y += h + 28;
      }

      const header = () => {
        const cc = draw();
        setFont(cc, 19, 700);
        cc.fillStyle = FAINT;
        let cx = M;
        for (const col of cols) {
          cc.fillText(col.label, cx, pages.y);
          cx += col.w;
        }
        pages.y += 32;
        cc.fillStyle = LINE;
        cc.fillRect(M, pages.y - 6, contentW, 2);
      };
      header();
      for (const it of items) {
        const cc = draw();
        const p = it.f.positions[d.id];
        const notes = [
          p?.path && p.path.kind !== 'linear' ? `trajet ${p.path.kind === 'curve' ? 'courbe' : 'multi-points'}.` : '',
          p?.timing ? `part à ${Math.round(p.timing.start * 100)} % de la transition.` : '',
          p?.comment ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        const values = [String(it.index + 1), it.f.name, formatTime(it.start), p ? describePos(p) : '—', notes];
        setFont(cc, 20);
        const cells = values.map((v, k) => wrap(cc, v, cols[k].w - 14));
        const rowH = Math.max(...cells.map((l) => l.length)) * 27 + 14;
        if (pages.y + rowH > H - M - 24) {
          pages.newPage();
          header();
        }
        const c2 = draw();
        setFont(c2, 20);
        c2.fillStyle = INK;
        let cx = M;
        cells.forEach((lines, k) => {
          lines.forEach((line, n) => c2.fillText(line, cx, pages.y + n * 27));
          cx += cols[k].w;
        });
        pages.y += rowH;
        c2.fillStyle = LINE;
        c2.fillRect(M, pages.y - 8, contentW, 1.5);
      }
    });
  }

  return canvasesToPdf(pages.canvases);
}
