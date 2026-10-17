# Better Auth Flutterwave

[English](README.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md)

Plugin [Better Auth](https://www.better-auth.com) privilégiant TypeScript pour les paiements Flutterwave v3.
Il prend en charge Flutterwave Standard Checkout, les paiements ponctuels vérifiés, les abonnements
aux plans de paiement natifs, les abonnements gérés localement, la facturation des organisations, les paiements fractionnés de marketplace,
les webhooks, les remboursements et le rapprochement.

## Installation

```bash
npm install better-auth better-auth-flutterwave
```

Node.js 22.22.2 ou une version ultérieure est requis. Le développement et la CI utilisent Node 22.23.3, défini dans `.node-version`, ainsi que pnpm 12.11.2. L’environnement de test jsdom actuel fixe le niveau de correctif minimal de Node 22.

## Configuration

```env
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_SECRET_HASH=your-dashboard-webhook-secret-hash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { flutterwave } from "better-auth-flutterwave";

export const auth = betterAuth({
  plugins: [
    organization(),
    flutterwave({
      publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY!,
      secretKey: process.env.FLUTTERWAVE_SECRET_KEY!,
      secretHash: process.env.FLUTTERWAVE_SECRET_HASH!,
      subscription: {
        enabled: true,
        plans: [
          {
            name: "pro",
            paymentPlanId: 12345,
            amount: 5_000,
            currency: "NGN",
            interval: "monthly",
          },
          {
            name: "starter",
            amount: 2_000,
            currency: "NGN",
            interval: "monthly",
          },
        ],
      },
      organization: { enabled: true },
      marketplace: {
        allowedSubaccountIds: ["RS_1234567890"],
      },
    }),
  ],
});
```

Le plugin appelle l’API v3 de Flutterwave avec le `fetch` intégré à Node ; aucune dépendance au SDK Flutterwave
n’est nécessaire. Injectez `flutterwaveClient` pour définir une frontière fournisseur personnalisée ou `fetch` pour
les tests et les transports contrôlés.

### API serveur Flutterwave v4

Pour les nouvelles intégrations de débit direct, le point d’entrée serveur exporte également
`createFlutterwaveV4Adapter`. Il utilise les identifiants client OAuth, renouvelle le jeton en cache au moins
60 secondes avant son expiration et expose les opérations client, moyen de paiement par carte chiffrée, débit, autorisation
de débit, récupération de débit et remboursement. Configurez explicitement l’URL de base du bac à sable sur
`https://developersandbox-api.flutterwave.com` ; l’URL de base par défaut est celle de production.
Ces opérations suivent les API Flutterwave d’[authentification v4](https://developer.flutterwave.com/v4.0.0/docs/authentication),
[carte](https://developer.flutterwave.com/v4.0.0/docs/card),
[débit](https://developer.flutterwave.com/v4/reference/charges_post) et
[remboursement](https://developer.flutterwave.com/v4/reference/refunds_post).

```ts
import { createFlutterwaveV4Adapter } from "better-auth-flutterwave";

const flutterwaveV4 = createFlutterwaveV4Adapter({
  clientId: process.env.FLW_V4_CLIENT_ID!,
  clientSecret: process.env.FLW_V4_CLIENT_SECRET!,
  apiBaseUrl:
    process.env.NODE_ENV === "production"
      ? "https://f4bexperience.flutterwave.com"
      : "https://developersandbox-api.flutterwave.com",
});
```

Fournissez une clé d’idempotence unique et stable pour chaque écriture, puis réutilisez-la lors des nouvelles tentatives. Les moyens de paiement par carte
n’acceptent que des champs de carte chiffrés par Flutterwave et un nonce ; n’envoyez jamais de PAN ni de CVV en clair à cet adaptateur
serveur. L’adaptateur v4 est un transport fournisseur destiné aux routes serveur de confiance. Il ne crée pas de lignes de facturation
Better Auth locales et ne traite pas automatiquement un débit v4 ; vérifiez le débit et faites correspondre sa référence, son montant,
sa devise et son client à votre propre commande en attente avant d’accorder la valeur. Les routes de checkout et d’abonnement Better Auth
existantes continuent d’utiliser Flutterwave Standard Checkout et les plans de paiement v3.

Configurez le plugin client :

```ts
import { createAuthClient } from "better-auth/client";
import { flutterwaveClient } from "better-auth-flutterwave/client";

export const authClient = createAuthClient({
  plugins: [flutterwaveClient({ subscription: true })],
});
```

Générez ensuite le schéma Better Auth et appliquez-le avec votre processus de migration de base de données :

```bash
npx @better-auth/cli generate
```

Pour les configurations compatibles avec une migration directe, vous pouvez aussi exécuter :

```bash
npx @better-auth/cli migrate
```

## Checkout et vérification

Flutterwave Standard Checkout requiert un montant, une devise, une URL de redirection et une adresse e-mail de facturation. Le
navigateur fournit le montant et la devise, ou sélectionne un plan/produit configuré ; le serveur
récupère l’adresse e-mail de facturation de l’utilisateur authentifié ou du propriétaire autorisé de l’organisation. Le plugin
génère un `txRef` unique.

Pour un plan ou un produit configuré, la devise et le prix définis côté serveur prévalent toujours sur les
remplacements du navigateur. Le montant de base d’un plan inclut le premier siège ; chaque siège supplémentaire ajoute
`seatAmount`. Les prix des produits sont multipliés par `quantity`. Les valeurs de montant/devise explicites du navigateur
ne s’appliquent qu’à un paiement sans plan ni produit configuré.

```ts
const checkout = await authClient.flutterwave.transaction.initialize(
  {
    amount: 5_000,
    currency: "NGN",
    redirectUrl: `${window.location.origin}/billing/flutterwave/callback`,
  },
  { throw: true },
);

window.location.assign(checkout.url);
```

Après la redirection, transmettez exactement un identifiant de transaction à l’action de vérification :

```ts
await authClient.flutterwave.transaction.verify({
  transactionId: Number(searchParams.get("transaction_id")),
});
```

La livraison n’a lieu qu’après confirmation côté serveur du statut de la transaction, de `txRef`, du
montant et de la devise. Une redirection ou le contenu d’un webhook ne constitue jamais, à lui seul, une preuve de paiement.

L’API typée côté navigateur est volontairement limitée à :

- `authClient.flutterwave.transaction.initialize`, `verify` et `list`
- `authClient.subscription.create`, `upgrade`, `cancel`, `restore` et `list`
- La configuration fournisseur en lecture seule et les actions du catalogue local sous `authClient.flutterwave`

Le rapprochement, les renouvellements, la synchronisation des plans distants, les remboursements et l’administration des sous-comptes sont des
opérations serveur de confiance et ne sont pas exposés aux clients du navigateur.

## Modèles d’abonnement

### Plans natifs Flutterwave

Définissez un `paymentPlanId` numérique sur un plan configuré. L’inscription commence par un checkout par carte contenant
cet ID de plan. Après vérification, le plugin résout l’abonnement Flutterwave à l’aide de la transaction
vérifiée, de l’adresse e-mail de facturation immuable et du plan de paiement.

Flutterwave ne possède pas d’endpoint distinct « créer un abonnement » pour ce flux. Les plans natifs du fournisseur ne prétendent pas
prendre en charge des essais gérés côté fournisseur ni des modifications au prorata.

### Plans gérés localement

Omettez `paymentPlanId` pour un abonnement renouvelé localement. Le plugin stocke localement l’abonnement,
le groupe, le nombre de sièges et la configuration des droits. Les transitions automatiques d’essai, les mutations de plan planifiées
et l’orchestration du prorata ne font pas partie de la version initiale.

Le renouvellement depuis un serveur de confiance privilégie ce jeton chiffré. Si aucun jeton n’est disponible, le renouvellement crée un
checkout hébergé et reste en attente jusqu’à la vérification du paiement qui en résulte.

## Facturation des organisations et marketplace

La facturation des organisations contrôle la propriété et l’autorisation locales. L’identité de facturation Flutterwave est une
adresse e-mail ; le plugin ne crée ni ne persiste de faux enregistrement de client Flutterwave sur les utilisateurs ou les organisations.
organizations.

Les paiements fractionnés de marketplace sont un sujet distinct. Configurez les ID de sous-compte Flutterwave existants,
approuvés par KYC, dans `marketplace.allowedSubaccountIds`. Les substitutions par checkout doivent être autorisées et
référencer la liste d’autorisation. Le plugin ne provisionne pas de sous-comptes et n’assimile pas automatiquement une
organisation à un sous-compte Flutterwave.

## Webhooks

Configurez Flutterwave pour envoyer les événements au point de terminaison webhook Better Auth Flutterwave. Le plugin vérifie les valeurs v4
de `flutterwave-signature` comme des condensats HMAC-SHA256 en base64 du corps exact de la requête brute et
accepte l’en-tête v3 `verif-hash` pour les anciennes livraisons v3, comme décrit dans les guides webhook
[v4](https://developer.flutterwave.com/v4.0.0/docs/webhooks) et
[v3](https://developer.flutterwave.com/docs/webhooks). Les deux comparaisons s’exécutent en temps constant et
utilisent le `secretHash` configuré séparément. Le plugin enregistre l’état d’idempotence et revérifie les transactions de paiement v3
avant d’accorder la valeur. Les payloads d’événements v4 sont transmis à `onEvent` après vérification de la signature et déduplication ; récupérez le débit v4 et
faites-le correspondre à une commande en attente avant d’accorder la valeur. Limitez le travail personnalisé de `onEvent` afin que le point de terminaison puisse
répondre dans le délai de Flutterwave.
timeout.

Les échecs de callback et de rapprochement renvoient HTTP 503, ce qui permet une nouvelle tentative. Le traitement des webhooks utilise une
réservation en base de données pour empêcher les callbacks simultanés du même événement ; une réservation abandonnée peut être
réessayée après cinq minutes. Les callbacks de paiement, de cycle de vie d’abonnement et `onEvent` doivent être
idempotents : un plantage après le travail externe, mais avant l’enregistrement de sa fin, peut entraîner une nouvelle exécution du callback lors d’une
tentative ultérieure. Une notification d’annulation fournisseur préserve l’accès jusqu’à la fin future de la période payée
planifiée ; les annulations immédiates mettent fin à l’accès lors de leur traitement.

Les hooks du cycle de vie des paiements vérifiés partagent un enregistrement d’exécution durable entre la vérification navigateur,
les webhooks et le rapprochement. Cet enregistrement conserve l’intention d’abonnement initiale avant l’activation et
enregistre un point de contrôle pour chaque hook réussi. Un hook initial en échec est réessayé même après l’activation de l’abonnement ;
les hooks antérieurs réussis sont ignorés. Les enregistrements d’exécution utilisent la table d’événements existante et des baux de
cinq minutes ; les requêtes concurrentes réessaient donc au lieu de déclencher les mêmes hooks simultanément.
Les handlers doivent rester idempotents si le travail externe réussit avant l’enregistrement de son point de contrôle.

Ne parsez pas puis ne sérialisez pas à nouveau la requête avant la vérification de signature. N’utilisez pas la
`secretKey` de l’API comme hash secret du webhook.

Le sondage et le rapprochement sont disponibles pour les transactions v3 et les remboursements en attente. L’état des
abonnements natifs v3 est mis à jour à partir des événements de paiement vérifiés et des événements d’annulation fournisseur
identifiés de manière unique ; le rapprochement des abonnements locaux n’est pas encore exposé.

## Opérations serveur de confiance

Les opérations privilégiées sont exportées depuis le point d’entrée serveur :

```ts
import {
  chargeSubscriptionRenewal,
  processScheduledFlutterwaveCancellations,
  reconcileFlutterwaveRefunds,
  reconcileFlutterwaveTransaction,
  refundFlutterwaveTransaction,
  syncFlutterwavePlans,
} from "better-auth-flutterwave";
```

Elles requièrent un contexte de point de terminaison Better Auth de confiance et les mêmes options Flutterwave que celles utilisées par le
plugin. Appelez-les uniquement depuis des routes serveur autorisées indépendamment, des consommateurs de file ou des tâches
planifiées :

- `syncFlutterwavePlans` importe les plans de paiement distants Flutterwave dans des enregistrements locaux à espace de noms.
- `chargeSubscriptionRenewal` utilise un jeton réutilisable chiffré s’il est disponible ; sinon, renvoie une
  URL de checkout hébergé et laisse le renouvellement en attente.
- `refundFlutterwaveTransaction` lance un remboursement asynchrone total ou partiel.
- `reconcileFlutterwaveTransaction` sonde et vérifie une transaction en attente.
- `reconcileFlutterwaveRefunds` actualise les enregistrements de remboursement en attente.
- `processScheduledFlutterwaveCancellations` exécute les demandes d’annulation arrivées à échéance, en annulant les abonnements natifs
  via Flutterwave si nécessaire et en terminant les abonnements locaux. Les nouvelles demandes d’annulation native
  interrompent immédiatement la facturation fournisseur tout en préservant l’accès jusqu’à la fin de la période payée ; le retrait de la demande
  réactive la facturation fournisseur. Exécutez le processeur à la fin de la période depuis votre planificateur, examinez les ID `failed` renvoyés et
  réessayez les échecs. Chaque exécution traite jusqu’à 100 demandes par défaut (1 000 au maximum) ; `hasMore` indique
  qu’un autre lot peut être nécessaire. La planification requiert un `periodEnd` payé connu ; les anciens enregistrements doivent d’abord être
  rapprochés ou annulés immédiatement.

Les tâches de renouvellement doivent fournir un `renewalId` stable et le réutiliser à chaque nouvelle tentative de la même intention de facturation.
Sans cet identifiant, le plugin réserve la fin de la période payée actuelle (ou la période initiale).
Les nouvelles intentions de renouvellement sont rejetées avant la fin d’une future période payée. Une transaction en attente et l’intention de déclenchement sont enregistrées avant le débit.
Une fois le déclenchement commencé, les nouvelles tentatives vérifient cette même référence et ne lancent jamais un autre
débit, même si la réponse fournisseur ou la vérification ultérieure a été perdue. Un rejet fournisseur ou
une référence impossible à vérifier nécessite un rapprochement ou une enquête opérateur ; cela n’autorise pas un nouveau
débit. Les nouvelles tentatives de checkout hébergé renvoient l’URL enregistrée. Aucune garantie d’idempotence fournisseur n’est
supposée. Les nouvelles tentatives d’un `renewalId` terminé renvoient le paiement vérifié d’origine.

Pour les remboursements v3, `completed` signifie que le remboursement a été initié et que le versement est en attente. Le rapprochement interroge également
les états `processing`, `pending-momo` et `pending`, et n’accepte que les réponses de récupération réussies avec l’ID de
remboursement attendu. Les états terminaux propres à une méthode, tels que `completed-mpgs` et
`completed-bank-transfer`, indiquent que le versement a réussi. Consultez le
[cycle de vie des remboursements v3 Flutterwave](https://developer.flutterwave.com/docs/refunds).

L’annulation et la restauration acceptent l’`id` d’abonnement local ou un `subscriptionId` Flutterwave numérique.
Une annulation locale planifiée peut être retirée tant que la période payée est active. Un abonnement local déjà terminé
nécessite un nouveau checkout. Le renouvellement calcule le même prix par siège que le checkout et rejette les abonnements annulés ou gérés par le fournisseur.

## Publication et mises à jour en aval

Release Please ouvre la PR de version et de journal des modifications après l’arrivée des changements approuvés sur `main`. La fusion de cette
PR de publication crée l’étiquette de version et déclenche le workflow de publication npm de confiance, épinglé à l’étiquette.
Le publisher de confiance npm doit référencer ce dépôt et `.github/workflows/release-please.yml`.
Le workflow requiert Node 22.23.3, la version verrouillée de pnpm, les tests de la bibliothèque, une compilation du package, le lint du package et des types,
ainsi que les vérifications aval de l’exemple et du schéma. Un push de branche ou une compilation d’application ordinaire ne
publie pas ce package.

Les consommateurs doivent utiliser une version qui contient la nouvelle exportation d’annulation planifiée avant de l’importer ;
la version 0.2.1 publiée précédemment ne comprend pas ces changements. L’exemple utilise
`workspace:*` et suit donc la bibliothèque dans ce checkout. Après la publication, les consommateurs externes doivent mettre à jour leur
dépendance et leur fichier de verrouillage, examiner les contraintes du schéma de facturation et connecter le
processeur à un planificateur autorisé. Consultez [la configuration de l’exemple persistant](examples/tanstack/README.md)
pour la migration D1 et la configuration du Cron Trigger. Ce dépôt ne met pas automatiquement à niveau
ni ne déploie les applications externes.

## Skills d’agent incluses dans le package

Le package npm fournit des skills de programmation pour agents, alignées sur sa version, dans son répertoire `skills/`. Elles aident un
agent à implémenter l’API Flutterwave prise en charge, le modèle de données, les règles de sécurité et les exemples sans
deviner le comportement du fournisseur.

Installez le lieur de skills dans votre application et exécutez sa configuration initiale :

```bash
npm install --save-dev skills-npm
npx skills-npm setup
```

`skills-npm setup` ajoute un hook `prepare` et lie les skills des packages npm installés aux
emplacements détectés pour Codex, Claude Code, Cursor et d’autres agents pris en charge. Pour ne sélectionner que ce
package, créez :

```ts
// skills-npm.config.ts
import { defineConfig } from "skills-npm";

export default defineConfig({
  include: ["better-auth-flutterwave"],
});
```

Actualisez les liens avec `npx skills-npm --force` ou prévisualisez les modifications avec
`npx skills-npm --dry-run`.

| Skill                               | Utilisation                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `$better-auth-flutterwave-setup`    | Configuration initiale serveur/client, identifiants et migrations      |
| `$flutterwave-billing-flows`        | Checkout, vérification et parcours d’abonnement                        |
| `$flutterwave-client-api`           | Actions typées du navigateur et frontières client/serveur              |
| `$flutterwave-local-subscriptions`  | Renouvellement par jeton chiffré et solution de repli checkout hébergé |
| `$flutterwave-organization-billing` | Propriété des organisations, rôles et paiements fractionnés            |
| `$flutterwave-catalog-limits`       | Plans, produits locaux, inventaire, sièges et limites                  |
| `$flutterwave-webhooks-events`      | Signatures webhook, idempotence et revérification                      |
| `$flutterwave-schema-migrations`    | Génération de schéma à espace de noms et migrations                    |
| `$flutterwave-testing-fixtures`     | Tests unitaires, bac à sable, webhook et rapprochement                 |
| `$flutterwave-tanstack-start`       | Intégration TanStack Start                                             |

Appelez explicitement une skill dans votre prompt d’agent :

```text
Use $better-auth-flutterwave-setup to add Better Auth Flutterwave to this application.
```

```text
Use $flutterwave-webhooks-events to review my webhook route and add signature tests.
```

```text
Use $flutterwave-organization-billing to implement organization checkout with allowlisted splits.
```

Inclure `$skill-name` dans le prompt est la manière explicite la plus portable de l’invoquer.

## Modèle de données

Les enregistrements appartenant au fournisseur sont à espace de noms afin que ce plugin puisse coexister avec d’autres fournisseurs de facturation :

- `flutterwaveTransaction`
- `flutterwaveSubscription`
- `flutterwaveProduct` (catalogue local uniquement)
- `flutterwavePlan`
- `flutterwaveWebhookEvent`
- `flutterwaveRefund`

Le plugin Paystack s’aligne progressivement sur cette approche à espace de noms par fournisseur. Ses enregistrements de
transactions, de catalogue et de webhooks sont déjà à espace de noms ; son ancienne table générique
d’abonnements reste sensible à la compatibilité jusqu’à la publication de la migration prévue. Les deux plugins
existants peuvent toujours être installés ensemble, car les abonnements et les autres enregistrements du fournisseur Flutterwave
ont des espaces de noms distincts. Le comportement partagé de l’application doit s’appuyer sur les champs de cycle de vie normalisés et sur l’autorisation des références propres à chaque fournisseur plutôt que de
supposer que l’un expose les identifiants client ou abonnement de l’autre.

Les identifiants publics reprennent les noms propres à Flutterwave : `txRef`, `transactionId`, `flwRef`,
`paymentPlanId`, `subscriptionId`, `secretHash` et `subaccountId`.

## Transport fournisseur

Les requêtes fournisseur utilisent l’API HTTP v3 Flutterwave avec authentification bearer et valident les enveloppes de réponse
avant de renvoyer les données au plugin. L’adaptateur accepte des implémentations injectées de `fetch` et de
`flutterwaveClient` pour les tests et les transports personnalisés.

## Développement

Ce dépôt utilise [Vite+](https://viteplus.dev). `vp check` utilise son vérificateur TypeScript natif. Les builds de déclarations nécessitent toujours l’API du compilateur fournie par le package de compatibilité maintenu `@typescript/typescript6` ; Vite+ 1.1.0 rejette explicitement l’API du compilateur TypeScript 7 pour ce mode.

Commandes :

```bash
vp install
vp check
vp test
vp pack
pnpm run lint:types
pnpm run lint:package
```

Les tests d’intégration nécessitent des identifiants Flutterwave de bac à sable et sont facultatifs :

```bash
RUN_INTEGRATION_TESTS=true vp test
```

## Licence

MIT
