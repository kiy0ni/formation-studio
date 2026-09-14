import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { applyPreset, stagger, swap, transform, type TransformKind } from '../../lib/actions';
import { PROP_COLORS } from '../../lib/colors';
import { db } from '../../lib/db';
import { describePos, exportJson } from '../../lib/exporters';
import { uid } from '../../lib/id';
import { isMediaFile, MEDIA_ACCEPT } from '../../lib/media';
import {
  addDancer,
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
import { openRoute } from '../../lib/platform';
import { PRESET_BY_ID, PRESETS, type AssignMode, type Preset } from '../../lib/presets';
import { addPropFromPreset, PROP_PRESETS } from '../../lib/propPresets';
import type { Choreo, Easing, ID, PathKind } from '../../lib/types';
import { useCollisions } from '../../store/derived';
import { currentItem, useEditor, type InspectorTab } from '../../store/editor';
import { useLibrary } from '../../store/library';
import { importMusicFile, redetectBpm, useMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { Collapsible, Tip } from '../common/Collapsible';
import { Icon, type IconName } from '../common/Icon';
import { notify } from '../common/Toast';
import { ColorDot, ColorSwatches, IconButton, NumberField, Segmented, Stepper, TextField, Toggle } from '../common/ui';
import { startTour } from './EditorPage';
import { editableFormationId, exportPng } from './editorActions';
import { r2, recenterSafe } from './inspectorUtils';

export const TABS: { id: InspectorTab; icon: IconName; label: string; phone: boolean; desktop: boolean }[] = [
  { id: 'presets', icon: 'wand', label: 'Formes', phone: true, desktop: true },
  { id: 'formation', icon: 'note', label: 'Formation', phone: true, desktop: true },
  { id: 'dancers', icon: 'users', label: 'Membres', phone: true, desktop: true },
  { id: 'props', icon: 'box', label: 'Objets', phone: true, desktop: true },
  { id: 'music', icon: 'music', label: 'Musique', phone: false, desktop: true },
  { id: 'stage', icon: 'stage', label: 'Scène', phone: false, desktop: true },
  { id: 'more', icon: 'dots', label: 'Plus', phone: true, desktop: false },
];

export function Inspector() {
  const tab = useEditor((s) => s.tab);
  const set = useEditor((s) => s.set);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const fromMore = current.id === 'music' || current.id === 'stage';
  return (
    <aside className="inspector">
      <div className="sheet-head">
        <span className="sheet-grip" />
        {fromMore && <IconButton icon="back" title="Plus" onClick={() => set({ tab: 'more' })} className="phone-back" />}
        <b>{current.label}</b>
        <span className="grow" />
        <IconButton icon="close" title="Fermer" size={18} onClick={() => set({ sheetOpen: false })} />
      </div>
      <nav className="inspector-tabs">
        {TABS.filter((t) => t.desktop).map((t) => (
          <button key={t.id} className={current.id === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })} title={t.label}>
            <Icon name={t.icon} size={17} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="inspector-body">
        {current.id === 'presets' && <PlacementPanel />}
        {current.id === 'formation' && <FormationPanel />}
        {current.id === 'dancers' && <DancersPanel />}
        {current.id === 'props' && <PropsPanel />}
        {current.id === 'music' && <MusicPanel />}
        {current.id === 'stage' && <StagePanel />}
        {current.id === 'more' && <MorePanel />}
      </div>
    </aside>
  );
}

function useCurrent() {
  const doc = useEditor((s) => s.doc!);
  const time = useEditor((s) => s.time);
  const { items, index, item } = currentItem(doc, time);
  return { doc, time, items, index, item, prev: items[index - 1], next: items[index + 1] };
}

/* --------------------------------- Formes -------------------------------- */

const usePresetOpts = create<{ spacing: number; mode: AssignMode; keepCenter: boolean }>(() => ({ spacing: 1.2, mode: 'nearest', keepCenter: true }));
const FEATURED = ['line', 'window', 'v', 'triangle', 'circle', 'arc', 'diamond', 'center-wings'];
const TOOLS: [TransformKind, IconName, string][] = [
  ['mirrorX', 'flipH', 'Miroir'],
  ['mirrorY', 'flipV', 'Avant ↔ fond'],
  ['rotateL', 'rotateL', '−15°'],
  ['rotateR', 'rotateR', '+15°'],
  ['spread', 'expand', 'Écarter'],
  ['tighten', 'compress', 'Resserrer'],
  ['alignH', 'alignH', 'Ligne'],
  ['alignV', 'alignV', 'Colonne'],
  ['distH', 'distH', 'Répartir ↔'],
  ['distV', 'distV', 'Répartir ↕'],
  ['center', 'target', 'Centrer'],
  ['snap', 'magnet', 'Grille'],
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
  const order = new Map(dancers.map((d, i) => [d.id, i]));
  const byOrder = (ids: ID[]) => [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const allIds = dancers.map((d) => d.id);
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

  const single = selected.length === 1 ? doc.dancers[selected[0]] : null;
  const singlePos = single && item ? item.f.positions[single.id] : null;
  const kinds = new Set(selected.map((id) => item?.f.positions[id]?.path?.kind ?? 'linear'));
  const pathKind = (kinds.size === 1 ? [...kinds][0] : 'linear') as PathKind;

  const setPathKind = (kind: PathKind) =>
    run('Type de trajet', (d, fid) => {
      const list = timeline(d);
      const from = list[list.findIndex((x) => x.f.id === fid) - 1]?.f;
      if (!from) return;
      selected.forEach((id, k) => {
        const a = from.positions[id];
        const z = d.formations[fid].positions[id];
        if (!a || !z) return;
        if (kind === 'linear') return void delete z.path;
        const len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
        const off = Math.max(0.6, len * 0.35) * (k % 2 ? -1 : 1);
        z.path = { kind, points: [{ x: r2((a.x + z.x) / 2 - ((z.y - a.y) / len) * off), y: r2((a.y + z.y) / 2 + ((z.x - a.x) / len) * off) }] };
      });
    });

  if (!item) return null;
  const shapes = allShapes ? PRESETS : FEATURED.map((id) => PRESET_BY_ID[id]);
  const categories = allShapes ? [...new Set(PRESETS.map((p) => p.category))] : [null];

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <b className="grow">{selected.length ? `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}` : 'Tout le groupe'}</b>
          {selected.length < dancers.length && (
            <button className="btn small ghost" onClick={() => useEditor.getState().select(allIds)}>
              Tous
            </button>
          )}
          {selected.length > 0 && (
            <button className="btn small ghost" onClick={() => useEditor.getState().select([])}>
              Aucun
            </button>
          )}
        </div>
        {((colors.length > 1 && colors.some(([, ids]) => ids.length > 1)) || groups.length > 0) && (
          <div className="color-filter">
            {colors.length > 1 &&
              colors.some(([, ids]) => ids.length > 1) &&
              colors.map(([c, ids]) => (
                <button key={c} className="chip" onClick={() => useEditor.getState().select(ids)} title="Sélectionner cette couleur">
                  <i style={{ background: c }} /> {ids.length}
                </button>
              ))}
            {groups.map(([g, ids]) => (
              <button key={g} className="chip" onClick={() => useEditor.getState().select(ids)}>
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {readOnly ? (
        <p className="hint panel-block">Lecture seule.</p>
      ) : (
        <>
          <Collapsible id="placer-shapes" icon="grid" title="Formes" hint={selected.length >= 2 ? `Sélection · ${n}` : `Groupe · ${n}`} defaultOpen>
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
              {allShapes ? 'Moins' : `Toutes les formes (${PRESETS.length})`}
            </button>
            <div className="subsection">
              <label className="field">
                <span className="field-label">
                  Espacement <b>{opts.spacing.toFixed(2).replace('.', ',')} m</b>
                </span>
                <input type="range" min={0.6} max={2.2} step={0.05} value={opts.spacing} onChange={(e) => usePresetOpts.setState({ spacing: Number(e.target.value) })} />
              </label>
              <Segmented
                value={opts.mode}
                onChange={(mode) => usePresetOpts.setState({ mode })}
                options={[
                  { value: 'nearest', label: 'Au plus près', title: 'Chacun va à la place la plus proche' },
                  { value: 'order', label: 'Dans l’ordre', title: 'Membre 1 à gauche, puis dans l’ordre' },
                ]}
              />
              {selected.length >= 2 && selected.length < dancers.length && (
                <Toggle checked={opts.keepCenter} onChange={(keepCenter) => usePresetOpts.setState({ keepCenter })} label="Rester sur place" />
              )}
            </div>
          </Collapsible>

          <Collapsible id="placer-tools" icon="wand" title="Ajuster">
            <div className="tool-grid labeled">
              {TOOLS.map(([kind, icon, label]) => (
                <button key={kind} className="tool-btn" title={label} onClick={() => run(label, (d, fid) => transform(d, fid, targets, kind))}>
                  <Icon name={icon} size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="row gap wrap">
              {selected.length === 2 && (
                <button className="btn small" onClick={() => run('Échanger', (d, fid) => swap(d, fid, selected[0], selected[1]))}>
                  <Icon name="swap" size={14} /> Échanger
                </button>
              )}
              {prev && (
                <button
                  className="btn small"
                  onClick={() =>
                    run('Comme la précédente', (d, fid) => {
                      for (const id of targets) {
                        const p = prev.f.positions[id];
                        const z = d.formations[fid].positions[id];
                        if (p && z) Object.assign(z, { x: p.x, y: p.y, path: undefined });
                      }
                    })
                  }
                >
                  <Icon name="copy" size={14} /> Comme avant
                </button>
              )}
            </div>
          </Collapsible>

          {selected.length > 0 && prev && (
            <Collapsible id="placer-path" icon="route" title="Trajet" hint="Arrivée dans cette formation">
              <Segmented
                value={pathKind}
                onChange={setPathKind}
                options={[
                  { value: 'linear', label: 'Droit' },
                  { value: 'curve', label: 'Courbe' },
                  { value: 'points', label: 'Points' },
                ]}
              />
              <span className="hint">Glissez les poignées. Double-clic : ajouter un point.</span>
              <span className="field-label">Départs décalés</span>
              <div className="row gap wrap">
                <button className="btn small" onClick={() => run('Canon', (d, fid) => stagger(d, fid, targets, 'ltr'))}>G → D</button>
                <button className="btn small" onClick={() => run('Canon', (d, fid) => stagger(d, fid, targets, 'rtl'))}>D → G</button>
                <button className="btn small" onClick={() => run('Canon', (d, fid) => stagger(d, fid, targets, 'frontBack'))}>Avant → fond</button>
                <button className="btn small ghost" onClick={() => run('Ensemble', (d, fid) => stagger(d, fid, targets, 'reset'))}>Ensemble</button>
              </div>
              {singlePos && (
                <div className="row gap">
                  <NumberField
                    label="Départ"
                    value={singlePos.timing?.start ?? 0}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => run('Timing', (d, fid) => {
                      const p = d.formations[fid].positions[single!.id];
                      p.timing = { start: Math.min(v, (p.timing?.end ?? 1) - 0.05), end: p.timing?.end ?? 1 };
                    })}
                  />
                  <NumberField
                    label="Arrivée"
                    value={singlePos.timing?.end ?? 1}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => run('Timing', (d, fid) => {
                      const p = d.formations[fid].positions[single!.id];
                      p.timing = { start: p.timing?.start ?? 0, end: Math.max(v, (p.timing?.start ?? 0) + 0.05) };
                    })}
                  />
                </div>
              )}
            </Collapsible>
          )}
        </>
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
          hint={describePos(singlePos)}
        >
          <div className="row gap">
            <NumberField label="X (m)" value={singlePos.x} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].x = v))} />
            <NumberField label="Y (m)" value={singlePos.y} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].y = v))} />
          </div>
          <TextField
            multiline
            disabled={readOnly}
            placeholder="Commentaire (regard, geste…)"
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
            <Icon name="focus" size={14} /> {focusDancer === single.id ? 'Quitter le focus' : 'Voir son parcours'}
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
  const size = Math.max(2, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + spacing;
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
  const bl = beatLength(doc.music);
  const prevItem = items[index - 1];
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');

  const alignStartTo = (t: number, label: string) => {
    if (!prevItem) return;
    const newDur = Math.max(0, r2(prevItem.f.duration + t - item.start));
    update(label, (d) => void (d.formations[prevItem.f.id].duration = newDur));
    requestAnimationFrame(() => playback.seek(Math.max(0, item.start + (newDur - prevItem.f.duration))));
  };

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <span className="step-badge">{index + 1}</span>
          <TextField value={f.name} disabled={readOnly} onChange={(v) => update('Renommer la formation', (d) => void (d.formations[f.id].name = v || 'Sans nom'))} />
        </div>
      </div>

      <Collapsible id="formation-durations" icon="clock" title="Durées" hint={`${formatTime(item.start, false)} → ${formatTime(item.end, false)}`} defaultOpen>
        <div className="row gap">
          <NumberField label="Tenue (s)" value={f.duration} min={0} step={0.01} stepper={bl ?? 0.25} disabled={readOnly} onChange={(v) => update('Durée', (d) => void (d.formations[f.id].duration = v))} />
          <NumberField label="Déplacement (s)" value={f.transition} min={0} step={0.01} stepper={bl ?? 0.25} disabled={readOnly || !next} onChange={(v) => update('Déplacement', (d) => void (d.formations[f.id].transition = v))} />
        </div>
        {bl && (
          <span className="hint">
            {fmt(f.duration / bl)} temps{next ? ` + ${fmt(f.transition / bl)} temps` : ''}
          </span>
        )}
        {!readOnly && prevItem && (
          <div className="row gap wrap">
            <button className="btn small" onClick={() => alignStartTo(time, 'Commencer ici')} disabled={time <= prevItem.start}>
              <Icon name="clock" size={14} /> Commencer au curseur
            </button>
            {bl && (
              <button className="btn small" onClick={() => alignStartTo(snapTime(doc.music, item.start, 1), 'Caler sur le temps')}>
                <Icon name="metronome" size={14} /> Sur le temps
              </button>
            )}
          </div>
        )}
      </Collapsible>

      <Collapsible id="formation-notes" icon="note" title="Notes" defaultOpen>
        <TextField multiline disabled={readOnly} placeholder="Regard, niveau, intention…" value={f.note} onChange={(v) => update('Notes', (d) => void (d.formations[f.id].note = v))} />
      </Collapsible>

      {collisions.length > 0 && (
        <div className="panel-block">
          <Tip icon="warning" warn>
            {collisions.length} contact{collisions.length > 1 ? 's' : ''} entre danseurs
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
              <span>{formatTime(c.time)}</span>
            </button>
          ))}
        </div>
      )}

      {next && (
        <Collapsible id="formation-easing" icon="route" title="Vitesse du déplacement">
          <select value={f.easing} disabled={readOnly} onChange={(e) => update('Vitesse', (d) => void (d.formations[f.id].easing = e.target.value as Easing))}>
            <option value="ease">Fluide</option>
            <option value="linear">Constante</option>
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
              update('Dupliquer', (d) => (nid = insertFormationAfter(d, f.id, `${f.name} (copie)`)));
              const it = timeline(useEditor.getState().doc!).find((x) => x.f.id === nid);
              if (it) playback.seek(it.start);
            }}
          >
            <Icon name="copy" size={14} /> Dupliquer
          </button>
          <IconButton icon="up" title="Plus tôt" disabled={!prevItem} onClick={() => update('Déplacer', (d) => moveFormation(d, f.id, -1))} />
          <IconButton icon="down" title="Plus tard" disabled={!next} onClick={() => update('Déplacer', (d) => moveFormation(d, f.id, 1))} />
          <span className="grow" />
          <button className="btn small ghost danger" disabled={items.length <= 1} onClick={() => confirm(`Supprimer « ${f.name} » ?`) && update('Supprimer', (d) => removeFormation(d, f.id))}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </>
  );
}

/* --------------------------------- Membres ------------------------------- */

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

  return (
    <>
      <div className="panel-intro">
        <div className="row gap">
          <b className="grow">{dancers.length} danseurs</b>
          {!readOnly && (
            <button className="btn small primary" onClick={() => update('Ajouter un danseur', (d) => void addDancer(d))}>
              <Icon name="plus" size={14} /> Ajouter
            </button>
          )}
        </div>
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
                <IconButton icon="focus" title="Voir son parcours" active={focusDancer === d.id} onClick={() => useEditor.setState({ focusDancer: focusDancer === d.id ? null : d.id })} />
                {!readOnly && <IconButton icon="trash" title="Retirer" onClick={() => confirm(`Retirer ${d.name} ?`) && update('Retirer un danseur', (x) => removeDancer(x, d.id))} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!readOnly && selected.length > 1 && (
        <Collapsible id="dancers-bulk" icon="users" title={`Les ${selected.length} sélectionnés`} defaultOpen>
          <ColorSwatches value="" onChange={(c) => update('Couleur', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].color = c)))} />
          <GroupNameInput onApply={(g) => update('Section', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].group = g || undefined)))} />
        </Collapsible>
      )}

      <Collapsible id="dancers-teams" icon="users" title="Équipes">
        <button
          className="btn small"
          onClick={async () => {
            await db.saveTeam({ id: uid(), name: `${doc.name} — équipe`, updatedAt: Date.now(), members: dancers.map((d) => ({ name: d.name, color: d.color, group: d.group })) });
            refresh();
            notify('Équipe enregistrée');
          }}
        >
          <Icon name="download" size={14} /> Enregistrer comme équipe
        </button>
        {!readOnly && teams.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const t = teams.find((x) => x.id === e.target.value);
              if (!t) return;
              const existing = new Set(dancers.map((d) => d.name.toLowerCase()));
              const toAdd = t.members.filter((m) => !existing.has(m.name.toLowerCase()));
              update(`Ajouter « ${t.name} »`, (d) => toAdd.forEach((m) => addDancer(d, m)));
              notify(toAdd.length ? `${toAdd.length} ajouté(s)` : 'Déjà présents');
            }}
          >
            <option value="">Ajouter une équipe…</option>
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
    <div className="row gap">
      <input value={v} placeholder="Section (ex : Vocal line)" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button className="btn small" onClick={() => onApply(v.trim())}>
        OK
      </button>
    </div>
  );
}

/* --------------------------------- Objets -------------------------------- */

function PropsPanel() {
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

  return (
    <>
      {!readOnly && (
        <div className="panel-intro">
          <b>Ajouter</b>
          <div className="prop-presets">
            {PROP_PRESETS.map((p) => (
              <button
                key={p.id}
                className="prop-preset"
                onClick={() => {
                  let id = '';
                  update(`Ajouter « ${p.name} »`, (d) => void (id = addPropFromPreset(d, p)));
                  useEditor.setState({ selectedProp: id, selected: [] });
                }}
              >
                <span className={`prop-shape ${p.shape}`} style={{ background: p.color, aspectRatio: `${Math.max(p.w, 0.5)} / ${Math.max(p.h, 0.5)}` }} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {props.length > 0 && (
        <div className="panel-block">
          {props.map((p) => (
            <div key={p.id} className={`prop-row ${p.id === selectedProp ? 'on' : ''}`} onClick={() => useEditor.setState({ selectedProp: p.id, selected: [] })}>
              <Icon name={p.shape === 'rect' ? 'box' : 'circle'} size={15} />
              <span className="grow ellipsis">{p.name}</span>
              {!readOnly && <IconButton icon="trash" title="Supprimer" onClick={() => update('Supprimer l’objet', (d) => removeProp(d, p.id))} />}
            </div>
          ))}
        </div>
      )}
      {!props.length && <p className="hint panel-block">Glissez l’objet sur la scène après l’avoir ajouté.</p>}

      {prop && state && (
        <Collapsible id="prop-edit" icon="box" title={prop.name} hint="Dans cette formation" forceOpen>
          <TextField value={prop.name} disabled={readOnly} onChange={(v) => update('Renommer', (d) => void (d.props[prop.id].name = v || 'Objet'))} />
          <div className="row gap">
            <NumberField label="Largeur (m)" value={state.w} min={0.1} step={0.1} disabled={readOnly} onChange={(w) => editState('Taille', { w })} />
            <NumberField label="Profondeur (m)" value={state.h} min={0.1} step={0.1} disabled={readOnly} onChange={(h) => editState('Taille', { h })} />
          </div>
          <NumberField label="Rotation (°)" value={state.rotation} step={15} precision={0} stepper={15} disabled={readOnly} onChange={(rotation) => editState('Rotation', { rotation })} />
          <ColorSwatches colors={PROP_COLORS} value={state.color} onChange={(color) => !readOnly && editState('Couleur', { color })} />
          <Toggle checked={state.visible} onChange={(visible) => !readOnly && editState('Visibilité', { visible })} label="Visible" />
          {!readOnly && (
            <button className="btn small" onClick={() => update('Partout pareil', (d) => void Object.values(d.formations).forEach((fm) => (fm.props[prop.id] = { ...state })))}>
              <Icon name="copy" size={14} /> Pareil partout
            </button>
          )}
        </Collapsible>
      )}
    </>
  );
}

/* --------------------------------- Musique ------------------------------- */

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
  const [stage, setStage] = useState<'extract' | 'analyze'>('analyze');
  const fileRef = useRef<HTMLInputElement>(null);
  const taps = useRef<number[]>([]);
  const music = doc.music;

  const onFile = async (file: File) => {
    if (!isMediaFile(file)) return alert('Choisissez une musique ou une vidéo.');
    setBusy(true);
    setStage('analyze');
    try {
      const { fromVideo, ...info } = await importMusicFile(file, setStage);
      update('Musique', (d) => void (d.music = { ...info, countsPerPhrase: d.music.countsPerPhrase ?? 8 }));
      notify(`${fromVideo ? 'Son de la vidéo importé' : 'Musique importée'}${info.bpm ? ` · ${info.bpm} BPM` : ''}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      alert(msg.startsWith('Cette') || msg.startsWith('Impossible') ? msg : 'Fichier illisible.');
    } finally {
      setBusy(false);
    }
  };

  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now].slice(-9);
    if (taps.current.length >= 4) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      update('BPM', (d) => void (d.music.bpm = Math.round((60000 / (iv.reduce((a, b) => a + b, 0) / iv.length)) * 10) / 10));
    }
  };

  return (
    <>
      <div className="panel-intro">
        {music.hash ? (
          <div className="music-card" onClick={() => !readOnly && fileRef.current?.click()}>
            <Icon name="music" size={20} />
            <div className="grow">
              <b className="ellipsis">{music.name}</b>
              <span>{loading ? 'Chargement…' : missing ? 'Fichier absent : réimportez' : formatTime(music.duration ?? 0, false)}</span>
            </div>
            {!readOnly && <span className="hint">Changer</span>}
          </div>
        ) : (
          <button className="dropzone" disabled={readOnly || busy} onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={24} />
            <b>{busy ? (stage === 'extract' ? 'Extraction du son…' : 'Analyse…') : 'Importer la musique'}</b>
            <span>Chanson ou vidéo</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={MEDIA_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </div>

      <Collapsible id="music-tempo" icon="metronome" title="Tempo" hint={music.bpm ? `${music.bpm} BPM` : 'Pour les comptes 5, 6, 7, 8'} defaultOpen>
        <div className="row gap">
          <NumberField label="BPM" value={music.bpm ?? 0} min={0} max={300} step={1} precision={1} disabled={readOnly} onChange={(v) => update('BPM', (d) => void (d.music.bpm = v || undefined))} />
          {!readOnly && (
            <button className="btn small tap-btn align-end" onClick={tap} title="Tapez 4 fois en rythme">
              <Icon name="hand" size={14} /> Tap
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
                if (res) update('Tempo', (d) => void Object.assign(d.music, { bpm: res.bpm, beatOffset: res.offset }));
                notify(res ? `${res.bpm} BPM` : 'Tempo non détecté');
              }}
            >
              <Icon name="wave" size={14} /> Détecter
            </button>
            {music.bpm ? (
              <button className="btn small" title="Le curseur est sur un « 1 »" onClick={() => update('Premier temps', (d) => void (d.music.beatOffset = r2(time % (60 / d.music.bpm!))))}>
                <Icon name="target" size={14} /> « 1 » ici
              </button>
            ) : null}
          </div>
        )}
      </Collapsible>

      <Collapsible id="music-advanced" icon="settings" title="Avancé">
        <div className="row gap">
          <NumberField label="1er temps (s)" value={music.beatOffset ?? 0} min={0} step={0.01} disabled={readOnly} onChange={(v) => update('Premier temps', (d) => void (d.music.beatOffset = v))} />
          <label className="field">
            <span className="field-label">Phrase</span>
            <select value={music.countsPerPhrase ?? 8} disabled={readOnly} onChange={(e) => update('Comptes', (d) => void (d.music.countsPerPhrase = Number(e.target.value)))}>
              <option value={8}>8 temps</option>
              <option value={4}>4 temps</option>
              <option value={16}>16 temps</option>
            </select>
          </label>
        </div>
        {!readOnly && music.bpm ? (
          <button className="btn small" onClick={() => update('Aligner sur les temps', snapAllToBeats)}>
            <Icon name="magnet" size={14} /> Tout caler sur les temps
          </button>
        ) : null}
      </Collapsible>

      <Collapsible id="music-playback" icon="play" title="Répétition">
        <Segmented value={String(rate)} onChange={(v) => playback.setRate(Number(v))} options={['0.5', '0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v.replace('.', ',')}×` }))} />
        {music.bpm ? <Toggle checked={metronome} onChange={(v) => useEditor.setState({ metronome: v })} label="Métronome" /> : null}
      </Collapsible>
    </>
  );
}

/* ---------------------------------- Scène -------------------------------- */

const FLOORS = ['#1b1726', '#221c1a', '#1a2330', '#262626', '#2b1a24', '#e8e2d6'];

function StagePanel() {
  const stage = useEditor((s) => s.doc!.stage);
  const readOnly = useEditor((s) => s.readOnly);
  const audienceTop = useEditor((s) => s.audienceTop);
  const update = useEditor((s) => s.update);
  const setStage = (label: string, patch: Partial<typeof stage>) => update(label, (d) => void Object.assign(d.stage, patch));
  return (
    <>
      <div className="panel-intro">
        <div className="flow-dims compact">
          <div>
            <span>Largeur (m)</span>
            <Stepper label="Largeur" value={Math.round(stage.width)} min={2} max={40} onChange={(width) => !readOnly && setStage('Largeur', { width })} />
          </div>
          <div>
            <span>Profondeur (m)</span>
            <Stepper label="Profondeur" value={Math.round(stage.depth)} min={2} max={30} onChange={(depth) => !readOnly && setStage('Profondeur', { depth })} />
          </div>
        </div>
        <div className="color-filter">
          {STAGE_PRESETS.map((p) => (
            <button key={p.label} className={`chip ${p.width === stage.width && p.depth === stage.depth ? 'on' : ''}`} disabled={readOnly} onClick={() => setStage('Taille', { width: p.width, depth: p.depth })}>
              {p.label.replace(/ \(.*\)/, '')}
            </button>
          ))}
        </div>
      </div>

      <Collapsible id="stage-marks" icon="grid" title="Repères">
        <Toggle checked={stage.showGrid} onChange={(v) => setStage('Grille', { showGrid: v })} label="Grille" />
        <Toggle checked={stage.showNumbers} onChange={(v) => setStage('Numéros', { showNumbers: v })} label="Numéros au sol" />
        <Toggle checked={stage.snap} onChange={(v) => setStage('Magnétisme', { snap: v })} label="Magnétisme" />
        <Segmented value={String(stage.gridStep)} onChange={(v) => setStage('Grille', { gridStep: Number(v) })} options={['0.25', '0.5', '1'].map((v) => ({ value: v, label: `${v.replace('.', ',')} m` }))} />
        <ColorSwatches colors={FLOORS} value={stage.floorColor} onChange={(c) => setStage('Sol', { floorColor: c })} />
      </Collapsible>

      <Collapsible id="stage-advanced" icon="settings" title="Avancé">
        <div className="row gap">
          <NumberField label="Coulisses (m)" value={stage.wingWidth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Coulisses', { wingWidth: v })} />
          <NumberField label="Fond (m)" value={stage.backstageDepth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Fond', { backstageDepth: v })} />
        </div>
        <NumberField label="Taille d’un danseur (m)" value={stage.dancerSize} min={0.2} max={1.2} step={0.05} disabled={readOnly} onChange={(v) => setStage('Taille des danseurs', { dancerSize: v })} />
        <Toggle checked={audienceTop} onChange={(v) => useEditor.setState({ audienceTop: v })} label="Vue miroir (public en haut)" />
      </Collapsible>
    </>
  );
}

/* ---------------------------------- Plus --------------------------------- */

function MorePanel() {
  const doc = useEditor((s) => s.doc!);
  const view = useEditor((s) => s.view);
  const audienceTop = useEditor((s) => s.audienceTop);
  const showPaths = useEditor((s) => s.showPaths);
  const showGhost = useEditor((s) => s.showGhost);
  const showNames = useEditor((s) => s.showNames);
  const set = useEditor((s) => s.set);

  const row = (icon: IconName, label: string, onClick: () => void, detail?: string) => (
    <button className="more-row" onClick={onClick}>
      <Icon name={icon} size={20} />
      <span className="grow">{label}</span>
      {detail && <span className="hint">{detail}</span>}
      <Icon name="chevronRight" size={16} className="muted-icon" />
    </button>
  );
  const toggle = (icon: IconName, label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="more-row">
      <Icon name={icon} size={20} />
      <span className="grow">{label}</span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );

  return (
    <div className="more">
      <div className="more-group">
        {row('music', 'Musique', () => set({ tab: 'music' }), doc.music.name)}
        {row('stage', 'Scène', () => set({ tab: 'stage' }), `${doc.stage.width} × ${doc.stage.depth} m`)}
      </div>
      <div className="more-group">
        {toggle('cube', 'Vue 3D', view === '3d', (v) => set({ view: v ? '3d' : '2d', sheetOpen: false }))}
        {toggle('mirror', 'Vue miroir', audienceTop, (v) => set({ audienceTop: v }))}
        {toggle('route', 'Trajets', showPaths, (v) => set({ showPaths: v }))}
        {toggle('ghost', 'Formation précédente', showGhost, (v) => set({ showGhost: v }))}
        {toggle('tag', 'Noms', showNames, (v) => set({ showNames: v }))}
      </div>
      <div className="more-group">
        {row('video', 'Vidéo', () => set({ dialog: 'video', sheetOpen: false }))}
        {row('print', 'PDF', () => openRoute(`/print/${doc.id}`, true))}
        {row('image', 'Image', () => (set({ sheetOpen: false }), exportPng()))}
        {row('share', 'Envoyer la chorégraphie', () => exportJson(doc))}
      </div>
      <div className="more-group">
        {row('sparkles', 'Visite guidée', () => (set({ sheetOpen: false }), startTour()))}
        {row('help', 'Guide', () => set({ dialog: 'guide', sheetOpen: false }))}
      </div>
    </div>
  );
}
