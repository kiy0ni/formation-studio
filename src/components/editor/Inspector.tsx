import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { applyPreset, stagger, swap, transform, type TransformKind } from '../../lib/actions';
import { PROP_COLORS } from '../../lib/colors';
import { db } from '../../lib/db';
import { describePos } from '../../lib/exporters';
import { r2, recenterSafe } from './inspectorUtils';
import { uid } from '../../lib/id';
import {
  addDancer,
  addProp,
  beatLength,
  formatTime,
  moveFormation,
  removeDancer,
  removeFormation,
  removeProp,
  snapTime,
  sortedDancers,
  sortedProps,
  STAGE_PRESETS,
  timeline,
  insertFormationAfter,
} from '../../lib/model';
import { PRESETS, type AssignMode, type Preset } from '../../lib/presets';
import type { Choreo, Easing, ID, PathKind } from '../../lib/types';
import { useCollisions } from '../../store/derived';
import { currentItem, useEditor, type InspectorTab } from '../../store/editor';
import { useLibrary } from '../../store/library';
import { importMusicFile, redetectBpm, useMusic } from '../../store/music';
import { playback } from '../../store/playback';
import { Icon, type IconName } from '../common/Icon';
import { notify } from '../common/Toast';
import { ColorDot, ColorSwatches, IconButton, NumberField, Section, Segmented, TextField, Toggle } from '../common/ui';

const TABS: { id: InspectorTab; icon: IconName; label: string }[] = [
  { id: 'presets', icon: 'wand', label: 'Placer' },
  { id: 'formation', icon: 'note', label: 'Formation' },
  { id: 'dancers', icon: 'users', label: 'Membres' },
  { id: 'music', icon: 'music', label: 'Musique' },
  { id: 'stage', icon: 'stage', label: 'Scène' },
  { id: 'props', icon: 'box', label: 'Objets' },
];

export function Inspector() {
  const tab = useEditor((s) => s.tab);
  const set = useEditor((s) => s.set);
  return (
    <aside className="inspector">
      <nav className="inspector-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })} title={t.label}>
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="inspector-body">
        {tab === 'presets' && <PlacementPanel />}
        {tab === 'formation' && <FormationPanel />}
        {tab === 'dancers' && <DancersPanel />}
        {tab === 'music' && <MusicPanel />}
        {tab === 'stage' && <StagePanel />}
        {tab === 'props' && <PropsPanel />}
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

function PlacementPanel() {
  const { doc, item, prev } = useCurrent();
  const selected = useEditor((s) => s.selected);
  const readOnly = useEditor((s) => s.readOnly);
  const focusDancer = useEditor((s) => s.focusDancer);
  const update = useEditor((s) => s.update);
  const opts = usePresetOpts();
  const dancers = sortedDancers(doc);
  const orderIndex = new Map(dancers.map((d, i) => [d.id, i]));
  const byOrder = (ids: ID[]) => [...ids].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  const allIds = dancers.map((d) => d.id);
  // tools act on any selection; presets need at least 2 dancers, otherwise the whole group
  const targets = byOrder(selected.length ? selected : allIds);
  const presetTargets = byOrder(selected.length >= 2 ? selected : allIds);
  const n = presetTargets.length;
  const categories = [...new Set(PRESETS.map((p) => p.category))];

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
  const pathKind: PathKind | 'mixed' = pathKinds.size === 1 ? ([...pathKinds][0] as PathKind) : 'mixed';

  const setPathKind = (kind: PathKind) =>
    run('Type de trajectoire', (d, fid) => {
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
        const c = { x: r2(mid.x + nx * off), y: r2(mid.y + ny * off) };
        z.path = kind === 'curve' ? { kind, points: [c] } : { kind, points: [c] };
      });
    });

  if (!item) return null;

  return (
    <>
      <Section
        title={selected.length ? `${selected.length} membre${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}` : 'Tout le groupe'}
        actions={
          <div className="row">
            <IconButton icon="users" title="Tout sélectionner (⌘A)" onClick={() => useEditor.getState().select(dancers.map((d) => d.id))} />
            {selected.length > 0 && <IconButton icon="close" title="Désélectionner (Échap)" onClick={() => useEditor.getState().select([])} />}
          </div>
        }
      >
        <div className="color-filter">
          {colors.map(([c, ids]) => (
            <button key={c} className="chip" onClick={(e) => pickSet(ids, e.shiftKey)} title="Sélectionner par couleur (Maj pour ajouter)">
              <i style={{ background: c }} /> {ids.length}
            </button>
          ))}
          {groups.map(([g, ids]) => (
            <button key={g} className="chip" onClick={(e) => pickSet(ids, e.shiftKey)} title="Sélectionner la section">
              <Icon name="tag" size={11} /> {g}
            </button>
          ))}
        </div>
      </Section>

      {!readOnly && (
        <Section title={`Formations prédéfinies · ${selected.length >= 2 ? `${n} sélectionnés` : `tout le groupe (${n})`}`}>
          {categories.map((cat) => (
            <div key={cat}>
              <div className="preset-cat">{cat}</div>
              <div className="preset-grid">
                {PRESETS.filter((p) => p.category === cat).map((p) => (
                  <button
                    key={p.id}
                    className="preset-btn"
                    title={p.hint ?? p.name}
                    onClick={() => run(`Formation « ${p.name} »`, (d, fid) => applyPreset(d, fid, p.id, presetTargets, opts))}
                  >
                    <PresetIcon preset={p} n={n >= 3 ? n : 6} spacing={opts.spacing} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="preset-opts">
            <label className="field">
              <span className="field-label">
                Espacement <b>{opts.spacing.toFixed(2)} m</b>
              </span>
              <input type="range" min={0.6} max={2.2} step={0.05} value={opts.spacing} onChange={(e) => usePresetOpts.setState({ spacing: Number(e.target.value) })} />
            </label>
            <div className="field">
              <span className="field-label">Qui va où ?</span>
              <Segmented
                value={opts.mode}
                onChange={(mode) => usePresetOpts.setState({ mode })}
                options={[
                  { value: 'nearest', label: 'Trajets courts', title: 'Chacun va à la place la plus proche (minimise les déplacements)' },
                  { value: 'order', label: 'Ordre G → D', title: 'Membre 1 à gauche, puis dans l’ordre de la liste' },
                ]}
              />
            </div>
            {selected.length >= 2 && selected.length < dancers.length && (
              <Toggle checked={opts.keepCenter} onChange={(keepCenter) => usePresetOpts.setState({ keepCenter })} label="Garder la sélection à sa place" />
            )}
          </div>
        </Section>
      )}

      {!readOnly && (
        <Section title="Outils">
          <div className="tool-grid">
            {(
              [
                ['mirrorX', 'flipH', 'Miroir gauche / droite'],
                ['mirrorY', 'flipV', 'Inverser avant / arrière'],
                ['rotateL', 'rotateL', 'Pivoter −15°'],
                ['rotateR', 'rotateR', 'Pivoter +15°'],
                ['spread', 'expand', 'Écarter'],
                ['tighten', 'compress', 'Resserrer'],
                ['alignH', 'alignH', 'Aligner sur une ligne'],
                ['alignV', 'alignV', 'Aligner en colonne'],
                ['distH', 'distH', 'Répartir en largeur'],
                ['distV', 'distV', 'Répartir en profondeur'],
                ['center', 'target', 'Centrer sur la scène'],
                ['snap', 'magnet', 'Caler sur la grille'],
              ] as [TransformKind, IconName, string][]
            ).map(([kind, icon, label]) => (
              <IconButton key={kind} icon={icon} title={label} onClick={() => run(label, (d, fid) => transform(d, fid, targets, kind))} />
            ))}
          </div>
          <div className="row gap wrap">
            {selected.length === 2 && (
              <button className="btn small" onClick={() => run('Échanger les places', (d, fid) => swap(d, fid, selected[0], selected[1]))}>
                <Icon name="swap" size={14} /> Échanger
              </button>
            )}
            {prev && (
              <button
                className="btn small"
                title="Reprendre les positions de la formation précédente"
                onClick={() =>
                  run('Copier la formation précédente', (d, fid) => {
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
        </Section>
      )}

      {selected.length > 0 && prev && !readOnly && (
        <Section title="Trajet d’arrivée">
          <Segmented
            value={pathKind as PathKind}
            onChange={setPathKind}
            options={[
              { value: 'linear', label: 'Droit' },
              { value: 'curve', label: 'Courbe' },
              { value: 'points', label: 'Multi-points' },
            ]}
          />
          <p className="hint">Glissez les poignées sur la scène. Double-clic sur un trajet pour ajouter un point, Alt+clic sur un point pour le retirer.</p>
          <div className="field">
            <span className="field-label">Canon (départs décalés)</span>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => run('Canon G → D', (d, fid) => stagger(d, fid, targets, 'ltr'))}>G → D</button>
              <button className="btn small" onClick={() => run('Canon D → G', (d, fid) => stagger(d, fid, targets, 'rtl'))}>D → G</button>
              <button className="btn small" onClick={() => run('Canon avant → fond', (d, fid) => stagger(d, fid, targets, 'frontBack'))}>Avant → fond</button>
              <button className="btn small" onClick={() => run('Canon par ordre', (d, fid) => stagger(d, fid, targets, 'order'))}>Ordre</button>
              <button className="btn small ghost" onClick={() => run('Réinitialiser le timing', (d, fid) => stagger(d, fid, targets, 'reset'))}>Ensemble</button>
            </div>
          </div>
          {singlePos && (
            <div className="row gap">
              <NumberField label="Départ" value={singlePos.timing?.start ?? 0} min={0} max={1} step={0.05} onChange={(v) => run('Timing', (d, fid) => {
                const p = d.formations[fid].positions[single!.id];
                p.timing = { start: Math.min(v, (p.timing?.end ?? 1) - 0.05), end: p.timing?.end ?? 1 };
              })} />
              <NumberField label="Arrivée" value={singlePos.timing?.end ?? 1} min={0} max={1} step={0.05} onChange={(v) => run('Timing', (d, fid) => {
                const p = d.formations[fid].positions[single!.id];
                p.timing = { start: p.timing?.start ?? 0, end: Math.max(v, (p.timing?.start ?? 0) + 0.05) };
              })} />
            </div>
          )}
        </Section>
      )}

      {single && singlePos && (
        <Section
          title={
            <span className="row gap">
              <i className="dot" style={{ background: single.color }} /> {single.name}
            </span>
          }
          actions={
            <IconButton
              icon="focus"
              title="Mode focus : voir tout le parcours de ce membre"
              active={focusDancer === single.id}
              onClick={() => useEditor.setState({ focusDancer: focusDancer === single.id ? null : single.id })}
            />
          }
        >
          <p className="kv">
            <span>Position</span>
            <b>{describePos(singlePos)}</b>
          </p>
          <div className="row gap">
            <NumberField label="X (m)" value={singlePos.x} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].x = v))} />
            <NumberField label="Y (m)" value={singlePos.y} step={0.1} disabled={readOnly} onChange={(v) => run('Position', (d, fid) => void (d.formations[fid].positions[single.id].y = v))} />
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
        </Section>
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
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} className="preset-svg">
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
    const delta = t - item.start;
    const newTrans = prevItem.f.transition;
    const newDur = Math.max(0, r2(prevItem.f.duration + delta));
    edit(label, (d) => {
      d.formations[prevItem.f.id].duration = newDur;
      d.formations[prevItem.f.id].transition = newTrans;
    });
    requestAnimationFrame(() => playback.seek(Math.max(0, item.start + (newDur - prevItem.f.duration))));
  };

  return (
    <>
      <Section title={`Formation ${index + 1} / ${items.length}`}>
        <TextField label="Nom" value={f.name} disabled={readOnly} onChange={(v) => edit('Renommer la formation', (d) => void (d.formations[f.id].name = v || 'Sans nom'))} />
        <p className="kv">
          <span>Début</span>
          <b>{formatTime(item.start)}</b>
          <span>Fin</span>
          <b>{formatTime(item.end)}</b>
        </p>
        <div className="row gap">
          <NumberField label="Durée (tenue)" suffix="s" value={f.duration} min={0} step={0.01} disabled={readOnly} onChange={(v) => edit('Durée de formation', (d) => void (d.formations[f.id].duration = v))} />
          <NumberField
            label="Transition"
            suffix="s"
            value={f.transition}
            min={0}
            step={0.01}
            disabled={readOnly || !next}
            onChange={(v) => edit('Durée de transition', (d) => void (d.formations[f.id].transition = v))}
          />
        </div>
        {bl && (
          <p className="hint">
            = {(f.duration / bl).toFixed(1)} temps de tenue{next ? ` + ${(f.transition / bl).toFixed(1)} temps de transition` : ''}
          </p>
        )}
        <label className="field">
          <span className="field-label">Mouvement vers la suivante</span>
          <select value={f.easing} disabled={readOnly || !next} onChange={(e) => edit('Accélération', (d) => void (d.formations[f.id].easing = e.target.value as Easing))}>
            <option value="ease">Fluide (accélère puis ralentit)</option>
            <option value="linear">Vitesse constante</option>
            <option value="easeIn">Départ lent</option>
            <option value="easeOut">Arrivée douce</option>
          </select>
        </label>
        {!readOnly && prevItem && (
          <div className="row gap wrap">
            <button className="btn small" onClick={() => alignStartTo(time, 'Caler le début sur le curseur')} disabled={time <= prevItem.start}>
              <Icon name="clock" size={14} /> Débuter au curseur
            </button>
            {bl && (
              <button className="btn small" onClick={() => alignStartTo(snapTime(doc.music, item.start, 1), 'Caler le début sur le temps')}>
                <Icon name="metronome" size={14} /> Caler sur le temps
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="Notes">
        <TextField
          multiline
          disabled={readOnly}
          placeholder="Intention, regard, niveau, gestuelle… visible par tous les danseurs"
          value={f.note}
          onChange={(v) => edit('Notes', (d) => void (d.formations[f.id].note = v))}
        />
      </Section>

      {collisions.length > 0 && (
        <Section title={<span className="warn-text"><Icon name="warning" size={14} /> Croisements</span>}>
          {collisions.map((c, i) => (
            <button
              key={i}
              className="collision-item"
              onClick={() => {
                playback.seek(c.time);
                useEditor.getState().select([c.a, c.b]);
              }}
            >
              <b>{doc.dancers[c.a]?.name}</b> × <b>{doc.dancers[c.b]?.name}</b>
              <span>
                {formatTime(c.time)} · {c.kind === 'transition' ? 'pendant la transition' : 'trop proches'}
              </span>
            </button>
          ))}
          <p className="hint">Astuce : passez le trajet en « Courbe » ou utilisez le canon pour éviter le contact.</p>
        </Section>
      )}

      {!readOnly && (
        <Section title="Actions">
          <div className="row gap wrap">
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
            <IconButton icon="up" title="Monter" disabled={!prevItem} onClick={() => edit('Monter la formation', (d) => moveFormation(d, f.id, -1))} />
            <IconButton icon="down" title="Descendre" disabled={!next} onClick={() => edit('Descendre la formation', (d) => moveFormation(d, f.id, 1))} />
            <span className="grow" />
            <button className="btn small ghost danger" disabled={items.length <= 1} onClick={() => edit('Supprimer la formation', (d) => removeFormation(d, f.id))}>
              <Icon name="trash" size={14} /> Supprimer
            </button>
          </div>
        </Section>
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
      <Section
        title={`Membres (${dancers.length})`}
        actions={
          !readOnly && (
            <button className="btn small primary" onClick={() => update('Ajouter un membre', (d) => void addDancer(d))}>
              <Icon name="plus" size={14} /> Ajouter
            </button>
          )
        }
      >
        <div className="dancer-list">
          {dancers.map((d, i) => (
            <div key={d.id} className={`dancer-row ${selected.includes(d.id) ? 'on' : ''}`}>
              <ColorDot color={d.color} onChange={(c) => !readOnly && update('Couleur', (x) => void (x.dancers[d.id].color = c))} />
              <div className="dancer-fields" onClick={(e) => toggleSelect(d.id, e.shiftKey || e.metaKey)}>
                <TextField value={d.name} disabled={readOnly} onChange={(v) => update('Renommer', (x) => void (x.dancers[d.id].name = v || `Membre ${i + 1}`))} />
                <TextField value={d.group ?? ''} placeholder="Section / rôle" disabled={readOnly} onChange={(v) => update('Section', (x) => void (x.dancers[d.id].group = v.trim() || undefined))} />
              </div>
              <div className="dancer-actions">
                <IconButton icon="focus" title="Focus sur ce membre" active={focusDancer === d.id} onClick={() => useEditor.setState({ focusDancer: focusDancer === d.id ? null : d.id })} />
                {!readOnly && (
                  <>
                    <IconButton icon="up" title="Monter" disabled={i === 0} onClick={() => moveOrder(d.id, -1)} />
                    <IconButton
                      icon="trash"
                      title="Retirer de la chorégraphie"
                      onClick={() => confirm(`Retirer ${d.name} de toutes les formations ?`) && update('Retirer un membre', (x) => removeDancer(x, d.id))}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {!readOnly && selected.length > 1 && (
        <Section title={`Modifier la sélection (${selected.length})`}>
          <div className="field">
            <span className="field-label">Couleur commune</span>
            <ColorSwatches value="" onChange={(c) => update('Couleur du groupe', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].color = c)))} />
          </div>
          <GroupNameInput onApply={(g) => update('Section du groupe', (d) => selected.forEach((id) => d.dancers[id] && (d.dancers[id].group = g || undefined)))} />
        </Section>
      )}

      <Section title="Équipes">
        <div className="row gap wrap">
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
                update(`Importer « ${t.name} »`, (d) => toAdd.forEach((m) => addDancer(d, m)));
                notify(toAdd.length ? `${toAdd.length} membre(s) ajouté(s)` : 'Tous les membres sont déjà présents');
              }}
            >
              <option value="">Ajouter depuis une équipe…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.members.length})
                </option>
              ))}
            </select>
          )}
        </div>
      </Section>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const taps = useRef<number[]>([]);
  const music = doc.music;

  const onFile = async (file: File) => {
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

  return (
    <>
      <Section title="Piste audio">
        {music.hash ? (
          <div className="music-card">
            <Icon name="music" size={20} />
            <div className="grow">
              <b className="ellipsis">{music.name}</b>
              <span>{loading ? 'Chargement…' : missing ? 'Fichier absent sur cet appareil' : `${formatTime(music.duration ?? 0)} · stockée hors ligne`}</span>
            </div>
          </div>
        ) : (
          <button className="dropzone" disabled={readOnly || busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={22} />
            <b>{busy ? 'Analyse en cours…' : 'Importer une musique'}</b>
            <span>MP3, WAV, M4A… Le tempo est détecté automatiquement.</span>
          </button>
        )}
        {!readOnly && music.hash && (
          <div className="row gap wrap">
            <button className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> {missing ? 'Réimporter' : 'Remplacer'}
            </button>
            <button className="btn small ghost danger" onClick={() => update('Retirer la musique', (d) => void (d.music = { countsPerPhrase: d.music.countsPerPhrase ?? 8, bpm: d.music.bpm, beatOffset: d.music.beatOffset }))}>
              <Icon name="trash" size={14} /> Retirer
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </Section>

      <Section title="Tempo & comptes">
        <div className="row gap">
          <NumberField label="BPM" value={music.bpm ?? 0} min={0} max={300} step={1} precision={1} disabled={readOnly} onChange={(v) => update('BPM', (d) => void (d.music.bpm = v || undefined))} />
          <NumberField
            label="1er temps"
            suffix="s"
            value={music.beatOffset ?? 0}
            min={0}
            step={0.01}
            disabled={readOnly}
            onChange={(v) => update('Décalage du premier temps', (d) => void (d.music.beatOffset = v))}
          />
        </div>
        {!readOnly && (
          <div className="row gap wrap">
            <button className="btn small tap-btn" onClick={tap} title="Tapez en rythme (4 fois ou plus)">
              <Icon name="hand" size={14} /> Tap tempo
            </button>
            {music.hash && (
              <button
                className="btn small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await redetectBpm(music.hash!);
                  setBusy(false);
                  if (r) update('Détecter le tempo', (d) => void Object.assign(d.music, { bpm: r.bpm, beatOffset: r.offset }));
                  notify(r ? `${r.bpm} BPM détectés` : 'Tempo non détecté');
                }}
              >
                <Icon name="wave" size={14} /> Détecter
              </button>
            )}
            {music.bpm ? (
              <button
                className="btn small"
                title="Le temps sous le curseur devient le « 1 »"
                onClick={() => update('Caler le 1 sur le curseur', (d) => void (d.music.beatOffset = r2(time % (60 / d.music.bpm!))))}
              >
                <Icon name="target" size={14} /> « 1 » au curseur
              </button>
            ) : null}
          </div>
        )}
        <label className="field">
          <span className="field-label">Temps par phrase</span>
          <select value={music.countsPerPhrase ?? 8} disabled={readOnly} onChange={(e) => update('Comptes', (d) => void (d.music.countsPerPhrase = Number(e.target.value)))}>
            <option value={8}>8 temps (5, 6, 7, 8 !)</option>
            <option value={4}>4 temps</option>
            <option value={16}>16 temps</option>
          </select>
        </label>
        {music.bpm ? (
          <>
            <Toggle checked={metronome} onChange={(v) => useEditor.setState({ metronome: v })} label="Métronome pendant la lecture" />
            {!readOnly && (
              <div className="row gap wrap">
                <button className="btn small" onClick={() => update('Aligner sur les temps', snapAllToBeats)}>
                  <Icon name="magnet" size={14} /> Aligner toutes les formations sur les temps
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="hint">Renseignez le BPM pour afficher la grille des temps, les comptes « 8×n » et le magnétisme sur la timeline.</p>
        )}
      </Section>

      <Section title="Lecture">
        <Segmented
          value={String(rate)}
          onChange={(v) => playback.setRate(Number(v))}
          options={['0.5', '0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v}×` }))}
        />
        {!readOnly && music.duration && (
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
            <Icon name="fit" size={14} /> Prolonger la dernière formation jusqu’à la fin
          </button>
        )}
      </Section>
    </>
  );
}

/* --------------------------------- Stage --------------------------------- */

const FLOORS = ['#1b1726', '#221c1a', '#1a2330', '#262626', '#2b1a24', '#e8e2d6'];

function StagePanel() {
  const stage = useEditor((s) => s.doc!.stage);
  const readOnly = useEditor((s) => s.readOnly);
  const audienceTop = useEditor((s) => s.audienceTop);
  const update = useEditor((s) => s.update);
  const setStage = (label: string, patch: Partial<typeof stage>) => update(label, (d) => void Object.assign(d.stage, patch));
  const presetIdx = STAGE_PRESETS.findIndex((p) => p.width === stage.width && p.depth === stage.depth);
  return (
    <>
      <Section title="Dimensions">
        <label className="field">
          <span className="field-label">Modèle</span>
          <select value={presetIdx} disabled={readOnly} onChange={(e) => {
            const p = STAGE_PRESETS[Number(e.target.value)];
            if (p) setStage('Taille de scène', { width: p.width, depth: p.depth });
          }}>
            {presetIdx < 0 && <option value={-1}>Personnalisée</option>}
            {STAGE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row gap">
          <NumberField label="Largeur" suffix="m" value={stage.width} min={2} max={40} step={0.5} precision={1} disabled={readOnly} onChange={(v) => setStage('Largeur de scène', { width: v })} />
          <NumberField label="Profondeur" suffix="m" value={stage.depth} min={2} max={30} step={0.5} precision={1} disabled={readOnly} onChange={(v) => setStage('Profondeur de scène', { depth: v })} />
        </div>
        <div className="row gap">
          <NumberField label="Coulisses (côtés)" suffix="m" value={stage.wingWidth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Coulisses', { wingWidth: v })} />
          <NumberField label="Fond de scène" suffix="m" value={stage.backstageDepth} min={0} max={6} step={0.25} disabled={readOnly} onChange={(v) => setStage('Fond de scène', { backstageDepth: v })} />
        </div>
        <NumberField label="Taille d’un danseur (diamètre)" suffix="m" value={stage.dancerSize} min={0.2} max={1.2} step={0.05} disabled={readOnly} onChange={(v) => setStage('Taille des danseurs', { dancerSize: v })} />
      </Section>
      <Section title="Repères">
        <Toggle checked={stage.showGrid} onChange={(v) => setStage('Grille', { showGrid: v })} label="Grille" />
        <Toggle checked={stage.showNumbers} onChange={(v) => setStage('Numéros de scène', { showNumbers: v })} label="Numéros au sol (0 = centre)" />
        <Toggle checked={stage.snap} onChange={(v) => setStage('Magnétisme', { snap: v })} label="Magnétisme sur la grille" />
        <label className="field">
          <span className="field-label">Pas de la grille</span>
          <Segmented
            value={String(stage.gridStep)}
            onChange={(v) => setStage('Pas de grille', { gridStep: Number(v) })}
            options={['0.25', '0.5', '1'].map((v) => ({ value: v, label: `${v.replace('.', ',')} m` }))}
          />
        </label>
        <div className="field">
          <span className="field-label">Couleur du sol</span>
          <ColorSwatches colors={FLOORS} value={stage.floorColor} onChange={(c) => setStage('Couleur du sol', { floorColor: c })} />
        </div>
      </Section>
      <Section title="Point de vue">
        <Segmented
          value={audienceTop ? 'dancers' : 'public'}
          onChange={(v) => useEditor.setState({ audienceTop: v === 'dancers' })}
          options={[
            { value: 'public', label: 'Vue public' },
            { value: 'dancers', label: 'Vue danseurs (miroir)' },
          ]}
        />
        <p className="hint">La vue danseurs place le public en haut : pratique pour répéter face au miroir.</p>
      </Section>
    </>
  );
}

/* --------------------------------- Props --------------------------------- */

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
      <Section
        title="Accessoires & décor"
        actions={
          !readOnly && (
            <div className="row">
              <IconButton icon="box" title="Ajouter un rectangle (banc, écran, podium…)" onClick={() => {
                let id = '';
                update('Ajouter un accessoire', (d) => void (id = addProp(d, 'rect')));
                useEditor.setState({ selectedProp: id, selected: [] });
              }} />
              <IconButton icon="circle" title="Ajouter un rond (chaise, plateforme…)" onClick={() => {
                let id = '';
                update('Ajouter un accessoire', (d) => void (id = addProp(d, 'ellipse')));
                useEditor.setState({ selectedProp: id, selected: [] });
              }} />
            </div>
          )
        }
      >
        {!props.length && <p className="hint">Chaises, bancs, podiums, écrans… Leur position, taille et couleur s’animent entre les formations.</p>}
        {props.map((p) => (
          <div key={p.id} className={`prop-row ${p.id === selectedProp ? 'on' : ''}`} onClick={() => useEditor.setState({ selectedProp: p.id, selected: [] })}>
            <Icon name={p.shape === 'rect' ? 'box' : 'circle'} size={15} />
            <span className="grow ellipsis">{p.name}</span>
            {!readOnly && (
              <IconButton
                icon="trash"
                title="Supprimer"
                onClick={() => {
                  update('Supprimer l’accessoire', (d) => removeProp(d, p.id));
                }}
              />
            )}
          </div>
        ))}
      </Section>

      {prop && state && (
        <Section title="Dans cette formation">
          <TextField label="Nom" value={prop.name} disabled={readOnly} onChange={(v) => update('Renommer l’accessoire', (d) => void (d.props[prop.id].name = v || 'Accessoire'))} />
          <div className="row gap">
            <NumberField label="X" suffix="m" value={state.x} step={0.1} disabled={readOnly} onChange={(x) => editState('Position de l’accessoire', { x })} />
            <NumberField label="Y" suffix="m" value={state.y} step={0.1} disabled={readOnly} onChange={(y) => editState('Position de l’accessoire', { y })} />
          </div>
          <div className="row gap">
            <NumberField label="Largeur" suffix="m" value={state.w} min={0.1} step={0.1} disabled={readOnly} onChange={(w) => editState('Taille de l’accessoire', { w })} />
            <NumberField label="Profondeur" suffix="m" value={state.h} min={0.1} step={0.1} disabled={readOnly} onChange={(h) => editState('Taille de l’accessoire', { h })} />
          </div>
          <NumberField label="Rotation" suffix="°" value={state.rotation} step={5} precision={0} disabled={readOnly} onChange={(rotation) => editState('Rotation de l’accessoire', { rotation })} />
          <div className="field">
            <span className="field-label">Couleur</span>
            <ColorSwatches colors={PROP_COLORS} value={state.color} onChange={(color) => !readOnly && editState('Couleur de l’accessoire', { color })} />
          </div>
          <Toggle checked={state.visible} onChange={(visible) => !readOnly && editState('Visibilité de l’accessoire', { visible })} label="Visible dans cette formation" />
          {!readOnly && (
            <button
              className="btn small"
              onClick={() =>
                update('Appliquer à toutes les formations', (d) => {
                  for (const f of Object.values(d.formations)) f.props[prop.id] = { ...state };
                })
              }
            >
              <Icon name="copy" size={14} /> Appliquer à toutes les formations
            </button>
          )}
        </Section>
      )}
    </>
  );
}
