import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { describePos, download, safe } from '../lib/exporters';
import { detectPlatform } from '../lib/install';
import { initials, samplePath, textOn } from '../lib/geometry';
import { formatTime, sortedDancers, sortedFormations, sortedProps, timeline, totalDuration } from '../lib/model';
import { navigate } from '../lib/router';
import type { Choreo, Formation, ID } from '../lib/types';
import { IS_PHONE_APP } from '../lib/platform';
import { Icon } from './common/Icon';
import { notify } from './common/Toast';

/** Browsers and the desktop app use the print dialog; the phone apps call the system print service. */
async function printPage(name: string) {
  if (!IS_PHONE_APP) return window.print();
  const { registerPlugin } = await import('@capacitor/core');
  const printer = registerPlugin<{ print: (options: { name: string }) => Promise<void> }>('FsPrint');
  await printer.print({ name });
}

export function PrintPage({ id }: { id: string }) {
  const [doc, setDoc] = useState<Choreo | null | undefined>(undefined);
  const [sheets, setSheets] = useState(true);
  const [paths, setPaths] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Ready PDF waiting for a tap on "share" (the share sheet needs a fresh tap). */
  const [pdf, setPdf] = useState<File | null>(null);

  useEffect(() => setPdf(null), [sheets, paths]);

  useEffect(() => {
    db.getChoreo(id).then((d) => setDoc(d ?? null));
  }, [id]);

  if (doc === undefined) return <div className="center-screen"><div className="spinner" /></div>;
  if (doc === null) return <div className="center-screen"><p>Chorégraphie introuvable.</p></div>;

  const makePdf = async () => {
    setBusy(true);
    try {
      const { choreographyPdf } = await import('../lib/printPdf');
      const blob = await choreographyPdf(
        doc,
        {
          formations: Array.from(document.querySelectorAll<SVGSVGElement>('.print-card .print-stage')),
          routes: Array.from(document.querySelectorAll<SVGSVGElement>('.print-sheet .print-stage')),
        },
        { sheets },
      );
      const file = new File([blob], `${safe(doc.name)}.pdf`, { type: 'application/pdf' });
      const shareable = !IS_PHONE_APP && matchMedia('(pointer: coarse)').matches && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      if (shareable) setPdf(file);
      else {
        await download(file.name, blob);
        notify('PDF créé');
      }
    } catch {
      notify('Impossible de créer le PDF');
    } finally {
      setBusy(false);
    }
  };
  // printing from a web page does not work on iPhone: the PDF (then Share → Print) does
  const canPrint = IS_PHONE_APP || detectPlatform() !== 'ios';

  const items = timeline(doc);
  const dancers = sortedDancers(doc);
  const formations = sortedFormations(doc);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button className="btn ghost" onClick={() => navigate(`/c/${doc.id}`)}>
          <Icon name="back" /> Éditeur
        </button>
        <label className="toggle-inline">
          <input type="checkbox" checked={paths} onChange={(e) => setPaths(e.target.checked)} /> Trajets
        </label>
        <label className="toggle-inline">
          <input type="checkbox" checked={sheets} onChange={(e) => setSheets(e.target.checked)} /> Fiches danseurs
        </label>
        <span className="grow" />
        {canPrint && (
          <button className="btn ghost" onClick={() => printPage(doc.name)}>
            <Icon name="print" /> Imprimer
          </button>
        )}
        {pdf ? (
          <button className="btn primary" onClick={() => navigator.share({ files: [pdf], title: doc.name }).catch(() => {})}>
            <Icon name="share" /> Partager / enregistrer le PDF
          </button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={makePdf}>
            <Icon name="download" /> {busy ? 'Création du PDF…' : 'Télécharger le PDF'}
          </button>
        )}
      </div>

      <header className="print-header">
        <h1>{doc.name}</h1>
        <p>
          {dancers.length} membres · {formations.length} formations · {formatTime(totalDuration(doc), false)}
          {doc.music.name && <> · ♪ {doc.music.name}</>}
          {doc.music.bpm && <> · {doc.music.bpm} BPM</>} · Scène {doc.stage.width} × {doc.stage.depth} m
        </p>
        <div className="print-legend">
          {dancers.map((d) => (
            <span key={d.id}>
              <i style={{ background: d.color, color: textOn(d.color) }}>{initials(d.name)}</i> {d.name}
              {d.group && <em> · {d.group}</em>}
            </span>
          ))}
        </div>
      </header>

      <section className="print-grid">
        {items.map((it) => {
          const comments = dancers.filter((d) => it.f.positions[d.id]?.comment);
          return (
            <article key={it.f.id} className="print-card">
              <PrintStage doc={doc} formation={it.f} prev={paths ? items[it.index - 1]?.f : undefined} />
              <div className="print-caption">
                <h3>
                  {it.index + 1}. {it.f.name}
                </h3>
                <p>
                  {formatTime(it.start)} → {formatTime(it.holdEnd)} · tenue {it.f.duration.toFixed(2)}s
                  {it.index < items.length - 1 && <> · transition {it.f.transition.toFixed(2)}s</>}
                </p>
                {it.f.note && <p className="print-note">{it.f.note}</p>}
                {comments.map((d) => (
                  <p key={d.id} className="print-comment">
                    <b style={{ color: d.color }}>{d.name}</b> — {it.f.positions[d.id].comment}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      {sheets &&
        dancers.map((d) => (
          <section key={d.id} className="print-sheet">
            <div className="print-sheet-head">
              <i style={{ background: d.color, color: textOn(d.color) }}>{initials(d.name)}</i>
              <div>
                <h2>{d.name}</h2>
                <p>
                  {doc.name}
                  {d.group && <> · {d.group}</>}
                </p>
              </div>
            </div>
            <div className="print-sheet-body">
              <PrintStage doc={doc} route={d.id} />
              <table className="print-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Formation</th>
                    <th>Temps</th>
                    <th>Position</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const p = it.f.positions[d.id];
                    return (
                      <tr key={it.f.id}>
                        <td>{it.index + 1}</td>
                        <td>{it.f.name}</td>
                        <td>{formatTime(it.start)}</td>
                        <td>{p ? describePos(p) : '—'}</td>
                        <td>
                          {p?.path && p.path.kind !== 'linear' && <em>trajet {p.path.kind === 'curve' ? 'courbe' : 'multi-points'}. </em>}
                          {p?.timing && <em>part à {Math.round(p.timing.start * 100)}% de la transition. </em>}
                          {p?.comment}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}

function PrintStage({ doc, formation, prev, route }: { doc: Choreo; formation?: Formation; prev?: Formation; route?: ID }) {
  const { stage } = doc;
  const hw = stage.width / 2;
  const hd = stage.depth / 2;
  const r = stage.dancerSize / 2;
  const formations = sortedFormations(doc);
  const lines = [];
  for (let x = -Math.floor(hw); x <= Math.floor(hw); x++) lines.push(<line key={`x${x}`} x1={x} x2={x} y1={-hd} y2={hd} className={x === 0 ? 'p-center' : 'p-grid'} />);
  for (let y = -Math.floor(hd); y <= Math.floor(hd); y++) lines.push(<line key={`y${y}`} y1={y} y2={y} x1={-hw} x2={hw} className="p-grid" />);
  return (
    <svg className="print-stage" viewBox={`${-hw - 0.4} ${-hd - 0.4} ${stage.width + 0.8} ${stage.depth + 1.3}`}>
      <rect x={-hw} y={-hd} width={stage.width} height={stage.depth} className="p-floor" />
      {lines}
      {Array.from({ length: Math.floor(hw) * 2 + 1 }, (_, i) => i - Math.floor(hw)).map((k) => (
        <text key={k} x={k} y={hd + 0.4} fontSize={0.28} className="p-num">
          {Math.abs(k)}
        </text>
      ))}
      <text x={0} y={hd + 0.8} fontSize={0.22} className="p-num">
        PUBLIC
      </text>
      {formation &&
        sortedProps(doc).map((p) => {
          const s = formation.props[p.id];
          if (!s?.visible) return null;
          return p.shape === 'rect' ? (
            <rect key={p.id} x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} fill={s.color} opacity={0.5} transform={`rotate(${s.rotation} ${s.x} ${s.y})`} />
          ) : (
            <ellipse key={p.id} cx={s.x} cy={s.y} rx={s.w / 2} ry={s.h / 2} fill={s.color} opacity={0.5} />
          );
        })}
      {formation &&
        prev &&
        Object.values(doc.dancers).map((d) => {
          const a = prev.positions[d.id];
          const b = formation.positions[d.id];
          if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 0.05) return null;
          const pts = samplePath(a, b, b.path, 24);
          return <polyline key={d.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} stroke={d.color} className="p-path" />;
        })}
      {formation &&
        Object.values(doc.dancers).map((d) => {
          const p = formation.positions[d.id];
          if (!p) return null;
          return (
            <g key={d.id} transform={`translate(${p.x} ${p.y})`}>
              <circle r={r} fill={d.color} stroke="#000" strokeWidth={0.02} />
              <text fontSize={r * 0.7} dy={r * 0.25} fill={textOn(d.color)} className="p-init">
                {initials(d.name)}
              </text>
            </g>
          );
        })}
      {route &&
        (() => {
          const d = doc.dancers[route];
          const pts = formations.map((f) => f.positions[route]).filter(Boolean);
          return (
            <g>
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} stroke={d.color} className="p-path strong" />
              {pts.map((p, i) => (
                <g key={i} transform={`translate(${p.x} ${p.y})`}>
                  <circle r={0.22} fill={d.color} stroke="#000" strokeWidth={0.02} />
                  <text fontSize={0.22} dy={0.08} fill={textOn(d.color)} className="p-init">
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}
    </svg>
  );
}
