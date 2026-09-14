import { useState } from 'react';
import { pickColor } from '../../lib/colors';
import { db } from '../../lib/db';
import { uid } from '../../lib/id';
import type { Team, TeamMember } from '../../lib/types';
import { useLibrary } from '../../store/library';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { ColorDot, Modal } from '../common/ui';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function TeamsView({ query, onCreateChoreo }: { query: string; onCreateChoreo: (teamId: string) => void }) {
  const { teams, refresh } = useLibrary();
  const [editing, setEditing] = useState<Team | null>(null);
  const list = query ? teams.filter((t) => norm(t.name).includes(query) || t.members.some((m) => norm(m.name).includes(query))) : teams;

  return (
    <div className="lib-main padded">
      <div className="section-intro">
        <div>
          <h2>Équipes réutilisables</h2>
          <p className="hint">Enregistrez vos groupes (membres, couleurs, rôles) et réutilisez-les dans toutes vos chorégraphies.</p>
        </div>
        <button
          className="btn primary"
          onClick={() =>
            setEditing({
              id: '',
              name: '',
              updatedAt: Date.now(),
              members: Array.from({ length: 5 }, (_, i) => ({ name: `Membre ${i + 1}`, color: pickColor(i) })),
            })
          }
        >
          <Icon name="plus" /> Nouvelle équipe
        </button>
      </div>

      {!list.length && <p className="hint center">{query ? 'Aucune équipe trouvée.' : 'Aucune équipe pour le moment.'}</p>}

      <div className="cards teams">
        {list.map((t) => (
          <article key={t.id} className="card team-card">
            <div className="card-body">
              <div className="card-title">
                <h3>{t.name}</h3>
                <span className="card-meta">{t.members.length} membres</span>
              </div>
              <div className="member-chips">
                {t.members.map((m, i) => (
                  <span key={i} className="chip" title={m.group}>
                    <i style={{ background: m.color }} /> {m.name}
                  </span>
                ))}
              </div>
              <div className="row gap wrap">
                <button className="btn small primary" onClick={() => onCreateChoreo(t.id)}>
                  <Icon name="plus" size={14} /> Chorégraphie
                </button>
                <button className="btn small" onClick={() => setEditing(t)}>
                  <Icon name="settings" size={14} /> Modifier
                </button>
                <button
                  className="btn small ghost danger"
                  aria-label={`Supprimer l’équipe ${t.name}`}
                  title="Supprimer"
                  onClick={async () => {
                    if (!confirm(`Supprimer l’équipe « ${t.name} » ?`)) return;
                    await db.deleteTeam(t.id);
                    refresh();
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <TeamDialog
          team={editing}
          onClose={() => setEditing(null)}
          onSave={async (t) => {
            await db.saveTeam({ ...t, id: t.id || uid(), updatedAt: Date.now() });
            await refresh();
            setEditing(null);
            notify('Équipe enregistrée');
          }}
        />
      )}
    </div>
  );
}

export function TeamDialog({ team, onClose, onSave }: { team: Team; onClose: () => void; onSave: (t: Team) => void }) {
  const [name, setName] = useState(team.name);
  const [members, setMembers] = useState<TeamMember[]>(team.members);
  const patch = (i: number, p: Partial<TeamMember>) => setMembers(members.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return (
    <Modal
      title={team.id ? 'Modifier l’équipe' : 'Nouvelle équipe'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={!name.trim() || !members.length} onClick={() => onSave({ ...team, name: name.trim(), members })}>
            Enregistrer
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nom de l’équipe</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : Crew du mercredi" />
      </label>
      <div className="field">
        <span className="field-label">Membres ({members.length})</span>
        <div className="member-editor">
          {members.map((m, i) => (
            <div key={i} className="member-row">
              <ColorDot color={m.color} onChange={(color) => patch(i, { color })} />
              <input value={m.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Nom" />
              <input className="dim-input" value={m.group ?? ''} onChange={(e) => patch(i, { group: e.target.value || undefined })} placeholder="Rôle / section" />
              <button className="icon-btn" title="Retirer" onClick={() => setMembers(members.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn small" onClick={() => setMembers([...members, { name: `Membre ${members.length + 1}`, color: pickColor(members.length) }])}>
          <Icon name="plus" size={14} /> Ajouter un membre
        </button>
      </div>
    </Modal>
  );
}
