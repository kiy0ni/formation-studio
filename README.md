# Formation Studio

Application web pour créer des **formations de danse K-pop synchronisées avec la musique** : placement des membres, transitions animées, trajectoires, vue 3D, collaboration en temps réel et travail hors ligne.

## Applications à télécharger (Mac, Windows, Android)

Les dernières versions sont sur **https://github.com/kiy0ni/formation-studio/releases/latest** (aussi accessibles depuis le bouton « Installer l'app » du site) :

| Appareil | Fichier |
| --- | --- |
| Mac avec puce Apple (M1…M4) | `Formation-Studio-mac-apple-silicon.dmg` |
| Mac Intel | `Formation-Studio-mac-intel.dmg` |
| Windows 10 / 11 | `Formation-Studio-windows.exe` |
| Android | `Formation-Studio-android.apk` |
| iPhone / iPad | le site, ajouté à l'écran d'accueil depuis Safari |

Les apps sont distribuées hors des stores, sans certificat payant : un avertissement apparaît au premier lancement (Mac : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même » ; Windows : « Informations complémentaires » → « Exécuter quand même » ; Android : autoriser l'installation depuis la source). Les apps signalent d'elles-mêmes quand une nouvelle version est publiée.

### Construire et publier une nouvelle version

1. Augmenter `version` dans `package.json` (ex. `1.2.0`).
2. `npm run build:desktop` → Mac (Apple Silicon + Intel) et Windows dans `native/release/` (Electron, `native/electron/`).
3. `npm run build:android` → APK signé dans `native/release/` (Capacitor, dossier `android/`). Nécessite le SDK Android (`brew install --cask android-commandlinetools`) et Java 21.
4. `npm run release` → publie les fichiers dans une release GitHub `v<version>`.
5. `npm run deploy` → met à jour le site.

**Clé de signature Android** : `~/.formation-studio/android-release.jks` et `android-signing.properties` (hors du dépôt). Sauvegardez ce dossier en lieu sûr : sans cette clé, les téléphones refuseront d'installer une mise à jour par-dessus l'app existante.

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

**Prise en main**
- Nouvelle chorégraphie en 2 étapes : musique d'abord (tempo détecté, premières durées calées sur les temps), puis groupe et scène. On peut aussi glisser un MP3 sur la bibliothèque.
- Visite guidée au premier lancement, astuces contextuelles, guide complet intégré (onglet Guide et menu Aide).
- Panneaux en sections repliables expliquées : l'essentiel visible, le reste à un clic.
- Version téléphone : barre d'onglets en bas, panneau glissant par-dessus la scène, bandeau de formations, pincer pour zoomer.
- Enregistrement automatique visible (« ✓ Enregistré »), sélecteur de chorégraphies dans l'éditeur, plusieurs fenêtres synchronisées.

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
- **Export vidéo MP4 avec la musique** (menu Exporter → Vidéo) : 16:9, 1:1 ou 9:16 (Reels, TikTok), 720p ou 1080p, toute la chorégraphie ou la formation courante, vue public ou miroir, noms, trajets, comptes et notes. Option « vidéo d'entraînement » qui met en avant le parcours d'un membre. Encodage dans le navigateur (plus rapide que la lecture), sans serveur ; partage direct sur mobile.

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
