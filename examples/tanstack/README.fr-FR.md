# Exemple Better Auth Flutterwave – TanStack Start

[English](README.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md)

Cette application illustre les sessions Better Auth, l’autorisation des organisations, Flutterwave
Standard Checkout, les transactions vérifiées, les abonnements natifs et locaux, un catalogue local de produits,
l’annulation/restauration d’abonnement, l’historique des transactions et les opérations serveur de confiance.

## Environnement

```env
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_SECRET_HASH=your-dashboard-webhook-secret-hash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

Utilisez Node 22.23.3 (minimum 22.22.2) et pnpm 12.11.2. Vite+ gère le runtime épinglé et l’exécutable pnpm natif. Le formatage et le lint utilisent `vp fmt` et `vp lint`, y compris les règles TanStack Query et Router.

Installez et lancez depuis la racine du dépôt :

```bash
vp install
vp dev
```

## Parcours présenté

1. Connectez-vous et choisissez la facturation personnelle ou celle de l’organisation depuis le tableau de bord.
2. Sélectionnez un plan configuré ou un produit local. Le checkout d’organisation peut inclure une quantité de sièges.
3. Initialisez le checkout avec un montant, une devise, une adresse e-mail de facturation et un `redirectUrl` absolu.
4. Flutterwave redirige vers `/billing/flutterwave/callback` avec `transaction_id`, `tx_ref` et
   `status`.
5. Le callback lance la vérification serveur. L’interface n’affiche le succès qu’après correspondance du statut, de `txRef`,
   du montant et de la devise.
6. L’annulation/restauration des abonnements et les listes de transactions lisent les
   enregistrements à espace de noms fournisseur. La démo par défaut les conserve en mémoire et les perd au redémarrage de l’isolate Worker.

Un plan natif se configure avec un `paymentPlanId` numérique et démarre via un checkout par carte. Un plan local
omet cet ID et présente des essais, périodes, sièges, limites et renouvellements orchestrés localement.
renewals.

Les produits et l’inventaire de cet exemple sont locaux. Flutterwave ne fournit pas le catalogue de produits distant
utilisé par l’application.

## Facturation persistante et annulation planifiée

La configuration facultative `wrangler.billing.jsonc` utilise D1 et exécute le handler planifié du Worker
toutes les cinq minutes. Elle utilise la même base de données et la même configuration Flutterwave que les requêtes HTTP.
Le handler termine l’accès payant arrivé à échéance via `processScheduledFlutterwaveCancellations`, traite au
maximum 1 000 demandes par exécution et rejette toute exécution avec des ID en échec afin qu’elle apparaisse dans le
suivi des événements planifiés. Les enregistrements en échec restent planifiés pour l’exécution suivante. Les arriérés plus importants
continuent lors de l’exécution suivante.

Pour D1 local, utilisez l’ID de base de données factice fourni et des identifiants de bac à sable uniquement dans votre
fichier `.dev.vars` ignoré par Git :

```bash
vp run db:billing:check
vp run db:billing:migrate:local
vp run dev:billing
```

Vous pouvez déclencher la planification localement avec :

```bash
curl 'http://localhost:3000/cdn-cgi/handler/scheduled?cron=*/5%20*%20*%20*%20*'
```

Avant un déploiement persistant, remplacez l’ID D1 factice, définissez l’URL publique réelle, configurez les
secrets serveur et appliquez la migration vérifiée à cette base de données. `0001_billing.sql` initialise une
nouvelle base, y compris l’`eventId` webhook unique ; il ne doit pas être rejoué sur un schéma
existant. Le handler planifié refuse de traiter la facturation sans D1 ou sans clés Flutterwave
configurées. La configuration mémoire par défaut ne comporte pas de Cron Trigger.

La planification native arrête immédiatement la facturation fournisseur, mais préserve l’accès payant jusqu’à `periodEnd` ;
le handler planifié termine cet accès. La facturation locale ne modifie que les enregistrements locaux. Ce handler ne
déclenche aucun paiement.

La migration incluse provient des schémas Better Auth et bibliothèque installés ; elle a été générée avec
une base SQLite locale vide et des clés factices. Régénérez-la avant le premier déploiement si ces schémas changent :

```bash
vp run db:billing:generate
vp run db:billing:check
vp run build:billing
vp run wrangler:dry-run
```

Après le déploiement d’une base de données, créez une migration incrémentale vérifiée pour les changements ultérieurs du
schéma. La version 0.2.1 de la bibliothèque définit déjà l’unicité des événements webhook ; les utilisateurs existants doivent
vérifier cette contrainte dans leur base avant d’activer les livraisons webhook concurrentes.

## Notes de sécurité

- `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY` et `FLUTTERWAVE_SECRET_HASH` restent dans les bindings serveur.
  bindings.
- Les webhooks utilisent HMAC-SHA256 sur le corps brut exact et l’en-tête `flutterwave-signature`.
- La facturation des organisations et les paiements fractionnés de marketplace sont autorisés indépendamment.
- Le rapprochement, les renouvellements, les remboursements, la synchronisation des plans de paiement et l’administration des sous-comptes sont des
  fonctions serveur, jamais des actions du client navigateur.
- Un jeton de paiement réutilisable est chiffré au repos et n’est jamais affiché ni inscrit dans les logs.

## Validation

```bash
vp check
vp test
vp run build
```

Les tests Flutterwave en direct sur le bac à sable sont facultatifs et nécessitent des identifiants de bac à sable.
