import { useMemo, useRef, useState } from 'react';
import { formatTime, insertFormationAfter, itemIndexAt, moveFormation, removeFormation, timeline } from '../../lib/model';
import { useCollisions } from '../../store/derived';
import { useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { FormationThumb } from '../common/FormationThumb';
import { Icon } from '../common/Icon';
import { Floating, MenuItem } from '../common/ui';
import { RenameDialog } from '../library/LibraryPage';
import { addFormationAtPlayhead } from './EditorPage';

export function FormationList() {
  const doc = useEditor((s) => s.doc!);
  const readOnly = useEditor((s) => s.readOnly);
  const update = useEditor((s) => s.update);
  const index = useEditor((s) => itemIndexAt(timeline(s.doc!), s.time));
  const collisions = useCollisions();
  const items = timeline(doc);
  const anchors = useRef(new Map<string, HTMLElement>());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const anchor = useMemo(() => ({ current: menuFor ? (anchors.current.get(menuFor) ?? null) : null }), [menuFor]);
  const menuItem = items.find((it) => it.f.id === menuFor);
  const close = () => setMenuFor(null);

  const goTo = (id: string) => {
    const it = timeline(useEditor.getState().doc!).find((x) => x.f.id === id);
    if (it) playback.seek(it.start);
  };

  return (
    <aside className="formation-list">
      <div className="panel-head">
        <h3>
          Formations <em>{items.length}</em>
        </h3>
      </div>
      <div className="formation-items">
        {items.map((it) => {
          const active = it.index === index;
          const hits = collisions.some((c) => c.index === it.index);
          return (
            <div
              key={it.f.id}
              ref={(el) => {
                if (el) anchors.current.set(it.f.id, el);
                else anchors.current.delete(it.f.id);
              }}
              className={`formation-item ${active ? 'on' : ''}`}
              title={active && !readOnly ? 'Toucher pour les options' : it.f.name}
              onClick={() => (active && !readOnly ? setMenuFor(it.f.id) : playback.seek(it.start))}
            >
              <div className="fi-thumb">
                <FormationThumb doc={doc} formation={it.f} />
                <span className="fi-num">{it.index + 1}</span>
                {hits && <span className="fi-warn" title="Contact entre danseurs" />}
              </div>
              <div className="fi-body">
                <div className="fi-name ellipsis">{it.f.name}</div>
                <div className="fi-meta">
                  {formatTime(it.start, false)} · {it.f.duration.toFixed(1).replace('.', ',')} s
                </div>
              </div>
              {active && !readOnly && <Icon name="dots" size={14} className="fi-more" />}
            </div>
          );
        })}
        {!readOnly && (
          <button className="add-formation" onClick={addFormationAtPlayhead} aria-label="Ajouter une formation" title="Ajouter une formation (F)">
            <Icon name="plus" size={24} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {menuFor && menuItem && (
        <Floating anchor={anchor} onClose={close} align="left" direction="down" className="menu">
          <div className="menu-sep">{menuItem.f.name}</div>
          <MenuItem
            icon="copy"
            onClick={() => {
              close();
              let nid = '';
              update('Dupliquer la formation', (d) => (nid = insertFormationAfter(d, menuItem.f.id, `${menuItem.f.name} (copie)`)));
              goTo(nid);
            }}
          >
            Dupliquer
          </MenuItem>
          <MenuItem icon="text" onClick={() => (close(), setRenaming(menuItem.f.id))}>
            Renommer
          </MenuItem>
          <MenuItem icon="note" onClick={() => (close(), useEditor.setState({ tab: 'formation', sheetOpen: true }))}>
            Durées et notes
          </MenuItem>
          {menuItem.index > 0 && (
            <MenuItem icon="back" onClick={() => (close(), update('Déplacer la formation', (d) => moveFormation(d, menuItem.f.id, -1)), requestAnimationFrame(() => goTo(menuItem.f.id)))}>
              Plus tôt
            </MenuItem>
          )}
          {menuItem.index < items.length - 1 && (
            <MenuItem icon="chevronRight" onClick={() => (close(), update('Déplacer la formation', (d) => moveFormation(d, menuItem.f.id, 1)), requestAnimationFrame(() => goTo(menuItem.f.id)))}>
              Plus tard
            </MenuItem>
          )}
          {items.length > 1 && (
            <MenuItem icon="trash" danger onClick={() => (close(), update('Supprimer la formation', (d) => removeFormation(d, menuItem.f.id)))}>
              Supprimer
            </MenuItem>
          )}
        </Floating>
      )}

      {renaming && (
        <RenameDialog
          value={doc.formations[renaming]?.name ?? ''}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            const id = renaming;
            update('Renommer la formation', (d) => {
              if (d.formations[id]) d.formations[id].name = name;
            });
            setRenaming(null);
          }}
        />
      )}
    </aside>
  );
}
