# Lineup

Application web pour créer des **formations de danse K-pop synchronisées avec la musique** : placement des membres, transitions animées, trajectoires, vue 3D, collaboration en temps réel et travail hors ligne.

## Applications à télécharger (Mac, Windows, Android)

Les dernières versions sont sur **https://github.com/kiy0ni/lineup/releases/latest** (aussi accessibles depuis le bouton « Installer l'app » du site) :

| Appareil | Fichier |
| --- | --- |
| Mac avec puce Apple (M1…M4) | `Lineup-mac-apple-silicon.dmg` |
| Mac Intel | `Lineup-mac-intel.dmg` |
| Windows 10 / 11 | `Lineup-windows.exe` |
| Android | `Lineup-android.apk` |
| iPhone / iPad | le site, ajouté à l'écran d'accueil depuis Safari |

Les apps sont distribuées hors des stores, sans certificat payant : un avertissement apparaît au premier lancement (Mac : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même » ; Windows : « Informations complémentaires » → « Exécuter quand même » ; Android : autoriser l'installation depuis la source). Les apps signalent d'elles-mêmes quand une nouvelle version est publiée.

### Construire et publier une nouvelle version

1. Augmenter `version` dans `package.json` (ex. `1.2.0`).
2. `npm run build:desktop` → Mac (Apple Silicon + Intel) et Windows dans `native/release/` (Electron, `native/electron/`).
3. `npm run build:android` → APK signé dans `native/release/` (Capacitor, dossier `android/`). Nécessite le SDK Android (`brew install --cask android-commandlinetools`) et Java 21.
4. `npm run release` → publie les fichiers dans une release GitHub `v<version>`.
5. `npm run deploy` → met à jour le site.

**Clé de signature Android** : `~/.formation-studio/android-release.jks` et `android-signing.properties` (hors du dépôt). Sauvegardez ce dossier en lieu sûr : sans cette clé, les téléphones refuseront d'installer une mise à jour par-dessus l'app existante.

## Adresse

Le dépôt s'appelle **kiy0ni/lineup** (anciennement `formation-studio`). Le site est sur **https://kiy0ni.github.io/lineup/**. L'ancienne adresse `https://kiy0ni.github.io/formation-studio/` (apps installées, QR des premières affiches, liens de partage déjà envoyés) reste servie par le dépôt `kiy0ni/kiy0ni.github.io`, où `npm run deploy` publie aussi une copie de l'app. Un onglet de navigateur y part tout de suite vers `/lineup/` en gardant le lien (`#/join/…`) : même site, donc mêmes projets. Une app installée depuis l'ancienne adresse (écran d'accueil iPhone, Dock de Safari) garde ses projets à part : elle reste ouverte et explique comment les enregistrer puis les *Recevoir* à la nouvelle adresse. Ne pas recréer de dépôt nommé `formation-studio` : GitHub cesserait de rediriger les anciens liens de téléchargement vers `lineup`.

## Installer l'app (Mac, Android, iPhone)

Ouvrez **https://kiy0ni.github.io/lineup/** puis :

- **Mac – Safari** : menu *Fichier* → *Ajouter au Dock…*
- **Mac – Chrome / Edge** : icône d'installation à droite de la barre d'adresse
- **Android – Chrome** : menu ⋮ → *Installer l'application*
- **iPhone – Safari** : *Partager* → *Sur l'écran d'accueil*

Le bouton « Installer l'app » de la bibliothèque rappelle ces étapes. Une fois installée, l'app fonctionne hors ligne et se met à jour toute seule.

Les chorégraphies sont enregistrées **sur l'appareil**. Pour les transférer (ex. Mac → Android) : bibliothèque → *Données* → *Sauvegarder toute la bibliothèque*, puis sur l'autre appareil *Données* → *Importer*.

La version en ligne n'inclut pas la collaboration en temps réel (elle nécessite le serveur Node ci-dessous).

**Mettre à jour le site** : `npm run deploy` (construit l'app et la publie sur la branche `gh-pages`). Les apps déjà installées récupèrent la nouvelle version au prochain lancement avec internet.

## Comptes et synchronisation (Supabase, gratuit)

- Projet Supabase gratuit (Paris/Irlande). L’app n’embarque que l’adresse et la clé *publishable* (`src/lib/cloud.config.json`), faites pour être publiques : chaque compte ne voit que ses propres données (règles RLS dans `supabase/schema.sql`).
- Réappliquer le schéma / recréer un projet : `npm run setup:cloud` (token d’accès personnel dans `~/.formation-studio/supabase-token`, jamais commité).
- Mot de passe oublié : `npm run setup:cloud -- reset-password <email> <nouveau>`.
- Un projet gratuit se met en pause après 7 jours sans aucune activité. Anti-pause, une fois par jour sur un serveur toujours allumé :
  ```
  0 9 * * * curl -fsS -X POST "https://tjowfhkiioppzyfwlrqw.supabase.co/rest/v1/rpc/keepalive" -H "apikey: sb_publishable_2XLACOdpzS8jbDjeD1dCuQ_ZB0DL-M3" -H "content-type: application/json" -d "{}" > /dev/null
  ```

## Chorégraphies partagées (collaboration en temps réel)

- Dans l'éditeur : **Partager** → **Activer le partage**. Lien *lecture seule* pour les danseurs, lien *éditeur* pour co-éditer. Compte obligatoire pour ouvrir un lien.
- Fonctionne sur Supabase (même projet que les comptes), sans serveur : tables `rooms` / `room_members`, fonctions `create_room`, `join_room`, `room_open`, `room_push`, `rotate_room_codes`, canal temps réel privé `room:<id>` protégé par RLS, musique dans le bucket `room-audio` (voir `supabase/schema.sql`).
- Limites gratuites Supabase Realtime : 200 connexions simultanées, 2 millions de messages par mois.
- `server/index.js` (ancien serveur WebSocket) n'est plus utilisé par l'app.

## Vidéo de référence (dance practice)

- Éditeur → **Plus → Vidéo de référence** (ordinateur : bouton **Vidéo** en haut) : la vidéo défile avec la musique. Téléphone : mini-vidéo à glisser dans un coin, touchée pour l'agrandir ; ordinateur / tablette / paysage : colonne à côté de la scène. Réglages : afficher, miroir, décalage, retirer.
- La vidéo est allégée (environ 480p, sans son) et reste **sur l'appareil** (IndexedDB `fs-video`), jamais envoyée au compte ni aux partages. La chorégraphie ne garde que ses réglages (`video`).
- Export vidéo : option **Vidéo de référence** — au-dessus de la scène en 9:16 et 1:1, à côté en 16:9.
- Code dans `src/video/` (import et allègement, lecteur synchronisé, réglages, rendu de l'export).
- Les réglages (miroir, décalage) suivent sur les autres appareils et dans les chorégraphies partagées ; chacun importe la vidéo de son côté.
- Une vidéo importée comme musique est aussi gardée comme vidéo de référence (option dans la création).

## Détection automatique (bêta)

- Réglages de la vidéo de référence → **Détection automatique** :
  - **Analyser la vidéo** repère les danseurs (3 images par seconde, sur l'appareil, hors ligne une fois le moteur téléchargé), les suit dans le temps, puis propose les formations (moments où le groupe tient) et leurs timings.
  - Relecture : nombre de personnes, plus ou moins de formations, profondeur, gauche/droite, « qui danse qui » (moins de danseurs que dans la vidéo : les autres sont ignorés), échange de deux personnes confondues.
  - Appliquer **Tout**, **Positions** (garde les timings) ou **Timings** (garde les positions) : une seule étape d'annulation.
- **Placer depuis l'image** : la formation affichée prend les positions de l'image de la vidéo au curseur.
- **Voir les positions détectées** : cercles pointillés sur la scène pendant la lecture. Ils suivent la même horloge et le même placement que les formations écrites (`anchors` des `Ghosts` : calage sur les temps, centrage, repères de la grille, recentrage) : pendant une formation ils sont sur les danseurs, pendant une transition ils montrent le vrai déplacement vu dans la vidéo.
- Aucun réglage du sol à faire : la profondeur vient de la taille des danseurs (plus loin = plus petit).
- Analyse **Rapide** (3 images/s) ou **Précise** (5 images/s, conseillée). Le suivi, les vitesses, les trajets et les positions fantômes travaillent avec les instants réels des images (`times`). Essayé et écarté : des images supplémentaires autour des croisements (+90 % de temps, pas plus juste) et une empreinte MobileNet des personnes (moins bonne que les couleurs pour distinguer des tenues).
- **Centre de la scène** : « Milieu de la salle » (par défaut) — l'axe de la caméra est le centre de la scène, chacun garde sa place par rapport à la salle, y compris dans les formations décalées d'un côté ; « Décaler le centre » corrige une caméra pas tout à fait au milieu (pas de 25 cm). « Milieu du groupe » centre chaque formation sur son danseur du milieu (caméra de travers).
- Moins de danseurs que de personnes dans la vidéo : chacun garde sa place de la vidéo ; « Resserrer les danseurs gardés au centre » les rapproche (désactivé par défaut).
- Suivi des personnes : la salle vide est apprise (caméra fixe) pour décrire seulement les danseurs (cheveux, haut, bras, pantalon, chaussures) ; le suivi coupe dès que deux danseurs se croisent, puis les morceaux sont regroupés par apparence (jamais deux endroits au même moment, jamais de téléportation). Vérifié sur une vidéo étiquetée à la main (6 danseurs dont 4 en noir). Des tenues identiques restent difficiles : échange de deux personnes dans la relecture.
- Placement : distances réelles, milieu habituel du groupe au milieu de la scène, positions sur les repères de la grille (option), trajets et moments de départ/arrivée repris de la vidéo (option, mode « Tout »).

## Disposition sur ordinateur

- Les bords de la liste des formations et du panneau de réglages se glissent pour les redimensionner (taille gardée ; double-clic : taille normale).
- Avec la vidéo de référence affichée, la vidéo passe en haut de la colonne de gauche, au-dessus des formations.
- Notifications en haut de l'écran (jamais sur la timeline ni sur les boutons des fenêtres).
- Relecture → **Vérifier** : chaque personne à six moments de la vidéo ; les personnes que l'app distingue mal sont marquées « À vérifier ».
- Analyse interrompue (onglet fermé, téléphone éteint) : reprise là où elle en était. Résultats : `a:<hash>` (analyse), `m:<hash>` (résumé), `r:<hash>:<choré>` (relecture et positions appliquées, par chorégraphie) dans IndexedDB `fs-detect`, effacés avec la vidéo.
- Le moteur MediaPipe tente d'envoyer des statistiques d'usage à Google (`odml.pa.googleapis.com`) : la politique de sécurité de contenu du site le bloque, rien ne sort de l'appareil (le message dans la console du navigateur est normal).
- Moteur : MediaPipe Object Detector (EfficientDet-Lite0, `public/detect/person-detector.tflite`, 7 Mo) + WebAssembly (~11 Mo), téléchargés seulement à la première utilisation (exclus du pré-cache hors ligne). Résultats gardés par vidéo dans IndexedDB `fs-detect`.
- Code isolé dans `src/detect/` ; points d'accroche : `<DetectSection />` dans `src/video/RefVideoPanel.tsx`, `<DetectGhosts />` dans `src/components/editor/Stage2D.tsx`, filtre `vision_wasm` dans `vite.config.ts`.
- **Retirer la fonctionnalité** :
  - rapide : `AUTO_DETECT_ENABLED = false` dans `src/lib/config.ts`, puis publier ;
  - complet : revenir au repère `avant-detection-auto` (`git revert` du merge « Détection automatique », ou `git reset --hard avant-detection-auto` sur une branche), puis `npm uninstall @mediapipe/tasks-vision` si besoin.

## Alertes à l'installation (Mac, Windows, Android)

La fenêtre « Installer » reconnaît le navigateur intégré de WhatsApp / Instagram / Messenger… (impossible d'installer : ouvrir dans Safari ou Chrome, bouton pour copier le lien) et Arc (pas d'installation d'app web), affiche en clair l'étape du premier lancement sous chaque téléchargement, et propose pour Mac une commande Terminal qui installe la dernière version sans l'alerte (`macInstallCommand` dans `src/lib/install.ts`).

Les apps ne sont pas signées par Apple / Microsoft : macOS affiche « Apple n'a pas pu confirmer… », Windows « Windows a protégé votre ordinateur ». Le code est le même que le site ; c'est une question de certificat payant. L'app web installée (première option de « Installer ») n'a aucune alerte.

Tout est prêt pour signer dès que les identifiants existent, sans changer le code :

- **Mac** (compte Apple Developer, 99 €/an) : certificat « Developer ID Application » dans le trousseau du Mac, puis `APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… npm run build:desktop -- --mac` : l'app est signée, durcie et notarisée (électron-builder). Plus aucune alerte.
- **Windows** (Azure Artifact Signing, ≈ 10 $/mois, ouvert aux particuliers de l'UE avec vérification d'identité) : la signature ne marche que sur Windows, donc via GitHub Actions → workflow « Windows signé » avec les secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`. Il remplace `Lineup-windows.exe` sur la release indiquée. Gratuit possible avec SignPath Foundation si le dépôt passe sous licence open source (MIT…) avec une page « code signing policy ».
- **Android** : l'APK est déjà signé (clé dans `~/.formation-studio/`) ; l'avertissement « source inconnue » disparaît seulement via le Play Store (compte 25 $ une fois ; compte personnel : test fermé avec 12 testeurs pendant 14 jours avant publication).

## iPhone

- Le plus simple : Safari → le site → Partager → « Sur l’écran d’accueil » (gratuit, permanent, même compte).
- App native (projet `ios/`) : `npm run build:ios` ouvre Xcode ; branchez l’iPhone, choisissez votre identifiant Apple dans *Signing & Capabilities*, puis ▶. Sans compte Apple Developer (99 €/an), l’app installée expire après 7 jours et se réinstalle de la même façon.
- Vérifier que ça compile sans iPhone : `npm run build:ios -- --check`.

## Démarrage (développement)

```bash
npm install
npm run dev        # app (http://localhost:5173)
```

Production (un seul processus sert l'app et la collaboration) :

```bash
npm run build
npm start          # http://127.0.0.1:8787
npm run lan        # accessible depuis les téléphones du même réseau Wi-Fi
```

## Tests

- `npm run typecheck` puis `npm test` : tests unitaires (maths de la détection : apparence, suivi à travers un croisement, formations, trajets, grille, « qui danse qui », sol). Lancés par GitHub Actions à chaque push.
- `npm run test:e2e` : tests navigateur (voir `tests/e2e/README.md`).

## Fonctionnalités

**Prise en main**
- Nouvelle chorégraphie en 2 étapes : musique d'abord (tempo détecté, premières durées calées sur les temps), puis groupe et scène. On peut aussi glisser un MP3 sur la bibliothèque.
- Visite guidée au premier lancement, astuces contextuelles, guide complet intégré (onglet Guide et menu Aide).
- Panneaux en sections repliables expliquées : l'essentiel visible, le reste à un clic.
- Version téléphone façon app : création pas à pas, barre d'outils en bas (Formes · Formation · Membres · Objets · Plus), barre d'actions sur la sélection, timeline repliable, pincer pour zoomer.
- Objets de scène prêts à l'emploi (chaise, tabouret, banc, table, podium, écran, plateforme, micro).
- **Comptes** (e-mail + mot de passe) : bibliothèque synchronisée entre tous les appareils (chorégraphies, équipes, dossiers, musiques), hors ligne d’abord, la modification la plus récente l’emporte.
- Transfert sans compte : Bibliothèque → ⋯ → Transférer (Envoyer / Recevoir).
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
