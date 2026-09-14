import { moveFormation, removeFormation, itemIndexAt, timeline, formatTime, insertFormationAfter } from '../../lib/model';
import { useCollisions } from '../../store/derived';
import { useEditor } from '../../store/editor';
import { playback } from '../../store/playback';
import { FormationThumb } from '../common/FormationThumb';
import { Icon } from '../common/Icon';
import { IconButton, Menu, MenuItem } from '../common/ui';
import { addFormationAtPlayhead } from './EditorPage';

export function FormationList() {
  const doc = useEditor((s) => s.doc!);
  const readOnly = useEditor((s) => s.readOnly);
  const index = useEditor((s) => itemIndexAt(timeline(s.doc!), s.time));
  const inTransition = useEditor((s) => {
    const items = timeline(s.doc!);
    const it = items[itemIndexAt(items, s.time)];
    return !!it && s.time > it.holdEnd && it.index < items.length - 1;
  });
  const collisions = useCollisions();
  const items = timeline(doc);
  const update = useEditor((s) => s.update);

  return (
    <aside className="formation-list">
      <div className="panel-head">
        <h3>
          Formations <em>{items.length}</em>
        </h3>
        {!readOnly && <IconButton icon="plus" title="Nouvelle formation au curseur (F)" onClick={addFormationAtPlayhead} />}
      </div>
      <div className="formation-items">
        {items.map((it) => {
          const hits = collisions.filter((c) => c.index === it.index).length;
          const active = it.index === index;
          return (
            <div
              key={it.f.id}
              className={`formation-item ${active ? 'on' : ''} ${active && inTransition ? 'leaving' : ''}`}
              onClick={() => playback.seek(it.start)}
            >
              <div className="fi-thumb">
                <FormationThumb doc={doc} formation={it.f} />
                <span className="fi-num">{it.index + 1}</span>
              </div>
              <div className="fi-body">
                <div className="fi-name ellipsis">{it.f.name}</div>
                <div className="fi-meta">
                  {formatTime(it.start)} · {it.f.duration.toFixed(2)}s
                  {it.index < items.length - 1 && <> + {it.f.transition.toFixed(2)}s</>}
                </div>
                <div className="fi-flags">
                  {it.f.note && (
                    <span title={it.f.note}>
                      <Icon name="note" size={11} />
                    </span>
                  )}
                  {hits > 0 && (
                    <span className="warn" title={`${hits} croisement(s)`}>
                      <Icon name="warning" size={11} /> {hits}
                    </span>
                  )}
                </div>
              </div>
              {!readOnly && (
                <div className="fi-actions" onClick={(e) => e.stopPropagation()}>
                  <Menu trigger={<button className="icon-btn tiny" aria-label="Actions"><Icon name="dots" size={14} /></button>}>
                    {(close) => (
                      <>
                        <MenuItem
                          icon="copy"
                          onClick={() => {
                            close();
                            let nid = '';
                            update('Dupliquer la formation', (d) => {
                              nid = insertFormationAfter(d, it.f.id, `${it.f.name} (copie)`);
                            });
                            const n = timeline(useEditor.getState().doc!).find((x) => x.f.id === nid);
                            if (n) playback.seek(n.start);
                          }}
                        >
                          Dupliquer
                        </MenuItem>
                        <MenuItem icon="up" onClick={() => (close(), update('Monter la formation', (d) => moveFormation(d, it.f.id, -1)))}>
                          Monter
                        </MenuItem>
                        <MenuItem icon="down" onClick={() => (close(), update('Descendre la formation', (d) => moveFormation(d, it.f.id, 1)))}>
                          Descendre
                        </MenuItem>
                        <MenuItem
                          icon="trash"
                          danger
                          onClick={() => {
                            close();
                            if (items.length <= 1) return;
                            update('Supprimer la formation', (d) => removeFormation(d, it.f.id));
                          }}
                        >
                          Supprimer
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <button className="add-formation" onClick={addFormationAtPlayhead}>
            <Icon name="plus" /> Ajouter une formation
          </button>
        )}
      </div>
    </aside>
  );
}
