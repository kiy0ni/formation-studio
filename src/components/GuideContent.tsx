import { useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './common/Icon';

interface GuideSection {
  id: string;
  icon: IconName;
  title: string;
  intro: string;
  body: ReactNode;
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;
const B = ({ children }: { children: ReactNode }) => <b className="ui-label">{children}</b>;

const SECTIONS: GuideSection[] = [
  {
    id: 'start',
    icon: 'sparkles',
    title: 'Démarrer',
    intro: 'De la musique à la vidéo.',
    body: (
      <ol className="guide-steps">
        <li>
          Touchez <B>+</B>. Choisissez le nombre de danseurs, la scène, la musique, un nom.
        </li>
        <li>
          <B>Formes</B> : touchez une forme. Puis glissez les danseurs pour ajuster.
        </li>
        <li>
          <B>▶</B> la musique, pause au changement, puis <B>+</B> sous la scène. Replacez les danseurs.
        </li>
        <li>Recommencez. Les déplacements s’animent tout seuls.</li>
        <li>
          <B>Plus → Vidéo</B> pour un MP4 avec la musique.
        </li>
      </ol>
    ),
  },
  {
    id: 'place',
    icon: 'hand',
    title: 'Sélectionner et glisser',
    intro: 'Le geste principal.',
    body: (
      <ul>
        <li>Glissez un danseur pour le déplacer.</li>
        <li>Tracez un cadre sur une zone vide pour en prendre plusieurs.</li>
        <li>
          Une barre apparaît : <B>Formes</B>, <B>Miroir</B>, <B>Ligne</B>, <B>Répartir</B>, <B>Tous</B>.
        </li>
        <li>
          <B>Formes → Ajuster</B> : pivoter, écarter, resserrer, centrer, échanger…
        </li>
        <li>
          Ordinateur : <K>Maj</K> + clic ajoute, flèches = 10 cm, <K>Alt</K> = sans grille.
        </li>
      </ul>
    ),
  },
  {
    id: 'timeline',
    icon: 'clock',
    title: 'Formations et durées',
    intro: 'Tenue, puis déplacement.',
    body: (
      <ul>
        <li>
          Bloc plein = on reste en place. Zone rayée = on se déplace.
        </li>
        <li>Glissez la poignée ‖ entre deux blocs pour changer la durée.</li>
        <li>
          Au centième : <B>Formation → Durées</B>.
        </li>
        <li>Touchez la formation active : dupliquer, renommer, déplacer, supprimer.</li>
        <li>
          La flèche ˄ à droite du lecteur masque ou affiche la timeline.
        </li>
        <li>
          <K>⌘Z</K> annule tout, même un glisser.
        </li>
      </ul>
    ),
  },
  {
    id: 'music',
    icon: 'music',
    title: 'Musique et comptes',
    intro: 'Caler sur les temps.',
    body: (
      <ul>
        <li>
          <B>Plus → Musique</B>. Une vidéo marche aussi : seul le son est gardé.
        </li>
        <li>BPM détecté tout seul. Sinon, tapez en rythme sur <B>Tap</B>.</li>
        <li>« 3 · 5 » = phrase 3, temps 5.</li>
        <li>
          Comptes décalés ? Curseur sur un « 1 », puis <B>« 1 » ici</B>.
        </li>
        <li>
          <B>Répétition</B> : vitesse 0,5×, métronome. Boucle : bouton ⚙ du lecteur.
        </li>
      </ul>
    ),
  },
  {
    id: 'paths',
    icon: 'route',
    title: 'Trajets et canon',
    intro: 'Comment chacun se déplace.',
    body: (
      <ul>
        <li>
          Sélectionnez, puis <B>Formes → Trajet</B> : droit, courbe ou points.
        </li>
        <li>Glissez les poignées blanches. Double-clic : un point de plus.</li>
        <li>
          <B>Départs décalés</B> : l’un après l’autre.
        </li>
        <li>Cercle rouge = deux danseurs trop proches.</li>
      </ul>
    ),
  },
  {
    id: 'members',
    icon: 'users',
    title: 'Membres',
    intro: 'Noms, couleurs, équipes.',
    body: (
      <ul>
        <li>
          <B>Membres</B> : nom, couleur (pastille), section.
        </li>
        <li>
          Icône cible = voir le parcours d’un seul danseur.
        </li>
        <li>
          <B>Enregistrer comme équipe</B> pour réutiliser le groupe.
        </li>
      </ul>
    ),
  },
  {
    id: 'props',
    icon: 'box',
    title: 'Objets et scène',
    intro: 'Chaises, podium, écran…',
    body: (
      <ul>
        <li>
          <B>Objets</B> : touchez un objet pour l’ajouter, puis glissez-le sur la scène.
        </li>
        <li>Taille, rotation, couleur et visibilité changent par formation.</li>
        <li>
          <B>Plus → Scène</B> : taille, grille, couleur du sol.
        </li>
        <li>0 au centre, puis 1, 2, 3 vers les côtés.</li>
      </ul>
    ),
  },
  {
    id: 'views',
    icon: 'eye',
    title: 'Affichage',
    intro: '3D, miroir, noms.',
    body: (
      <ul>
        <li>
          <B>Plus</B> (ou <B>Affichage</B> sur ordinateur) : 3D, miroir, trajets, formation précédente, noms.
        </li>
        <li>Pincez ou molette pour zoomer.</li>
      </ul>
    ),
  },
  {
    id: 'transfer',
    icon: 'cloud',
    title: 'Compte et appareils',
    intro: 'Mac, téléphone : la même bibliothèque.',
    body: (
      <ul>
        <li>
          Bibliothèque → icône <B>profil</B> → <B>Créer un compte</B> (e-mail + mot de passe).
        </li>
        <li>Même compte sur chaque appareil : chorégraphies, équipes, dossiers et musiques se synchronisent seuls.</li>
        <li>Sans internet, tout marche. La synchro reprend au retour du réseau.</li>
        <li>
          Sans compte : <B>⋯</B> → <B>Transférer</B> → <B>Envoyer</B>, puis <B>Recevoir</B> sur l’autre appareil.
        </li>
        <li>
          Une seule chorégraphie : <B>⋯</B> sur sa carte → <B>Envoyer</B>.
        </li>
        <li>
          Faire découvrir Lineup : Bibliothèque → <B>⋯</B> → <B>Partager Lineup</B> (QR code et lien).
        </li>
      </ul>
    ),
  },
  {
    id: 'share',
    icon: 'users',
    title: 'Travailler à plusieurs',
    intro: 'Prof, chorégraphes, danseurs.',
    body: (
      <ul>
        <li>
          Dans une chorégraphie : <B>Partager</B> (téléphone : <B>Plus → Partager en direct</B>) → <B>Activer le partage</B>.
        </li>
        <li>
          Lien <B>lecture seule</B> pour les danseurs, lien <B>éditeur</B> pour modifier ensemble. Copier, envoyer ou QR code.
        </li>
        <li>Chacun ouvre le lien et se connecte (compte gratuit). Tout se met à jour en direct, musique comprise.</li>
        <li>
          Le créateur voit les membres, peut retirer un accès ou créer de <B>nouveaux liens</B>.
        </li>
      </ul>
    ),
  },
  {
    id: 'export',
    icon: 'download',
    title: 'Exporter',
    intro: 'Vidéo, PDF, image.',
    body: (
      <ul>
        <li>
          <B>Vidéo</B> : MP4 avec la musique, format écran, carré ou Reels.
        </li>
        <li>
          <b>Vidéo d’entraînement</b> : le parcours d’un danseur mis en avant.
        </li>
        <li>
          <B>PDF</B> : toutes les formations + une fiche par danseur.
        </li>
        <li>
          <B>Image</B> : la scène en PNG.
        </li>
      </ul>
    ),
  },
  {
    id: 'keys',
    icon: 'settings',
    title: 'Raccourcis',
    intro: 'Sur ordinateur.',
    body: (
      <table className="shortcuts">
        <tbody>
          {(
            [
              ['Espace', 'Lecture / pause'],
              ['⌘Z  /  ⇧⌘Z', 'Annuler / rétablir'],
              ['F', 'Nouvelle formation'],
              ['[  ]', 'Formation précédente / suivante'],
              ['Flèches', 'Décaler la sélection'],
              ['⌘A  /  Échap', 'Tout / rien'],
              ['V · M', '3D · miroir'],
              ['P · G · N', 'Trajets · précédente · noms'],
              ['L · K', 'Boucle · métronome'],
            ] as const
          ).map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
];

export function GuideContent() {
  const root = useRef<HTMLDivElement>(null);
  const go = (id: string) => root.current?.querySelector(`#guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="guide" ref={root}>
      <div className="guide-hero">
        <h2>Guide</h2>
      </div>
      <nav className="guide-toc" aria-label="Sommaire">
        {SECTIONS.map((s) => (
          <button key={s.id} className="chip" onClick={() => go(s.id)}>
            <Icon name={s.icon} size={13} /> {s.title}
          </button>
        ))}
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={`guide-${s.id}`} className="guide-section">
          <header>
            <span className="collapsible-icon">
              <Icon name={s.icon} size={16} />
            </span>
            <div>
              <h3>{s.title}</h3>
              <p className="hint">{s.intro}</p>
            </div>
          </header>
          <div className="guide-body">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
