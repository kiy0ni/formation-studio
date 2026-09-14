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
    title: 'Démarrer en 5 minutes',
    intro: 'Le chemin le plus rapide, de la musique à la vidéo.',
    body: (
      <ol className="guide-steps">
        <li>
          Dans la bibliothèque, touchez <B>+ Nouvelle</B> (ou glissez un MP3 sur la page). Importez la musique : le tempo est détecté tout seul.
        </li>
        <li>Choisissez le nombre de membres (ou une équipe enregistrée), donnez un nom, puis <B>Créer</B>.</li>
        <li>
          Onglet <B>Placer</B> : touchez une forme (ligne, V, pyramide…). Ajustez ensuite en glissant les membres sur la scène.
        </li>
        <li>
          Lancez la musique avec <B>▶</B>, mettez pause là où la formation doit changer, puis <B>+ Formation</B>. Placez les membres : le déplacement entre les deux formations est animé automatiquement.
        </li>
        <li>Recommencez pour chaque changement de formation. Relisez tout avec ▶ pour vérifier.</li>
        <li>
          <B>Exporter → Vidéo</B> pour obtenir un MP4 avec la musique, ou <B>PDF</B> pour les fiches des danseuses.
        </li>
      </ol>
    ),
  },
  {
    id: 'place',
    icon: 'wand',
    title: 'Placer les membres',
    intro: 'Sélectionner, déplacer, formes toutes prêtes et outils.',
    body: (
      <>
        <h4>Sélectionner</h4>
        <ul>
          <li>Touchez un membre. Pour en ajouter : <K>Maj</K> + clic, ou tracez un cadre autour de plusieurs sur une zone vide.</li>
          <li>Dans <B>Placer</B>, les pastilles de couleur et de section sélectionnent tout un groupe en un clic.</li>
          <li><K>⌘A</K> sélectionne tout le monde, <K>Échap</K> désélectionne.</li>
        </ul>
        <h4>Déplacer</h4>
        <ul>
          <li>Glissez un membre (ou toute la sélection). Les membres s’accrochent à la grille ; maintenez <K>Alt</K> pour placer librement.</li>
          <li>Au clavier, les flèches décalent de 10 cm (<K>Maj</K> : 50 cm).</li>
          <li>Un seul membre sélectionné : sa position exacte et un commentaire sont modifiables dans <B>Placer</B>.</li>
        </ul>
        <h4>Formes toutes prêtes</h4>
        <ul>
          <li>8 formes sont visibles ; <B>Voir les 26 formes</B> affiche tout : lignes, quinconce, V, pyramides, cercles, arc (bow), losange, X, cœur, centre + ailes, sous-unités…</li>
          <li>Moins de 2 membres sélectionnés : la forme s’applique à tout le groupe. Sinon, seulement à la sélection.</li>
          <li><B>Espace entre les membres</B> règle l’écartement. <B>Trajets courts</B> envoie chacun à la place la plus proche ; <B>Ordre G → D</B> place Membre 1 à gauche, puis dans l’ordre.</li>
        </ul>
        <h4>Ajuster</h4>
        <p>Miroir gauche/droite, inverser avant/fond, pivoter, écarter, resserrer, aligner en ligne ou en colonne, répartir régulièrement, centrer, caler sur la grille, échanger deux membres, ou reprendre la formation précédente.</p>
      </>
    ),
  },
  {
    id: 'timeline',
    icon: 'clock',
    title: 'Formations et timeline',
    intro: 'Enchaîner, régler les durées au centième, organiser.',
    body: (
      <>
        <ul>
          <li>Chaque formation a une <b>tenue</b> (bloc plein, les membres restent en place) puis un <b>déplacement</b> (zone rayée) vers la suivante.</li>
          <li><B>+ Formation</B> (ou <K>F</K>) crée une copie de la formation à l’endroit du curseur : il ne reste qu’à déplacer les membres.</li>
          <li>
            Pour changer une durée sur la timeline, glissez la poignée ‖ située entre deux blocs : la valeur s’affiche pendant le geste et la timeline défile toute seule au bord. Avec un BPM, ça s’aimante aux temps (<K>Alt</K> pour désactiver). Glisser ailleurs fait défiler la timeline.
          </li>
          <li>Encore plus simple, surtout sur téléphone : onglet <B>Formation</B> → boutons <b>−</b> et <b>+</b> (un temps de plus ou de moins).</li>
          <li>Pour une précision au centième de seconde : onglet <B>Formation</B> → <B>Durées</B>. <B>Commencer au curseur</B> et <B>Caler sur le temps</B> recalent le début.</li>
          <li>Le bouton ⋯ d’une carte permet de dupliquer, déplacer ou supprimer la formation.</li>
          <li><B>Notes</B> : l’intention (regard, niveau, gestuelle), visible par toutes et imprimée dans le PDF.</li>
          <li><B>Style du déplacement</B> : fluide, vitesse constante, départ lent ou arrivée douce.</li>
          <li>Naviguer : touchez une carte ou un bloc, ou utilisez <K>[</K> <K>]</K>. Le curseur se déplace en touchant la règle de la timeline.</li>
          <li><K>⌘Z</K> annule n’importe quelle action (même un glisser), <K>⇧⌘Z</K> rétablit.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'music',
    icon: 'music',
    title: 'Musique et comptes',
    intro: 'Caler la chorégraphie sur les temps et répéter lentement.',
    body: (
      <ul>
        <li>Onglet <B>Musique</B> : importez ou changez la chanson. Elle est enregistrée sur l’appareil et marche hors connexion.</li>
        <li>Vous n’avez que la vidéo (MP4, MOV filmé au téléphone…) ? Importez-la directement : seul le son est récupéré.</li>
        <li>Le BPM est détecté automatiquement. Sinon : tapez en rythme sur <B>Tap tempo</B>, ou saisissez-le.</li>
        <li>Le badge rose « 3 · 5 » pendant la lecture veut dire : phrase 3, temps 5. Les repères « 8×n » apparaissent sur la timeline.</li>
        <li>Si les comptes sont décalés : placez le curseur exactement sur un « 1 » de la musique et touchez <B>Le « 1 » est ici</B>.</li>
        <li><B>Réglages avancés</B> : phrases de 4, 8 ou 16 temps, aligner toutes les formations sur les temps, tenir la dernière formation jusqu’à la fin.</li>
        <li>Pour répéter : vitesse 0,5× ou 0,75× (la hauteur de la musique est conservée), métronome, et boucle de la formation en cours (bouton ⚙ à côté de <B>+ Formation</B>).</li>
      </ul>
    ),
  },
  {
    id: 'paths',
    icon: 'route',
    title: 'Trajets, canon et croisements',
    intro: 'Contrôler précisément comment chaque membre se déplace.',
    body: (
      <ul>
        <li>Sélectionnez des membres sur une formation (pas la première), puis <B>Placer → Trajet et timing</B>.</li>
        <li><b>Droit</b>, <b>Courbe</b> (une poignée blanche à glisser) ou <b>Multi-points</b> (plusieurs points de passage). Double-clic sur un trajet : ajoute un point. <K>Alt</K> + clic sur un point : le retire.</li>
        <li><b>Canon</b> : les membres partent l’un après l’autre (gauche → droite, avant → fond, ordre de la liste). <B>Tous ensemble</B> annule.</li>
        <li>Pour un seul membre : « Part à » et « Arrive à » règlent précisément quand il bouge pendant le déplacement (0 = début, 1 = fin).</li>
        <li>Contacts : un cercle rouge clignote sur les membres trop proches, et un badge orange « croisements » en haut liste chaque moment. Touchez-en un pour y aller.</li>
      </ul>
    ),
  },
  {
    id: 'views',
    icon: 'eye',
    title: 'Voir autrement',
    intro: '3D, miroir, focus et affichage.',
    body: (
      <ul>
        <li><B>3D</B> (ou <K>V</K>) : tournez autour de la scène avec un doigt ou la souris, caméras Public, Dessus, Côté et Danseurs.</li>
        <li><B>Affichage</B> : vue danseuses (miroir, public en haut), trajets, formation précédente en pointillés, noms.</li>
        <li><b>Mode focus</b> : dans <B>Membres</B> (icône cible) ou sur un membre sélectionné. Les autres s’estompent et tout le parcours du membre est numéroté.</li>
        <li>Zoom : molette ou pincement sur la scène, bouton ⤢ pour recentrer.</li>
      </ul>
    ),
  },
  {
    id: 'members',
    icon: 'users',
    title: 'Membres et équipes',
    intro: 'Noms, couleurs, sections et groupes réutilisables.',
    body: (
      <ul>
        <li>Onglet <B>Membres</B> : renommez, touchez la pastille pour changer la couleur, indiquez une section (vocal line, dance line, unit…).</li>
        <li>Ajoutez un membre (il est placé dans toutes les formations) ou retirez-en un.</li>
        <li>Plusieurs membres sélectionnés : couleur ou section commune d’un coup.</li>
        <li><B>Équipes réutilisables</B> : enregistrez le groupe, puis réutilisez-le pour une nouvelle chorégraphie (onglet Équipes de la bibliothèque).</li>
      </ul>
    ),
  },
  {
    id: 'stage',
    icon: 'stage',
    title: 'Scène et objets',
    intro: 'Adapter à la vraie salle et ajouter du décor.',
    body: (
      <ul>
        <li>Onglet <B>Scène</B> : tailles types (salle de répét, scène standard, grande scène…) ou dimensions exactes, coulisses et fond de scène.</li>
        <li>Numéros au sol : 0 au centre, 1, 2, 3… vers les côtés, comme les repères des scènes K-pop. Jardin = gauche vu du public, cour = droite.</li>
        <li>Grille et magnétisme (pas de 25 cm, 50 cm ou 1 m), couleur du sol.</li>
        <li><B>Objets et décor</B> : rectangles et ronds (chaise, banc, podium). Glissez-les sur la scène, redimensionnez-les avec la poignée ; position, taille, rotation, couleur et visibilité changent en douceur d’une formation à l’autre.</li>
      </ul>
    ),
  },
  {
    id: 'library',
    icon: 'grid',
    title: 'Plusieurs chorégraphies',
    intro: 'Organiser, retrouver, travailler sur plusieurs projets.',
    body: (
      <ul>
        <li>La bibliothèque contient toutes vos chorégraphies, sans limite. Chacune a sa musique, ses membres et ses réglages.</li>
        <li>Rangez-les dans des <b>dossiers</b> (comeback, cover, compétition…) et utilisez la <b>recherche</b> : titre, membre, formation, musique.</li>
        <li>Dans l’éditeur, la flèche à côté du titre permet de <b>passer d’une chorégraphie à l’autre</b>, ou d’en ouvrir une dans une nouvelle fenêtre. Deux fenêtres sur la même chorégraphie restent synchronisées.</li>
        <li>Menu ⋯ d’une carte : renommer, dupliquer (pour tester une variante), déplacer, exporter, supprimer.</li>
        <li><B>Découvrir</B> : des enchaînements prêts à l’emploi à adapter.</li>
      </ul>
    ),
  },
  {
    id: 'save',
    icon: 'check',
    title: 'Sauvegarde et transfert',
    intro: 'Où sont vos données et comment les garder en sécurité.',
    body: (
      <ul>
        <li><b>Tout est enregistré automatiquement</b>, à chaque modification, sur l’appareil. L’indicateur « ✓ Enregistré » en haut le confirme. Pas besoin de bouton « sauvegarder ».</li>
        <li>L’app marche <b>sans internet</b> une fois installée.</li>
        <li>Les données restent sur l’appareil : elles ne sont pas envoyées en ligne. Pour en garder une copie ou changer d’appareil : bibliothèque → <B>Données</B> → <B>Sauvegarder toute la bibliothèque</B> (un seul fichier, musiques comprises).</li>
        <li>Sur le nouvel appareil (ex. Mac → Android) : <B>Données</B> → <B>Importer</B> et choisissez ce fichier. Les chorégraphies les plus récentes sont gardées.</li>
        <li>Conseil : faites une sauvegarde de temps en temps, et évitez de vider les données du navigateur.</li>
      </ul>
    ),
  },
  {
    id: 'export',
    icon: 'download',
    title: 'Exporter et partager',
    intro: 'Vidéo, PDF, image, fichier.',
    body: (
      <ul>
        <li><B>Vidéo</B> : MP4 avec la musique. Formats 16:9 (écran), 1:1 (Instagram) ou 9:16 (Reels, TikTok, Stories), en 720p ou 1080p, toute la chorégraphie ou juste la formation en cours.</li>
        <li><b>Vidéo d’entraînement</b> : choisissez un membre, son parcours est mis en avant. Idéal pour envoyer à chaque danseuse sa vidéo.</li>
        <li><B>PDF / impression</B> : toutes les formations avec leurs notes, puis une fiche par danseuse (positions, temps, commentaires). Choisissez « Enregistrer en PDF » dans la fenêtre d’impression.</li>
        <li><B>Image</B> : la scène affichée, en PNG.</li>
        <li><B>Partager</B> / fichier .json : envoie la chorégraphie à quelqu’un qui l’ouvrira avec <B>Données → Importer</B>.</li>
        <li>Sur téléphone, après l’export vidéo, <B>Partager</B> l’envoie directement sur WhatsApp, Instagram, etc.</li>
      </ul>
    ),
  },
  {
    id: 'phone',
    icon: 'hand',
    title: 'Sur téléphone',
    intro: 'La même app, adaptée au tactile.',
    body: (
      <ul>
        <li>Installez-la : Android (Chrome) menu ⋮ → <B>Installer l’application</B> ; iPhone (Safari) Partager → <B>Sur l’écran d’accueil</B>.</li>
        <li>La barre du bas ouvre les panneaux <B>Placer</B>, <B>Formation</B>, <B>Membres</B>, <B>Musique</B>, <B>Scène</B> par-dessus la scène. Touchez à côté ou ✕ pour fermer.</li>
        <li>Les formations défilent en bandeau sous la scène. Pincez la scène pour zoomer.</li>
        <li>Membres sélectionnés : le bouton rose « Ajuster » ouvre directement les outils.</li>
        <li>Le menu ⋯ en haut à droite regroupe l’affichage, la 3D, le partage, les exports et l’aide.</li>
      </ul>
    ),
  },
  {
    id: 'keys',
    icon: 'settings',
    title: 'Raccourcis clavier',
    intro: 'Pour aller plus vite sur ordinateur.',
    body: (
      <table className="shortcuts">
        <tbody>
          {(
            [
              ['Espace', 'Lecture / pause'],
              ['⌘Z  /  ⇧⌘Z', 'Annuler / rétablir'],
              ['F', 'Nouvelle formation au curseur'],
              ['[  ]', 'Formation précédente / suivante'],
              ['Flèches', 'Décaler la sélection'],
              ['⌘A  /  Échap', 'Tout sélectionner / désélectionner'],
              ['V · M', '2D/3D · vue miroir'],
              ['P · G · N', 'Trajets · formation précédente · noms'],
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
        <h2>Guide de Formation Studio</h2>
        <p>Tout ce que l’app sait faire, expliqué simplement. Dans l’éditeur, la visite guidée (menu Aide) montre les bases en 6 étapes.</p>
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
