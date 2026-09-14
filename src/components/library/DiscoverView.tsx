import { useEffect, useMemo, useState } from 'react';
import { db } from '../../lib/db';
import { formatTime, sortedFormations, totalDuration } from '../../lib/model';
import { PRESETS } from '../../lib/presets';
import { navigate } from '../../lib/router';
import { buildTemplate, TEMPLATES, type Template } from '../../lib/templates';
import type { Choreo } from '../../lib/types';
import { useLibrary } from '../../store/library';
import { FormationThumb } from '../common/FormationThumb';
import { Icon } from '../common/Icon';
import { notify } from '../common/Toast';
import { defaultMembers, createChoreo } from '../../lib/model';
import { applyPreset } from '../../lib/actions';
import { produce } from 'immer';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function DiscoverView({ query }: { query: string }) {
  const refresh = useLibrary((s) => s.refresh);
  const [members, setMembers] = useState<number | 'all'>('all');
  const built = useMemo(() => TEMPLATES.map((t) => ({ t, doc: buildTemplate(t) })), []);
  const list = built.filter(
    ({ t }) =>
      (members === 'all' || t.members === members) &&
      (!query || norm(`${t.title} ${t.subtitle} ${t.tags.join(' ')}`).includes(query)),
  );
  const counts = [...new Set(TEMPLATES.map((t) => t.members))].sort((a, b) => a - b);

  const add = async (t: Template, open: boolean) => {
    const doc = buildTemplate(t);
    await db.saveChoreo(doc);
    await refresh();
    if (open) navigate(`/c/${doc.id}`);
    else notify(`« ${t.title} » ajoutée à votre bibliothèque`);
  };

  return (
    <div className="lib-main padded">
      <div className="section-intro">
        <div>
          <h2>Idées de formations</h2>
          <p className="hint">Des enchaînements prêts à l’emploi. Ajoutez-les à votre bibliothèque en un clic et adaptez-les à votre groupe.</p>
        </div>
        <div className="count-picker small">
          <button className={members === 'all' ? 'on' : ''} onClick={() => setMembers('all')}>
            Tous
          </button>
          {counts.map((n) => (
            <button key={n} className={members === n ? 'on' : ''} onClick={() => setMembers(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="cards discover">
        {list.map(({ t, doc }) => (
          <article key={t.id} className="card">
            <div className="card-thumb">
              <AnimatedThumb doc={doc} />
            </div>
            <div className="card-body">
              <div className="card-title">
                <h3>{t.title}</h3>
              </div>
              <p className="card-meta">{t.subtitle}</p>
              <div className="member-chips">
                {t.tags.map((tag) => (
                  <span key={tag} className="chip small">
                    {tag}
                  </span>
                ))}
                <span className="chip small">
                  <Icon name="clock" size={11} /> {formatTime(totalDuration(doc), false)}
                </span>
              </div>
              <div className="row gap">
                <button className="btn small primary" onClick={() => add(t, true)}>
                  <Icon name="sparkles" size={14} /> Utiliser
                </button>
                <button className="btn small" onClick={() => add(t, false)}>
                  <Icon name="star" size={14} /> Enregistrer
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <h2 className="sub-title">Formations de base</h2>
      <p className="hint">Toutes disponibles dans l’éditeur (onglet « Placement »), applicables à tout le groupe ou à une sélection.</p>
      <PresetGallery />
    </div>
  );
}

function AnimatedThumb({ doc }: { doc: Choreo }) {
  const formations = sortedFormations(doc);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % formations.length), 1600);
    return () => clearInterval(t);
  }, [formations.length]);
  return (
    <>
      <FormationThumb doc={doc} formation={formations[i]} animate />
      <span className="thumb-caption">{formations[i]?.name}</span>
    </>
  );
}

function PresetGallery() {
  const docs = useMemo(
    () =>
      PRESETS.map((p) => {
        const base = createChoreo({ name: p.name, members: defaultMembers(7), stage: { width: 8, depth: 6 } });
        const doc = produce(base, (d) => {
          const f = sortedFormations(d)[0];
          applyPreset(d, f.id, p.id, Object.keys(d.dancers), { spacing: 1.1, mode: 'nearest', keepCenter: false });
        });
        return { p, doc };
      }),
    [],
  );
  return (
    <div className="preset-gallery">
      {docs.map(({ p, doc }) => (
        <div key={p.id} className="preset-tile" title={p.hint}>
          <FormationThumb doc={doc} formation={sortedFormations(doc)[0]} />
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}
