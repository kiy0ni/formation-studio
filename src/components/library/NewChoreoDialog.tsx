import { useState } from 'react';
import { createChoreo, defaultMembers, STAGE_PRESETS } from '../../lib/model';
import type { Choreo, Folder, Team } from '../../lib/types';
import { Icon } from '../common/Icon';
import { Modal, NumberField, Segmented } from '../common/ui';

export function NewChoreoDialog({
  teams,
  folders,
  initialTeamId,
  initialFolderId,
  onClose,
  onCreate,
}: {
  teams: Team[];
  folders: Folder[];
  initialTeamId?: string;
  initialFolderId: string | null;
  onClose: () => void;
  onCreate: (doc: Choreo) => void;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<'count' | 'team'>(initialTeamId ? 'team' : 'count');
  const [count, setCount] = useState(5);
  const [teamId, setTeamId] = useState(initialTeamId ?? teams[0]?.id ?? '');
  const [stageIdx, setStageIdx] = useState(1);
  const [width, setWidth] = useState(10);
  const [depth, setDepth] = useState(8);
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);

  const team = teams.find((t) => t.id === teamId);
  const members = source === 'team' && team ? team.members : defaultMembers(count);

  const create = () => {
    const doc = createChoreo({
      name: name.trim() || (team && source === 'team' ? `${team.name} — nouvelle choré` : 'Nouvelle chorégraphie'),
      members,
      stage: { width, depth },
      folderId,
    });
    onCreate(doc);
  };

  return (
    <Modal
      title="Nouvelle chorégraphie"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" onClick={create} disabled={!members.length}>
            <Icon name="sparkles" /> Créer
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Titre</span>
        <input autoFocus placeholder="ex : Cover « Supernova » — refrain" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
      </label>

      <div className="field">
        <span className="field-label">Membres</span>
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'count', label: 'Nombre de membres' },
            { value: 'team', label: `Équipe enregistrée${teams.length ? '' : ' (aucune)'}` },
          ]}
        />
      </div>

      {source === 'count' ? (
        <div className="field">
          <div className="count-picker">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].map((n) => (
              <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
            <NumberField value={count} onChange={(v) => setCount(Math.round(v))} min={1} max={40} step={1} precision={0} />
          </div>
        </div>
      ) : teams.length ? (
        <div className="field">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.members.length})
              </option>
            ))}
          </select>
          {team && (
            <div className="member-chips">
              {team.members.map((m, i) => (
                <span key={i} className="chip" style={{ borderColor: m.color }}>
                  <i style={{ background: m.color }} /> {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="hint">Créez une équipe dans l’onglet « Équipes » pour la réutiliser ici.</p>
      )}

      <div className="field">
        <span className="field-label">Scène</span>
        <select
          value={stageIdx}
          onChange={(e) => {
            const i = Number(e.target.value);
            setStageIdx(i);
            if (STAGE_PRESETS[i]) {
              setWidth(STAGE_PRESETS[i].width);
              setDepth(STAGE_PRESETS[i].depth);
            }
          }}
        >
          {STAGE_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
          <option value={-1}>Personnalisée</option>
        </select>
        <div className="row gap">
          <NumberField label="Largeur" value={width} onChange={(v) => (setWidth(v), setStageIdx(-1))} min={2} max={40} step={0.5} suffix="m" precision={1} />
          <NumberField label="Profondeur" value={depth} onChange={(v) => (setDepth(v), setStageIdx(-1))} min={2} max={30} step={0.5} suffix="m" precision={1} />
        </div>
      </div>

      {folders.length > 0 && (
        <label className="field">
          <span className="field-label">Dossier</span>
          <select value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
            <option value="">Sans dossier</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </Modal>
  );
}
