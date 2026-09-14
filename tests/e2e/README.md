# Tests navigateur

`npm run test:e2e` construit l'app, la sert sur `http://127.0.0.1:8811/formation-studio/` et lance chaque `*.test.mjs` de ce dossier (Chromium via playwright-core : `CHROME=/chemin/vers/chrome`, sinon le Chromium de Playwright).

- `panels-test` : disposition ordinateur (panneaux redimensionnables, vidéo en colonne, notifications), petit portable, téléphone et téléphone en paysage.
- `phone-audit` : 57 écrans × 3 tailles de téléphone, rien de coupé, couvert ni trop petit. Crée un compte de test sur le service de comptes puis le supprime.
- `detect-test` : détection automatique de bout en bout sur une vraie dance practice. Il faut une vidéo : `CLIP=/chemin/video.mp4` (6 danseurs, caméra fixe, 3 min 29 ; « You da One » Dance Practice, K've Entertainment, CC BY 3.0, sur Wikimedia Commons).

`KEEP=1` garde les captures d'écran du dossier temporaire.
