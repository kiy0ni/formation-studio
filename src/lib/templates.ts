import { produce } from 'immer';
import { applyPreset, stagger } from './actions';
import { pickColor } from './colors';
import { createChoreo, insertFormationAfter, sortedDancers, sortedFormations } from './model';
import type { Choreo, TeamMember } from './types';

interface Step {
  preset: string;
  name: string;
  duration: number;
  transition: number;
  note?: string;
  spacing?: number;
  canon?: 'ltr' | 'rtl' | 'frontBack';
}

export interface Template {
  id: string;
  title: string;
  subtitle: string;
  members: number;
  tags: string[];
  steps: Step[];
  groups?: string[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'intro-5',
    title: 'Intro pyramide',
    subtitle: 'Ouverture classique pour 5 membres : pyramide, ligne, V puis bloc.',
    members: 5,
    tags: ['Intro', '5 membres'],
    groups: ['Leader', 'Main dancer', 'Main vocal', 'Rap', 'Maknae'],
    steps: [
      { preset: 'triangle', name: 'Pose d’ouverture', duration: 4, transition: 1.5, note: 'Tête baissée, relever sur le 8.' },
      { preset: 'line', name: 'Ligne 1er couplet', duration: 6, transition: 1.5 },
      { preset: 'v', name: 'V pré-refrain', duration: 5, transition: 1, note: 'Le center change à chaque 8.' },
      { preset: 'cluster', name: 'Bloc refrain', duration: 6, transition: 2 },
    ],
  },
  {
    id: 'chorus-7',
    title: 'Refrain 7 membres',
    subtitle: 'Quinconce lisible, V et center + ailes pour le killing part.',
    members: 7,
    tags: ['Refrain', '7 membres'],
    steps: [
      { preset: 'window', name: 'Quinconce', duration: 5, transition: 1.5 },
      { preset: 'v', name: 'V', duration: 4, transition: 1 },
      { preset: 'center-wings', name: 'Killing part', duration: 4, transition: 1.5, note: 'Center au premier plan, ailes en miroir.' },
      { preset: 'two-rows', name: 'Deux lignes', duration: 5, transition: 2 },
    ],
  },
  {
    id: 'canon-6',
    title: 'Canon en diagonale',
    subtitle: 'Déplacements décalés (effet vague) pour 6 membres.',
    members: 6,
    tags: ['Canon', '6 membres'],
    steps: [
      { preset: 'diagonal', name: 'Diagonale', duration: 4, transition: 2 },
      { preset: 'line', name: 'Vague en ligne', duration: 4, transition: 2.5, canon: 'ltr', note: 'Chaque membre part un demi-temps après le précédent.' },
      { preset: 'stairs', name: 'Escalier', duration: 4, transition: 2, canon: 'frontBack' },
      { preset: 'zigzag', name: 'Zigzag', duration: 4, transition: 2 },
    ],
  },
  {
    id: 'units-8',
    title: 'Sous-unités',
    subtitle: 'Deux groupes qui se rejoignent en cercle puis en double cercle.',
    members: 8,
    tags: ['Unit', '8 membres'],
    steps: [
      { preset: 'split', name: 'Unit A / Unit B', duration: 6, transition: 2 },
      { preset: 'circle', name: 'Cercle', duration: 4, transition: 2 },
      { preset: 'double-circle', name: 'Double cercle', duration: 4, transition: 2 },
      { preset: 'window', name: 'Final quinconce', duration: 5, transition: 2 },
    ],
  },
  {
    id: 'finale-9',
    title: 'Grand final cœur',
    subtitle: 'Grille, arc puis pose finale en cœur pour 9 membres.',
    members: 9,
    tags: ['Ending', '9 membres'],
    steps: [
      { preset: 'grid', name: 'Grille', duration: 5, transition: 2 },
      { preset: 'arc', name: 'Arc', duration: 4, transition: 2 },
      { preset: 'wedge', name: 'Flèche', duration: 4, transition: 2 },
      { preset: 'heart', name: 'Pose finale', duration: 4, transition: 2.5, note: 'Mains en cœur sur le dernier temps.' },
    ],
  },
  {
    id: 'big-13',
    title: 'Grand groupe 13',
    subtitle: 'Quinconce 3 rangs, X et pyramide inversée pour les gros groupes.',
    members: 13,
    tags: ['Grand groupe', '13 membres'],
    steps: [
      { preset: 'window', name: 'Trois rangs', duration: 6, transition: 2 },
      { preset: 'x', name: 'X', duration: 4, transition: 2 },
      { preset: 'triangle-inv', name: 'Pyramide inversée', duration: 4, transition: 2 },
      { preset: 'three-rows', name: 'Trois lignes', duration: 5, transition: 2 },
    ],
  },
  {
    id: 'solo-4',
    title: 'Solo + back',
    subtitle: 'Rotation du center pour 4 membres (chacun son moment).',
    members: 4,
    tags: ['Center', '4 membres'],
    steps: [
      { preset: 'line', name: 'Ligne', duration: 4, transition: 1.5 },
      { preset: 'center-back', name: 'Center A', duration: 4, transition: 1.5 },
      { preset: 'diamond', name: 'Losange', duration: 4, transition: 1.5 },
      { preset: 'center-back', name: 'Center B', duration: 4, transition: 1.5 },
      { preset: 'arc', name: 'Arc final', duration: 4, transition: 2 },
    ],
  },
];

export function buildTemplate(t: Template, name?: string): Choreo {
  const members: TeamMember[] = Array.from({ length: t.members }, (_, i) => ({
    name: `Membre ${i + 1}`,
    color: pickColor(i),
    group: t.groups?.[i],
  }));
  const base = createChoreo({ name: name ?? t.title, members });
  return produce(base, (d) => {
    let prev = sortedFormations(d)[0].id;
    t.steps.forEach((step, i) => {
      const fid = i === 0 ? prev : insertFormationAfter(d, prev, step.name);
      const f = d.formations[fid];
      f.name = step.name;
      f.duration = step.duration;
      f.transition = step.transition;
      f.note = step.note ?? '';
      let ids = sortedDancers(d).map((x) => x.id);
      // rotate the center for "center-back" steps so each member gets a turn
      if (step.preset === 'center-back') {
        const turn = t.steps.slice(0, i).filter((s) => s.preset === 'center-back').length;
        ids = [...ids.slice(turn % ids.length), ...ids.slice(0, turn % ids.length)];
      }
      applyPreset(d, fid, step.preset, ids, {
        spacing: step.spacing ?? 1.2,
        mode: i === 0 || step.preset === 'center-back' ? 'order' : 'nearest',
        keepCenter: false,
      });
      if (step.preset === 'center-back') {
        // "order" sorts slots by x: force the first id into the front slot
        const front = Object.entries(f.positions).reduce((a, b) => (b[1].y > a[1].y ? b : a));
        const center = ids[0];
        if (front[0] !== center) {
          const tmp = { ...f.positions[center] };
          f.positions[center] = { ...front[1] };
          f.positions[front[0]] = tmp;
        }
      }
      if (step.canon) stagger(d, fid, ids, step.canon, 0.55);
      prev = fid;
    });
  });
}
