import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { applyPreset, stagger, swap, transform, type TransformKind } from '../../lib/actions';
import { PROP_COLORS } from '../../lib/colors';
import { db } from '../../lib/db';
import { describePos } from '../../lib/exporters';
import { uid } from '../../lib/id';
import {
  addDancer,
  addProp,
  beatLength,
  formatTime,
  insertFormationAfter,
  moveFormation,
  removeDancer,
  removeFormation,
  removeProp,
  snapTime,
  sortedDancers,
  sortedProps,
  STAGE_PRESETS,
  timeline,
} from '../../lib/model';
import { PRESET_BY_ID, PRESETS, type AssignMode, type Preset } from '../../lib/presets';
import type { Choreo, Easing, ID, PathKind } from '../../lib/types';
import { useCollisions } from '../../store/derived';
import { currentItem, useEditor, type InspectorTab } from '../../store/editor';
import { useLibrary } from '../../store/library';
import { importMusicFile, redetectBpm, useMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { Collapsible, Tip } from '../common/Collapsible';
import { Icon, type IconName } from '../common/Icon';
import { notify } from '../common/Toast';
import { ColorDot, ColorSwatches, IconButton, NumberField, Segmented, TextField, Toggle } from '../common/ui';
import { r2, recenterSafe } from './inspectorUtils';

export const TABS: { id: InspectorTab; icon: IconName; label: string }[] = [
  { id: 'presets', icon: 'wand', label: 'Placer' },
  { id: 'formation', icon: 'note', label: 'Formation' },
  { id: 'dancers', icon: 'users', label: 'Membres' },
  { id: 'music', icon: 'music', label: 'Musique' },
  { id: 'stage', icon: 'stage', label: 'Scène' },
];

export function Inspector() {
  const tab = useEditor((s) => s.tab);
  const set = useEditor((s) => s.set);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <aside className="inspector">
      <div className="sheet-head">
        <span className="sheet-grip" />
        <Icon name={current.icon} size={16} />
        <b>{current.label}</b>
        <span className="grow" />
        <IconButton icon="close" title="Fermer" onClick={() => set({ sheetOpen: false })} />
      </div>
      <nav className="inspector-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={current.id === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })} title={t.label}>
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="inspector-body">
        {current.id === 'presets' && <PlacementPanel />}
        {current.id === 'formation' && <FormationPanel />}
        {current.id === 'dancers' && <DancersPanel />}
        {current.id === 'music' && <MusicPanel />}
        {current.id === 'stage' && <StagePanel />}
      </div>
    </aside>
  );
}

/** Id of the formation being edited; leaves a transition first. */
function editableFormationId(): ID | null {
  const s = useEditor.getState();
  if (!s.doc) return null;
  const { items, index, item } = currentItem(s.doc, s.time);
  if (!item) return null;
  if (s.time > item.holdEnd + 1e-6 && items[index + 1]) {
    const progress = (s.time - item.holdEnd) / (item.f.transition || 1);
    const target = progress >= 0.5 ? items[index + 1] : item;
    playback.seek(target.start);
    return target.f.id;
  }
  return item.f.id;
}

function useCurrent() {
  const doc = useEditor((s) => s.doc!);
  const time = useEditor((s) => s.time);
  const { items, index, item } = currentItem(doc, time);
  return { doc, time, items, index, item, prev: items[index - 1], next: items[index + 1] };
}

/* ------------------------------- Placement ------------------------------- */

const usePresetOpts = create<{ spacing: number; mode: AssignMode; keepCenter: boolean }>(() => ({ spacing: 1.2, mode: 'nearest', keepCenter: true }));

const FEATURED = ['line', 'window', 'v', 'triangle', 'circle', 'arc', 'diamond', 'center-wings'];

const TOOLS: [TransformKind, IconName, string, string][] = [
  ['mirrorX', 'flipH', 'Miroir gauche / droite', 'Miroir'],
  ['mirrorY', 'flipV', 'Inverser avant et fond', 'Avant ↔ fond'],
  ['rotateL', 'rotateL', 'Pivoter de 15°', '−15°'],
  ['rotateR', 'rotateR', 'Pivoter de 15°', '+15°'],
  ['spread', 'expand', 'Écarter les membres', 'Écarter'],
  ['tighten', 'compress', 'Rapprocher les membres', 'Resserrer'],
  ['alignH', 'alignH', 'Mettre sur une même ligne', 'En ligne'],
  ['alignV', 'alignV', 'Mettre en colonne', 'Colonne'],
  ['distH', 'distH', 'Espacer régulièrement en largeur', 'Répartir ↔'],
  ['distV', 'distV', 'Espacer régulièrement en profondeur', 'Répartir ↕'],
  ['center', 'target', 'Recentrer sur la scène', 'Centrer'],
  ['snap', 'magnet', 'Caler sur la grille', 'Grille'],
];

function PlacementPanel() {
  const { doc, item, prev } = useCurrent();
  const selected = useEditor((s) => s.selected);
  const readOnly = useEditor((s) => s.readOnly);
  const focusDancer = useEditor((s) => s.focusDancer);
  const update = useEditor((s) => s.update);
  const opts = usePresetOpts();
  const [allShapes, setAllShapes] = useState(false);
  const dancers = sortedDancers(doc);
  const orderIndex = new Map(dancers.map((d, i) => [d.id, i]));
  const byOrder = (ids: ID[]) => [...ids].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  const allIds = dancers.map((d) => d.id);
  // tools act on any selection; shapes need at least 2 dancers, otherwise the whole group
  const targets = byOrder(selected.length ? selected : allIds);
  const presetTargets = byOrder(selected.length >= 2 ? selected : allIds);
  const n = presetTargets.length;

  const run = (label: string, fn: (d: Choreo, fid: ID) => void) => {
    const fid = editableFormationId();
    if (fid) update(label, (d) => fn(d, fid));
  };

  const colors = useMemo(() => {
    const m = new Map<string, ID[]>();
    for (const d of dancers) m.set(d.color, [...(m.get(d.color) ?? []), d.id]);
    return [...m.entries()];
  }, [dancers]);
  const groups = useMemo(() => {
    const m = new Map<string, ID[]>();
    for (const d of dancers) if (d.group) m.set(d.group, [...(m.get(d.group) ?? []), d.id]);
    return [...m.entries()];
  }, [dancers]);

  const pickSet = (ids: ID[], additive: boolean) => {
    const s = useEditor.getState();
    s.select(additive ? [...new Set([...s.selected, ...ids])] : ids);
  };

  const single = selected.length === 1 ? doc.dancers[selected[0]] : null;
  const singlePos = single && item ? item.f.positions[single.id] : null;
  const pathKinds = new Set(selected.map((id) => item?.f.positions[id]?.path?.kind ?? 'linear'));
  const pathKind = (pathKinds.size === 1 ? [...pathKinds][0] : 'linear') as PathKind;

  const setPathKind = (kind: PathKind) =>
    run('Type de trajet', (d, fid) => {
      const items = timeline(d);
      const i = items.findIndex((x) => x.f.id === fid);
      const from = items[i - 1]?.f;
      if (!from) return;
      selected.forEach((id, k) => {
        const a = from.positions[id];
        const z = d.formations[fid].positions[id];
        if (!a || !z) return;
        if (kind === 'linear') return void delete z.path;
        const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
        const len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
        const nx = -(z.y - a.y) / len;
        const ny = (z.x - a.x) / len;
        const off = Math.max(0.6, len * 0.35) * (k % 2 ? -1 : 1);
        z.path = { kind, points: [{ x: r2(mid.x + nx * off), y: r2(mid.y + ny * off) }] };
      });
    });

  if (!item) return null;
  const shapes = allShapes ? PRESETS : FEATURED.map((id) => PRESET_BY_ID[id]);
  const categories = allShapes ? [...new Set(PRESETS.map((p) => p.category))] : [null];

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <b className="grow">{selected.length ? `${selected.length} membre${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}` : 'Tout le groupe'}</b>
          {selected.length < dancers.length && (
            <button className="btn small ghost" onClick={() => useEditor.getState().select(allIds)}>
              Tout sélectionner
            </button>
          )}
          {selected.length > 0 && (
            <button className="btn small ghost" onClick={() => useEditor.getState().select([])}>
              Aucun
            </button>
          )}
        </div>
        <p className="hint">
          {readOnly
            ? 'Lecture seule : vous pouvez regarder, lire la musique et exporter.'
            : selected.length
              ? 'Glissez-les sur la scène, ou utilisez les outils ci-dessous.'
              : 'Touchez un membre pour le sélectionner, ou tracez un cadre autour de plusieurs.'}
        </p>
        {(colors.length > 1 || groups.length > 0) && (
          <div className="color-filter" aria-label="Sélection rapide">
            {colors.length > 1 &&
              colors.map(([c, ids]) => (
                <button key={c} className="chip" onClick={(e) => pickSet(ids, e.shiftKey)} title="Sélectionner cette couleur (Maj pour ajouter)">
                  <i style={{ background: c }} /> {ids.length}
                </button>
              ))}
            {groups.map(([g, ids]) => (
              <button key={g} className="chip" onClick={(e) => pickSet(ids, e.shiftKey)} title="Sélectionner cette section">
                <Icon name="tag" size={11} /> {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
        <Collapsible id="placer-shapes" icon="grid" title="Formes toutes prêtes" hint={`Un clic place ${selected.length >= 2 ? 'la sélection' : 'tout le groupe'} (${n} membres)`} defaultOpen>
          {categories.map((cat) => (
            <div key={cat ?? 'featured'}>
              {cat && <div className="preset-cat">{cat}</div>}
              <div className="preset-grid">
                {shapes
                  .filter((p) => !cat || p.category === cat)
                  .map((p) => (
                    <button key={p.id} className="preset-btn" title={p.hint ?? p.name} onClick={() => run(`Forme « ${p.name} »`, (d, fid) => applyPreset(d, fid, p.id, presetTargets, opts))}>
                      <PresetIcon preset={p} n={n >= 3 ? n : 6} spacing={opts.spacing} />
                      <span>{p.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <button className="btn small ghost block" onClick={() => setAllShapes(!allShapes)}>
            <Icon name={allShapes ? 'up' : 'down'} size={14} /> {allShapes ? 'Moins de formes' : `Voir les ${PRESETS.length} formes`}
          </button>
          <div className="subsection">
            <label className="field">
              <span className="field-label">
                Espace entre les membres <b>{opts.spacing.toFixed(2).replace('.', ',')} m</b>
              </span>
              <input type="range" min={0.6} max={2.2} step={0.05} value={opts.spacing} onChange={(e) => usePresetOpts.setState({ spacing: Number(e.target.value) })} />
            </label>
            <div className="field">
              <span className="field-label">Qui va où ?</span>
              <Segmented
                value={opts.mode}
                onChange={(mode) => usePresetOpts.setState({ mode })}
                options={[
                  { value: 'nearest', label: 'Trajets courts', title: 'Chacun va à la place la plus proche' },
                  { value: 'order', label: 'Ordre G → D', title: 'Membre 1 à gauche, puis dans l’ordre de la liste' },
                ]}
              />
            </div>
            {selected.length >= 2 && selected.length < dancers.length && (
              <Toggle checked={opts.keepCenter} onChange={(keepCenter) => usePresetOpts.setState({ keepCenter })} label="Garder la sélection là où elle est" />
            )}
          </div>
        </Collapsible>
      )}

      {!readOnly && (
        <Collapsible id="placer-tools" icon="wand" title="Ajuster" hint={`Miroir, rotation, alignement… sur ${selected.length ? 'la sélection' : 'tout le groupe'}`}>
          <div className="tool-grid labeled">
            {TOOLS.map(([kind, icon, label, short]) => (
              <button key={kind} className="tool-btn" title={label} onClick={() => run(label, (d, fid) => transform(d, fid, targets, kind))}>
                <Icon name={icon} size={17} />
                <span>{short}</span>
              </button>
            ))}
          </div>
          <div className="row gap wrap">
            {selected.length === 2 && (
              <button className="btn small" onClick={() => run('Échanger les places', (d, fid) => swap(d, fid, selected[0], selected[1]))}>
                <Icon name="swap" size={14} /> Échanger leurs places
              </button>
            )}
            {prev && (
              <button
                className="btn small"
                title="Remettre les positions de la formation précédente"
                onClick={() =>
                  run('Comme la formation précédente', (d, fid) => {
                    for (const id of targets) {
                      const p = prev.f.positions[id];
                      const z = d.formations[fid].positions[id];
                      if (p && z) {
                        z.x = p.x;
                        z.y = p.y;
                        delete z.path;
                      }
                    }
                  })
                }
              >
                <Icon name="copy" size={14} /> Comme la précédente
              </button>
            )}
          </div>
        </Collapsible>
      )}

      {selected.length > 0 && prev && !readOnly && (
        <Collapsible id="placer-path" icon="route" title="Trajet et timing" hint="Comment la sélection arrive dans cette formation">
          <div className="field">
            <span className="field-label">Forme du trajet</span>
            <Segmented
              value={pathKind}
              onChange={setPathKind}
              options={[
                { value: 'linear', label: 'Droit' },
                { value: 'curve', label: 'Courbe' },
                { value: 'points', label: 'Multi-points' },
              ]}
            />
            <span className="hint">Glissez les poignées blanches sur la scène. Double-clic sur un trajet : ajouter un point. Alt + clic sur un point : le retirer.</span>
          </div>
          <div className="field">
            <span className="field-label">Départs décalés (canon)</span>
            <span className="hint">Les membres partent l’un après l’autre au lieu de bouger ensemble.</span>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => run('Canon G → D', (d, fid) => stagger(d, fid, targets, 'ltr'))}>G → D</button>
              <button className="btn small" onClick={() => run('Canon D → G', (d, fid) => stagger(d, fid, targets, 'rtl'))}>D → G</button>
              <button className="btn small" onClick={() => run('Canon avant → fond', (d, fid) => stagger(d, fid, targets, 'frontBack'))}>Avant → fond</button>
              <button className="btn small" onClick={() => run('Canon par ordre', (d, fid) => stagger(d, fid, targets, 'order'))}>Ordre</button>
              <button className="btn small ghost" onClick={() => run('Tous ensemble', (d, fid) => stagger(d, fid, targets, 'reset'))}>Tous ensemble</button>
            </div>
          </div>
          {singlePos && (
            <div className="row gap">
              <NumberField
                label="Part à (0 → 1)"
                value={singlePos.timing?.start ?? 0}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) =>
                  run('Timing', (d, fid) => {
                    const p = d.formations[fid].positions[single!.id];
                    p.timing = { start: Math.min(v, (p.timing?.end ?? 1) - 0.05), end: p.timing?.end ?? 1 };
                  })
                }
              />
              <NumberField
                label="Arrive à (0 → 1)"
                value={singlePos.timing?.end ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) =>
                  run('Timing', (d, fid) => {
                    const p = d.formations[fid].positions[single!.id];
                    p.timing = { start: p.timing?.start ?? 0, end: Math.max(v, (p.timing?.start ?? 0) + 0.05) };
                  })
                }
              />
            </div>
          )}
        </Collapsible>
      )}

      {single && singlePos && (
        <Collapsible
          id="placer-member"
          icon="user"
          defaultOpen
          title={
            <span className="row gap">
              <i className="dot" style={{ background: single.color }} /> {single.name}
            </span>
          }
          hint="Position précise, commentaire, parcours"
        >
          <p className="kv">
            <span>Position</span>
            <b>{describePos(singlePos)}</b>
          </p>
          <div className="row gap">
            <NumberField label="Gauche ↔ droite (m)" value={singlePos.x} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].x = v))} />
            <NumberField label="Fond ↔ avant (m)" value={singlePos.y} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].y = v))} />
          </div>
          <TextField
            label="Commentaire pour cette position"
            multiline
            disabled={readOnly}
            placeholder="ex : regard caméra, main sur l’épaule de…"
            value={singlePos.comment ?? ''}
            onChange={(v) =>
              run('Commentaire', (d, fid) => {
                const p = d.formations[fid].positions[single.id];
                if (v.trim()) p.comment = v;
                else delete p.comment;
              })
            }
          />
          <button className={`btn small ${focusDancer === single.id ? 'primary' : ''}`} onClick={() => useEditor.setState({ focusDancer: focusDancer === single.id ? null : single.id })}>
            <Icon name="focus" size={14} /> {focusDancer === single.id ? 'Quitter le mode focus' : 'Voir tout son parcours (focus)'}
          </button>
        </Collapsible>
      )}
    </>
  );
}

function PresetIcon({ preset, n, spacing }: { preset: Preset; n: number; spacing: number }) {
  const pts = useMemo(() => recenterSafe(preset.generate(n, spacing)), [preset, n, spacing]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(2, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(2, Math.max(...ys) - Math.min(...ys));
  const size = Math.max(w, h) + spacing;
  const rad = Math.max(size * 0.045, Math.min(spacing * 0.3, size * 0.08));
  return (
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="preset-svg" aria-hidden>
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={rad} />
      ))}
    </svg>
  );
}

/* ------------------------------- Formation ------------------------------- */

function FormationPanel() {
  const { doc, time, items, index, item, next } = useCurrent();
  const readOnly = useEditor((s) => s.readOnly);
  const update = useEditor((s) => s.update);
  const collisions = useCollisions().filter((c) => c.index === index);
  if (!item) return null;
  const f = item.f;
  const edit = (label: string, fn: (d: Choreo) => void) => update(label, fn);
  const bl = beatLength(doc.music);
  const prevItem = items[index - 1];

  const alignStartTo = (t: number, label: string) => {
    if (!prevItem) return;
    const newDur = Math.max(0, r2(prevItem.f.duration + t - item.start));
    edit(label, (d) => {
      d.formations[prevItem.f.id].duration = newDur;
    });
    requestAnimationFrame(() => playback.seek(Math.max(0, item.start + (newDur - prevItem.f.duration))));
  };

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <span className="step-badge">{index + 1}</span>
          <b className="grow">sur {items.length} formations</b>
          <span className="hint">
            {formatTime(item.start, false)} → {formatTime(item.end, false)}
          </span>
        </div>
        <TextField label="Nom de la formation" value={f.name} disabled={readOnly} onChange={(v) => edit('Renommer la formation', (d) => void (d.formations[f.id].name = v || 'Sans nom'))} />
      </div>

      <Collapsible id="formation-durations" icon="clock" title="Durées" hint="Temps immobile, puis temps pour aller à la suivante" defaultOpen>
        <div className="row gap">
          <NumberField label="Tenue" suffix="s" value={f.duration} min={0} step={0.01} disabled={readOnly} onChange={(v) => edit('Durée de formation', (d) => void (d.formations[f.id].duration = v))} />
          <NumberField
            label="Déplacement"
            suffix="s"
            value={f.transition}
            min={0}
            step={0.01}
            disabled={readOnly || !next}
            onChange={(v) => edit('Durée de transition', (d) => void (d.formations[f.id].transition = v))}
          />
        </div>
        <p className="hint">
          {bl
            ? `Soit ${(f.duration / bl).toFixed(1).replace('.', ',')} temps de tenue${next ? ` et ${(f.transition / bl).toFixed(1).replace('.', ',')} temps de déplacement` : ''}.`
            : 'Astuce : vous pouvez aussi étirer les blocs directement sur la timeline.'}
          {!next && ' C’est la dernière formation : pas de déplacement après.'}
        </p>
        {!readOnly && prevItem && (
          <div className="row gap wrap">
            <button className="btn small" onClick={() => alignStartTo(time, 'Débuter au curseur')} disabled={time <= prevItem.start}>
              <Icon name="clock" size={14} /> Commencer au curseur
            </button>
            {bl && (
              <button className="btn small" onClick={() => alignStartTo(snapTime(doc.music, item.start, 1), 'Caler sur le temps')}>
                <Icon name="metronome" size={14} /> Caler sur le temps
              </button>
            )}
          </div>
        )}
      </Collapsible>

      <Collapsible id="formation-notes" icon="note" title="Notes" hint="Intention, regard, niveau… visibles par toutes" defaultOpen>
        <TextField multiline disabled={readOnly} placeholder="ex : regard vers la caméra, bras en haut sur le 7" value={f.note} onChange={(v) => edit('Notes', (d) => void (d.formations[f.id].note = v))} />
      </Collapsible>

      {collisions.length > 0 && (
        <div className="panel-block">
          <Tip icon="warning" warn>
            {collisions.length} moment{collisions.length > 1 ? 's' : ''} où des membres se touchent. Touchez une ligne pour y aller ; passez le trajet en « Courbe » ou décalez les départs pour l’éviter.
          </Tip>
          {collisions.map((c, i) => (
            <button
              key={i}
              className="collision-item"
              onClick={() => {
                playback.seek(c.time);
                useEditor.getState().select([c.a, c.b]);
              }}
            >
              <b>
                {doc.dancers[c.a]?.name} × {doc.dancers[c.b]?.name}
              </b>
              <span>
                {formatTime(c.time)} · {c.kind === 'transition' ? 'pendant le déplacement' : 'trop proches'}
              </span>
            </button>
          ))}
        </div>
      )}

      {next && (
        <Collapsible id="formation-easing" icon="route" title="Style du déplacement" hint="Vitesse des membres vers la formation suivante">
          <select value={f.easing} disabled={readOnly} onChange={(e) => edit('Style du déplacement', (d) => void (d.formations[f.id].easing = e.target.value as Easing))}>
            <option value="ease">Fluide (accélère puis ralentit)</option>
            <option value="linear">Vitesse constante</option>
            <option value="easeIn">Départ lent</option>
            <option value="easeOut">Arrivée douce</option>
          </select>
        </Collapsible>
      )}

      {!readOnly && (
        <div className="panel-block row gap wrap">
          <button
            className="btn small"
            onClick={() => {
              let nid = '';
              edit('Dupliquer la formation', (d) => (nid = insertFormationAfter(d, f.id, `${f.name} (copie)`)));
              const it = timeline(useEditor.getState().doc!).find((x) => x.f.id === nid);
              if (it) playback.seek(it.start);
            }}
          >
            <Icon name="copy" size={14} /> Dupliquer
          </button>
          <IconButton icon="up" title="Placer plus tôt" disabled={!prevItem} onClick={() => edit('Monter la formation', (d) => moveFormation(d, f.id, -1))} />
          <IconButton icon="down" title="Placer plus tard" disabled={!next} onClick={() => edit('Descendre la formation', (d) => moveFormation(d, f.id, 1))} />
          <span className="grow" />
          <button className="btn small ghost danger" disabled={items.length <= 1} onClick={() => confirm(`Supprimer « ${f.name} » ?`) && edit('Supprimer la formation', (d) => removeFormation(d, f.id))}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------- Dancers -------------------------------- */

function DancersPanel() {
  const doc = useEditor((s) => s.doc!);
  const selected = useEditor((s) => s.selected);
  const focusDancer = useEditor((s) => s.focusDancer);
  const readOnly = useEditor((s) => s.readOnly);
  const update = useEditor((s) => s.update);
  const { teams, refresh } = useLibrary();
  const dancers = sortedDancers(doc);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleSelect = (id: ID, additive: boolean) => {
    const s = useEditor.getState();
    if (additive) s.select(s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]);
    else s.select([id]);
  };

  const moveOrder = (id: ID, dir: -1 | 1) =>
    update('Réordonner', (d) => {
      const list = sortedDancers(d);
      const i = list.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const a = d.dancers[list[i].id];
      const b = d.dancers[list[j].id];
      [a.order, b.order] = [b.order, a.order];
      if (a.order === b.order) b.order += dir;
    });

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <b className="grow">{dancers.length} membres</b>
          {!readOnly && (
            <button className="btn small primary" onClick={() => update('Ajouter un membre', (d) => void addDancer(d))}>
              <Icon name="plus" size={14} /> Ajouter
            </button>
          )}
        </div>
        <p className="hint">Nom, couleur (touchez la pastille) et section : vocal line, dance line, sous-unité… Les sections servent à sélectionner un groupe en un clic.</p>
      </div>

      <div className="panel-block">
        <div className="dancer-list">
          {dancers.map((d, i) => (
            <div key={d.id} className={`dancer-row ${selected.includes(d.id) ? 'on' : ''}`}>
              <ColorDot color={d.color} onChange={(c) => !readOnly && update('Couleur', (x) => void (x.dancers[d.id].color = c))} />
              <div className="dancer-fields" onClick={(e) => toggleSelect(d.id, e.shiftKey || e.metaKey)}>
                <TextField value={d.name} disabled={readOnly} onChange={(v) => update('Renommer', (x) => void (x.dancers[d.id].name = v || `Membre ${i + 1}`))} />
                <TextField value={d.group ?? ''} placeholder="Section" disabled={readOnly} onChange={(v) => update('Section', (x) => void (x.dancers[d.id].group = v.trim() || undefined))} />
              </div>
              <div className="dancer-actions">
                <IconButton icon="focus" title="Mode focus : voir tout son parcours" active={focusDancer === d.id} onClick={() => useEditor.setState({ focusDancer: focusDancer === d.id ? null : d.id })} />
                {!readOnly && (
                  <>
                    <IconButton icon="up" title="Monter dans la liste" disabled={i === 0} onClick={() => moveOrder(d.id, -1)} />
                    <IconButton icon="trash" title="Retirer de la chorégraphie" onClick={() => confirm(`Retirer ${d.name} de toutes les formations ?`) && update('Retirer un membre', (x) => removeDancer(x, d.id))} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!readOnly && selected.length > 1 && (
        <Collapsible id="dancers-bulk" icon="users" title={`Modifier les ${selected.length} sélectionnés`} hint="Même couleur ou même section d’un coup" defaultOpen>
          <div className="field">
            <span className="field-label">Couleur commune</span>
            <ColorSwatches value="" onChange={(c) => update('Couleur du groupe', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].color = c)))} />
          </div>
          <GroupNameInput onApply={(g) => update('Section du groupe', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].group = g || undefined)))} />
        </Collapsible>
      )}

      <Collapsible id="dancers-teams" icon="download" title="Équipes réutilisables" hint="Enregistrer ce groupe ou en ajouter un existant">
        <button
          className="btn small"
          onClick={async () => {
            await db.saveTeam({
              id: uid(),
              name: `${doc.name} — équipe`,
              updatedAt: Date.now(),
              members: dancers.map((d) => ({ name: d.name, color: d.color, group: d.group })),
            });
            refresh();
            notify('Équipe enregistrée dans la bibliothèque');
          }}
        >
          <Icon name="download" size={14} /> Enregistrer ce groupe comme équipe
        </button>
        {!readOnly && teams.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const t = teams.find((x) => x.id === e.target.value);
              if (!t) return;
              const existing = new Set(dancers.map((d) => d.name.toLowerCase()));
              const toAdd = t.members.filter((m) => !existing.has(m.name.toLowerCase()));
              update(`Importer « ${t.name} »`, (d) => toAdd.forEach((m) => addDancer(d, m)));
              notify(toAdd.length ? `${toAdd.length} membre(s) ajouté(s)` : 'Tous les membres sont déjà présents');
            }}
          >
            <option value="">Ajouter les membres d’une équipe…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.members.length})
              </option>
            ))}
          </select>
        )}
      </Collapsible>
    </>
  );
}

function GroupNameInput({ onApply }: { onApply: (g: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="field">
      <span className="field-label">Section commune</span>
      <div className="row gap">
        <input value={v} placeholder="ex : Vocal line" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn small" onClick={() => onApply(v.trim())}>
          Appliquer
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- Music --------------------------------- */

function snapAllToBeats(d: Choreo) {
  const items = timeline(d);
  let start = 0;
  for (const it of items) {
    const f = d.formations[it.f.id];
    const holdEnd = Math.max(start, snapTime(d.music, start + f.duration, 2));
    f.duration = r2(holdEnd - start);
    const end = Math.max(holdEnd, snapTime(d.music, holdEnd + f.transition, 2));
    if (it.index < items.length - 1) f.transition = r2(end - holdEnd);
    start = it.index < items.length - 1 ? end : holdEnd;
  }
}

function MusicPanel() {
  const doc = useEditor((s) => s.doc!);
  const time = useEditor((s) => s.time);
  const readOnly = useEditor((s) => s.readOnly);
  const metronome = useEditor((s) => s.metronome);
  const rate = useEditor((s) => s.rate);
  const update = useEditor((s) => s.update);
  const { loading, missing } = useMusic();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taps = useRef<number[]>([]);
  const music = doc.music;

  const onFile = async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return alert('Ce fichier n’est pas un fichier audio.');
    setBusy(true);
    try {
      const info = await importMusicFile(file);
      update('Importer la musique', (d) => {
        d.music = { ...info, countsPerPhrase: d.music.countsPerPhrase ?? 8 };
      });
      notify(info.bpm ? `Musique importée · ${info.bpm} BPM détectés` : 'Musique importée');
    } catch {
      alert('Impossible de lire ce fichier audio.');
    } finally {
      setBusy(false);
    }
  };

  const tap = () => {
    const now = performance.now();
    const list = taps.current.filter((t) => now - t < 2500);
    list.push(now);
    taps.current = list.slice(-9);
    if (taps.current.length >= 4) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      const bpm = Math.round((60000 / (iv.reduce((a, b) => a + b, 0) / iv.length)) * 10) / 10;
      update('BPM (tap)', (d) => void (d.music.bpm = bpm));
    }
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && !readOnly) onFile(f);
    },
  };

  return (
    <>
      <div className="panel-intro" {...dropProps}>
        {music.hash ? (
          <>
            <div className="music-card">
              <Icon name="music" size={20} />
              <div className="grow">
                <b className="ellipsis">{music.name}</b>
                <span>{loading ? 'Chargement…' : missing ? 'Fichier absent sur cet appareil : réimportez-le' : `${formatTime(music.duration ?? 0, false)} · enregistrée sur l’appareil`}</span>
              </div>
            </div>
            {!readOnly && (
              <div className="row gap wrap">
                <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={14} /> {missing ? 'Réimporter' : 'Changer de musique'}
                </button>
                <button
                  className="btn small ghost danger"
                  onClick={() => update('Retirer la musique', (d) => void (d.music = { countsPerPhrase: d.music.countsPerPhrase ?? 8, bpm: d.music.bpm, beatOffset: d.music.beatOffset }))}
                >
                  <Icon name="trash" size={14} /> Retirer
                </button>
              </div>
            )}
          </>
        ) : (
          <button className={`dropzone ${dragOver ? 'drag' : ''}`} disabled={readOnly || busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={24} />
            <b>{busy ? 'Analyse de la musique…' : 'Importer la musique'}</b>
            <span>Touchez pour choisir un fichier, ou glissez-le ici (MP3, WAV, M4A). Le tempo est détecté automatiquement.</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>

      <Collapsible id="music-tempo" icon="metronome" title="Tempo et comptes" hint="Pour voir les « 5, 6, 7, 8 » et caler les formations" defaultOpen>
        {music.bpm ? (
          <Tip icon="check">
            {music.bpm} BPM. Le compteur « phrase · temps » s’affiche pendant la lecture et les formations s’aimantent aux temps sur la timeline.
          </Tip>
        ) : (
          <Tip>Indiquez le BPM (ou tapez en rythme) pour afficher les comptes.</Tip>
        )}
        <div className="row gap">
          <NumberField label="BPM" value={music.bpm ?? 0} min={0} max={300} step={1} precision={1} disabled={readOnly} onChange={(v) => update('BPM', (d) => void (d.music.bpm = v || undefined))} />
          {!readOnly && (
            <button className="btn small tap-btn align-end" onClick={tap} title="Tapez 4 fois ou plus en rythme">
              <Icon name="hand" size={14} /> Tap tempo
            </button>
          )}
        </div>
        {!readOnly && music.hash && (
          <div className="row gap wrap">
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await redetectBpm(music.hash!);
                setBusy(false);
                if (res) update('Détecter le tempo', (d) => void Object.assign(d.music, { bpm: res.bpm, beatOffset: res.offset }));
                notify(res ? `${res.bpm} BPM détectés` : 'Tempo non détecté');
              }}
            >
              <Icon name="wave" size={14} /> Redétecter le tempo
            </button>
            {music.bpm ? (
              <button className="btn small" title="Mettez le curseur sur un « 1 » de la musique puis touchez ce bouton" onClick={() => update('Caler le 1 sur le curseur', (d) => void (d.music.beatOffset = r2(time % (60 / d.music.bpm!))))}>
                <Icon name="target" size={14} /> Le « 1 » est ici
              </button>
            ) : null}
          </div>
        )}
      </Collapsible>

      <Collapsible id="music-advanced" icon="settings" title="Réglages avancés" hint="Décalage du premier temps, longueur des phrases, alignement">
        <div className="row gap">
          <NumberField label="1er temps" suffix="s" value={music.beatOffset ?? 0} min={0} step={0.01} disabled={readOnly} onChange={(v) => update('Décalage du premier temps', (d) => void (d.music.beatOffset = v))} />
          <label className="field">
            <span className="field-label">Temps par phrase</span>
            <select value={music.countsPerPhrase ?? 8} disabled={readOnly} onChange={(e) => update('Comptes', (d) => void (d.music.countsPerPhrase = Number(e.target.value)))}>
              <option value={8}>8 temps</option>
              <option value={4}>4 temps</option>
              <option value={16}>16 temps</option>
            </select>
          </label>
        </div>
        {!readOnly && music.bpm ? (
          <button className="btn small" onClick={() => update('Aligner sur les temps', snapAllToBeats)}>
            <Icon name="magnet" size={14} /> Aligner toutes les formations sur les temps
          </button>
        ) : null}
        {!readOnly && music.duration ? (
          <button
            className="btn small"
            onClick={() =>
              update('Adapter à la musique', (d) => {
                const items = timeline(d);
                const last = items[items.length - 1];
                if (last && d.music.duration && last.end < d.music.duration) d.formations[last.f.id].duration = r2(last.f.duration + d.music.duration - last.end);
              })
            }
          >
            <Icon name="fit" size={14} /> Tenir la dernière formation jusqu’à la fin
          </button>
        ) : null}
      </Collapsible>

      <Collapsible id="music-playback" icon="play" title="Lecture pour répéter" hint="Ralentir, métronome">
        <div className="field">
          <span className="field-label">Vitesse</span>
          <Segmented value={String(rate)} onChange={(v) => playback.setRate(Number(v))} options={['0.5', '0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v.replace('.', ',')}×` }))} />
        </div>
        {music.bpm ? <Toggle checked={metronome} onChange={(v) => useEditor.setState({ metronome: v })} label="Métronome pendant la lecture" /> : null}
      </Collapsible>
    </>
  );
}

/* --------------------------------- Stage --------------------------------- */

const FLOORS = ['#1b1726', '#221c1a', '#1a2330', '#262626', '#2b1a24', '#e8e2d6'];

function StagePanel() {
  const stage = useEditor((s) => s.doc!.stage);
  const readOnly = useEditor((s) => s.readOnly);
  const audienceTop = useEditor((s) => s.audienceTop);
  const selectedProp = useEditor((s) => s.selectedProp);
  const update = useEditor((s) => s.update);
  const setStage = (label: string, patch: Partial<typeof stage>) => update(label, (d) => void Object.assign(d.stage, patch));
  const presetIdx = STAGE_PRESETS.findIndex((p) => p.width === stage.width && p.depth === stage.depth);
  return (
    <>
      <div className="panel-intro">
        <b>
          Scène de {String(stage.width).replace('.', ',')} × {String(stage.depth).replace('.', ',')} m
        </b>
        <p className="hint">Adaptez la taille à la salle pour que les espacements soient réalistes. Les chiffres au sol (0 au centre) sont les repères de placement.</p>
      </div>

      <Collapsible id="stage-size" icon="stage" title="Taille" hint="Largeur, profondeur, coulisses" defaultOpen>
        <select
          value={presetIdx}
          disabled={readOnly}
          onChange={(e) => {
            const p = STAGE_PRESETS[Number(e.target.value)];
            if (p) setStage('Taille de scène', { width: p.width, depth: p.depth });
          }}
        >
          {presetIdx < 0 && <option value={-1}>Taille personnalisée</option>}
          {STAGE_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="row gap">
          <NumberField label="Largeur" suffix="m" value={stage.width} min={2} max={40} step={0.5} precision={1} disabled={readOnly} onChange={(v) => setStage('Largeur de scène', { width: v })} />
          <NumberField label="Profondeur" suffix="m" value={stage.depth} min={2} max={30} step={0.5} precision={1} disabled={readOnly} onChange={(v) => setStage('Profondeur de scène', { depth: v })} />
        </div>
        <div className="row gap">
          <NumberField label="Coulisses" suffix="m" value={stage.wingWidth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Coulisses', { wingWidth: v })} />
          <NumberField label="Fond de scène" suffix="m" value={stage.backstageDepth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Fond de scène', { backstageDepth: v })} />
        </div>
        <NumberField label="Taille d’un danseur (sert à détecter les contacts)" suffix="m" value={stage.dancerSize} min={0.2} max={1.2} step={0.05} disabled={readOnly} onChange={(v) => setStage('Taille des danseurs', { dancerSize: v })} />
      </Collapsible>

      <Collapsible id="stage-marks" icon="grid" title="Repères et magnétisme" hint="Grille, numéros au sol, couleur du sol">
        <Toggle checked={stage.showGrid} onChange={(v) => setStage('Grille', { showGrid: v })} label="Grille" />
        <Toggle checked={stage.showNumbers} onChange={(v) => setStage('Numéros de scène', { showNumbers: v })} label="Numéros au sol (0 = centre)" />
        <Toggle checked={stage.snap} onChange={(v) => setStage('Magnétisme', { snap: v })} label="Magnétisme : les membres s’accrochent à la grille" />
        <div className="field">
          <span className="field-label">Pas de la grille</span>
          <Segmented value={String(stage.gridStep)} onChange={(v) => setStage('Pas de grille', { gridStep: Number(v) })} options={['0.25', '0.5', '1'].map((v) => ({ value: v, label: `${v.replace('.', ',')} m` }))} />
        </div>
        <div className="field">
          <span className="field-label">Couleur du sol</span>
          <ColorSwatches colors={FLOORS} value={stage.floorColor} onChange={(c) => setStage('Couleur du sol', { floorColor: c })} />
        </div>
      </Collapsible>

      <Collapsible id="stage-view" icon="mirror" title="Point de vue" hint="Public en bas ou vue miroir">
        <Segmented
          value={audienceTop ? 'dancers' : 'public'}
          onChange={(v) => useEditor.setState({ audienceTop: v === 'dancers' })}
          options={[
            { value: 'public', label: 'Vue public' },
            { value: 'dancers', label: 'Vue danseuses (miroir)' },
          ]}
        />
        <p className="hint">La vue danseuses met le public en haut : la gauche et la droite correspondent à ce que voient les danseuses face au miroir.</p>
      </Collapsible>

      <Collapsible id="stage-props" icon="box" title="Objets et décor" hint="Chaises, bancs, podiums… animés entre les formations" forceOpen={!!selectedProp}>
        <PropsEditor />
      </Collapsible>
    </>
  );
}

function PropsEditor() {
  const { doc, item } = useCurrent();
  const selectedProp = useEditor((s) => s.selectedProp);
  const readOnly = useEditor((s) => s.readOnly);
  const update = useEditor((s) => s.update);
  const props = sortedProps(doc);
  const prop = selectedProp ? doc.props[selectedProp] : null;
  const state = prop && item ? item.f.props[prop.id] : null;

  const editState = (label: string, patch: Record<string, unknown>) => {
    const fid = editableFormationId();
    if (!fid || !prop) return;
    update(label, (d) => {
      const s = d.formations[fid].props[prop.id];
      if (s) Object.assign(s, patch);
    });
  };

  const add = (shape: 'rect' | 'ellipse') => {
    let id = '';
    update('Ajouter un objet', (d) => void (id = addProp(d, shape)));
    useEditor.setState({ selectedProp: id, selected: [] });
  };

  return (
    <>
      {!readOnly && (
        <div className="row gap">
          <button className="btn small" onClick={() => add('rect')}>
            <Icon name="box" size={14} /> Rectangle
          </button>
          <button className="btn small" onClick={() => add('ellipse')}>
            <Icon name="circle" size={14} /> Rond
          </button>
        </div>
      )}
      {!props.length && <p className="hint">Aucun objet. Sur la scène, glissez un objet pour le déplacer et utilisez sa poignée pour le redimensionner.</p>}
      {props.map((p) => (
        <div key={p.id} className={`prop-row ${p.id === selectedProp ? 'on' : ''}`} onClick={() => useEditor.setState({ selectedProp: p.id, selected: [] })}>
          <Icon name={p.shape === 'rect' ? 'box' : 'circle'} size={15} />
          <span className="grow ellipsis">{p.name}</span>
          {!readOnly && <IconButton icon="trash" title="Supprimer" onClick={() => update('Supprimer l’objet', (d) => removeProp(d, p.id))} />}
        </div>
      ))}
      {prop && state && (
        <div className="subsection">
          <Tip icon="sparkles">Ces réglages valent pour la formation affichée : l’objet se déplace et change en douceur entre les formations.</Tip>
          <TextField label="Nom" value={prop.name} disabled={readOnly} onChange={(v) => update('Renommer l’objet', (d) => void (d.props[prop.id].name = v || 'Objet'))} />
          <div className="row gap">
            <NumberField label="X" suffix="m" value={state.x} step={0.1} disabled={readOnly} onChange={(x) => editState('Position de l’objet', { x })} />
            <NumberField label="Y" suffix="m" value={state.y} step={0.1} disabled={readOnly} onChange={(y) => editState('Position de l’objet', { y })} />
          </div>
          <div className="row gap">
            <NumberField label="Largeur" suffix="m" value={state.w} min={0.1} step={0.1} disabled={readOnly} onChange={(w) => editState('Taille de l’objet', { w })} />
            <NumberField label="Profondeur" suffix="m" value={state.h} min={0.1} step={0.1} disabled={readOnly} onChange={(h) => editState('Taille de l’objet', { h })} />
          </div>
          <NumberField label="Rotation" suffix="°" value={state.rotation} step={5} precision={0} disabled={readOnly} onChange={(rotation) => editState('Rotation de l’objet', { rotation })} />
          <div className="field">
            <span className="field-label">Couleur</span>
            <ColorSwatches colors={PROP_COLORS} value={state.color} onChange={(color) => !readOnly && editState('Couleur de l’objet', { color })} />
          </div>
          <Toggle checked={state.visible} onChange={(visible) => !readOnly && editState('Visibilité de l’objet', { visible })} label="Visible dans cette formation" />
          {!readOnly && (
            <button className="btn small" onClick={() => update('Appliquer à toutes les formations', (d) => void Object.values(d.formations).forEach((f) => (f.props[prop.id] = { ...state })))}>
              <Icon name="copy" size={14} /> Pareil dans toutes les formations
            </button>
          )}
        </div>
      )}
    </>
  );
}
