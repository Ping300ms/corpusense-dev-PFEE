# CorpuSense

## Dépôts

Ce projet est un fork du projet suivant :

### <https://github.com/mezanno/corpusense-dev>

---
## Objectifs

Par rapport au projet original, nous avons intégré des capacités de synchronisation avancées :

- Cloud Storage : Enregistrez et sécurisez vos collections dans le cloud.

- Sync Offline-Online : Travaillez sans connexion, vos données se synchronisent automatiquement dès le retour du réseau.

- Collaboration Temps Réel : Éditez et gérez vos documents à plusieurs simultanément.

- Partage Facilités : Système de partage de documents entre utilisateurs.

---
## Technos utilisées

En plus des technos utilisées par le projet d'origine
- Supabase : https://supabase.io/
- Dexie Observable : https://old.dexie.org/docs/Observable/Dexie.Observable

---
## Installation
### Prérequis
- node.js (version LTS moderne)
- npm
- Avoir un compte supabase : https://supabase.com/

### 1. Configuration de la Database
1. Créer un nouveau projet sur Supabase
2. Récupérez vos identifiants dans l'onglet "Project Overview" dans la section "Connect to your project" :
   - Project URL
   - Publishable API Key
3. Exécutez les scripts SQL situés dans src/deployments/ directement dans l'Éditeur SQL de votre tableau de bord Supabase pour initialiser le schéma.

### 2. Configuration locale
Créez un fichier .env à la racine du projet :
````
VITE_SUPABASE_URL={votre url de projet} 
VITE_SUPABASE_ANON_KEY={votre clé d'api anonyme}
````
### 3. Lancement
Dans un terminal à la racine du projet :
```shell
npm install
npm run dev
```

---

**Note sur l'usage** : Une fois l'application lancée, créez un compte utilisateur pour activer les fonctionnalités de synchronisation cloud.
