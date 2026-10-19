# Audit du PWA Trabad Commercial — 14 octobre 2026

## Périmètre

Revue statique du PWA, de ses appels Supabase, de l'authentification, des politiques CRM dans les migrations Loc Manager, des composants et des styles responsive. Validation par TypeScript, build Next.js et `npm audit`. Cette revue ne remplace ni un test de charge, ni un audit d'intrusion, ni un test visuel connecté sur appareil réel.

## Correctifs appliqués

| Domaine | Constat | Correctif |
| --- | --- | --- |
| Sécurité | Next.js 16.0.7 présentait des alertes de sécurité critiques et élevées. | Mise à jour vers Next.js 16.4.0 et régénération du verrou de dépendances. |
| Sécurité | Les réponses n'explicitaient pas la protection contre l'intégration en iframe et la détection MIME. | En-têtes `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et `Cache-Control: no-store` sur les routes sensibles. |
| Connexion | Les entrées de connexion n'avaient pas de limite de longueur et une réponse de connexion absente pouvait déclencher une redirection. | Limites côté interface et serveur, contrôle explicite du résultat de connexion. |
| Réseau | Une modification d'étape, un GPS ou une nouvelle tâche rechargeaient inutilement les trois grandes collections CRM. | Actualisation ciblée ; les changements d'étape et de GPS mettent à jour l'état local après confirmation serveur. |
| Réseau | La gestion avancée rechargeait les statistiques de performance pour obtenir seulement la liste des agents. | Réutilisation de la liste d'agents déjà chargée par l'application. |
| Réseau | Des réponses de chargements concurrents pouvaient rétablir des données anciennes. | Versions de requêtes distinctes pour contacts, dossiers, tâches, localités et accès. |
| Données | La vue rapide s'arrêtait silencieusement aux 500 derniers dossiers. | Chargement progressif par pages de 500, indication du périmètre chargé et récupération des contacts manquants. |
| Données | La recherche de doublons téléphoniques ne vérifiait que les contacts déjà chargés. | Vérification différée côté Supabase sur le numéro normalisé, sous les mêmes politiques RLS. |
| Rendu | La liste mobile et le tableau desktop de 500 dossiers étaient tous deux montés, même lorsque l'un était masqué. | Un seul rendu selon la largeur de l'écran ; filtre des dossiers mémorisé entre les autres mises à jour. |
| UI/UX | Les grands tableaux du responsable étaient difficiles à utiliser sur téléphone ou tablette. | Cartes dédiées aux agents et aux dossiers ; tableaux réservés au desktop. |
| Robustesse | Plusieurs erreurs réseau pouvaient laisser un bouton bloqué ou afficher « aucun agent » après un échec. | Gestion des exceptions, libération des états de chargement et distinction entre vide et erreur. |
| Accessibilité | Le fond restait défilable derrière les dialogues, et la visibilité du focus clavier était inégale. | Verrouillage du défilement pendant les dialogues et focus visible harmonisé. |

## Points à poursuivre

1. **Connexion :** prévoir une limitation distribuée des tentatives d'authentification au niveau de l'hébergement ou d'un stockage partagé. Un compteur en mémoire dans Next.js ne serait pas fiable avec plusieurs instances.
2. **Recherche exhaustive :** la vue rapide filtre les pages déjà chargées. Pour une recherche instantanée sur tout le portefeuille, remplacer ce filtre par une recherche paginée côté serveur ; le responsable dispose déjà de la gestion avancée paginée.
3. **Très gros portefeuilles :** le chargement progressif évite le transfert initial complet, mais l'accumulation de milliers de cartes dans la même vue peut finir par coûter cher. Prévoir une pagination visible ou une virtualisation si ce volume devient courant.
4. **Hors connexion :** le PWA est installable, mais n'enregistre pas d'actions hors ligne. Il faut concevoir une file de synchronisation et une résolution des conflits avant de promettre ce comportement.
5. **Validation :** ajouter des tests des parcours sensibles et mesurer les Web Vitals sur de vrais appareils et comptes de test. Le projet ne possède pas actuellement de suite de tests automatisés.

Les contrôles de lecture/écriture du CRM sont aussi appliqués par les politiques RLS et les fonctions SQL ; les règles de rôle ne doivent jamais dépendre uniquement des boutons du PWA.

## Vérifications finales

- `npm run typecheck` : réussi.
- `npm run build` : réussi avec Next.js 16.4.0.
- `npm audit --omit=dev --audit-level=moderate` : aucune vulnérabilité signalée.
- Réponses HTTP locales : redirection sans session, `no-store` sur l'accueil et l'API d'authentification, en-têtes de sécurité présents.
