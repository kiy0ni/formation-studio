# Formation Studio

Application web pour créer des **formations de danse K-pop synchronisées avec la musique** : placement des membres, transitions animées, trajectoires, vue 3D, collaboration en temps réel et travail hors ligne.

## Installer l'app (Mac, Android, iPhone)

Ouvrez **https://kiy0ni.github.io/formation-studio/** puis :

- **Mac – Safari** : menu *Fichier* → *Ajouter au Dock…*
- **Mac – Chrome / Edge** : icône d'installation à droite de la barre d'adresse
- **Android – Chrome** : menu ⋮ → *Installer l'application*
- **iPhone – Safari** : *Partager* → *Sur l'écran d'accueil*

Le bouton « Installer l'app » de la bibliothèque rappelle ces étapes. Une fois installée, l'app fonctionne hors ligne et se met à jour toute seule.

Les chorégraphies sont enregistrées **sur l'appareil**. Pour les transférer (ex. Mac → Android) : bibliothèque → *Données* → *Sauvegarder toute la bibliothèque*, puis sur l'autre appareil *Données* → *Importer*.

La version en ligne n'inclut pas la collaboration en temps réel (elle nécessite le serveur Node ci-dessous).

**Mettre à jour le site** : `npm run deploy` (construit l'app et la publie sur la branche `gh-pages`). Les apps déjà installées récupèrent la nouvelle version au prochain lancement avec internet.

## Démarrage (développement)

```bash
npm install
npm run dev        # app (http://localhost:5173) + serveur de collaboration (port 8787)
```

Production (un seul processus sert l'app et la collaboration) :

```bash
npm run build
npm start          # http://127.0.0.1:8787
npm run lan        # accessible depuis les téléphones du même réseau Wi-Fi
```

## Fonctionnalités

**Placement**
- 26 formations prédéfinies : ligne, deux/trois lignes, quinconce, colonne, diagonale, zigzag, V, V inversé, pyramide, cercle, arc (bow), losange, X, grille, carré, double cercle, cœur, centre + ailes, groupe serré, sous-unités, escalier, flèche…
- Application à tout le groupe ou à une sélection, avec espacement réglable et attribution « trajets courts » (algorithme hongrois) ou « ordre gauche → droite ».
- Outils : miroir, rotation, écarter/resserrer, aligner, répartir, centrer, caler sur la grille, échanger deux membres.
- Glisser-déposer avec magnétisme (Alt = libre), sélection au cadre, par couleur ou par section.

**Transitions & musique**
- Durées de tenue et de transition au centième de seconde, poignées sur la timeline.
- Trajets droits, courbes ou multi-points ; canon (départs décalés) ; courbes d'accélération.
- Import audio (stocké hors ligne), forme d'onde, détection automatique du BPM, tap tempo, grille des temps et comptes « 8×n ».
- Métronome, vitesse 0,25× à 1,5×, boucle de formation, « aligner toutes les formations sur les temps ».
- Détection des croisements : danseurs trop proches pendant une formation ou une transition.

**Visualisation**
- Scène 2D avec numéros au sol (0 = centre), coulisses, fond de scène, formation précédente en transparence.
- Vue public / vue danseurs (miroir), mode focus sur un membre (parcours complet).
- Vue 3D (caméras public, dessus, côté, danseurs).
- Accessoires animés (position, taille, rotation, couleur, visibilité).

**Organisation**
- Bibliothèque avec dossiers, recherche (chorégraphies, membres, formations, équipes).
- Équipes réutilisables, onglet « Découvrir » avec des enchaînements prêts à l'emploi.
- Notes par formation, commentaire par position.
- Annuler / rétablir illimité (300 étapes).
- Export PNG, JSON, impression / PDF avec fiches individuelles par danseur.

**Collaboration**
- « Partager » crée un lien éditeur et un lien lecture seule.
- Les modifications sont synchronisées clé par clé (dernier écrit gagne) : deux personnes qui éditent des membres ou des formations différents ne s'écrasent jamais.
- Hors ligne, les modifications sont mises en file d'attente et envoyées au retour du réseau. La musique est transmise automatiquement.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `src/lib/` | Modèle, géométrie, formations prédéfinies, animation, analyse audio, stockage IndexedDB |
| `src/store/` | État de l'éditeur (Zustand + Immer), historique, horloge de lecture |
| `src/collab/` | Client de synchronisation temps réel (WebSocket, horloge logique hybride) |
| `src/components/` | Bibliothèque, éditeur (scène 2D SVG, 3D Three.js, timeline canvas), impression |
| `server/index.js` | Serveur Node : fichiers statiques, salles de collaboration, stockage audio |

Les données de collaboration sont enregistrées dans `server/data/` (modifiable avec `DATA_DIR`).

## Raccourcis

`Espace` lecture · `⌘Z / ⇧⌘Z` annuler/rétablir · `F` nouvelle formation · `[ ]` formation précédente/suivante · flèches : décaler la sélection · `V` 2D/3D · `M` vue miroir · `P G N` trajets/fantôme/noms · `L` boucle · `K` métronome.
