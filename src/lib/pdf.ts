/**
 * Minimal PDF writer: one JPEG image per A4 page. Drawing pages on a canvas keeps every glyph
 * (Korean or Japanese names, accents, emoji) without embedding fonts, and needs no library.
 */
export async function canvasesToPdf(pages: HTMLCanvasElement[], widthPt = 595.28, heightPt = 841.89): Promise<Blob> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  const jpegs = await Promise.all(
    pages.map(
      (canvas) =>
        new Promise<Uint8Array>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('page image'))), 'image/jpeg', 0.9),
        ),
    ),
  );

  push('%PDF-1.4\n');
  push(new Uint8Array([37, 226, 227, 207, 211, 10])); // binary marker
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  pages.forEach((canvas, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const draw = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im${i} Do Q`;
    object(pageId, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`),
    );
    object(contentId, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    object(imageId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegs[i].length} >>\nstream\n`);
      push(jpegs[i]);
      push('\nendstream');
    });
  });

  const xref = size;
  const count = 3 + pages.length * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
