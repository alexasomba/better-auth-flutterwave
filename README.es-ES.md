# Better Auth Flutterwave

[English](README.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md)

Plugin de [Better Auth](https://www.better-auth.com) con TypeScript como prioridad para pagos con Flutterwave v3.
Admite Flutterwave Standard Checkout, pagos únicos verificados, suscripciones con planes de pago nativos,
suscripciones gestionadas localmente, facturación de organizaciones, pagos divididos de marketplace,
webhooks, reembolsos y conciliación.

## Instalación

```bash
npm install better-auth better-auth-flutterwave
```

Se requiere Node.js 22.22.2 o posterior. El desarrollo y CI usan Node 22.23.3, fijado en `.node-version`, y pnpm 12.11.2. El entorno de pruebas actual de jsdom establece el nivel mínimo de parche de Node 22.

## Configuración

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

El plugin llama a la API v3 de Flutterwave con el `fetch` integrado de Node; no necesitas una dependencia
adicional del SDK de Flutterwave. Inyecta `flutterwaveClient` para definir un límite de proveedor personalizado o `fetch` para
las pruebas y los transportes controlados.

### API de servidor de Flutterwave v4

Para nuevas integraciones de cargo directo, el punto de entrada del servidor también exporta
`createFlutterwaveV4Adapter`. Usa credenciales de cliente OAuth, renueva su token en caché al menos
60 segundos antes de que venza y ofrece operaciones de clientes, métodos de pago con tarjeta cifrada, cargos, autorización
de cargos, consulta de cargos y reembolsos. Configura explícitamente la URL base del entorno de pruebas como
`https://developersandbox-api.flutterwave.com`; la URL base predeterminada es la de producción.
Estas operaciones siguen las API de Flutterwave para [autenticación v4](https://developer.flutterwave.com/v4.0.0/docs/authentication),
[tarjetas](https://developer.flutterwave.com/v4.0.0/docs/card),
[cargos](https://developer.flutterwave.com/v4/reference/charges_post) y
[reembolsos](https://developer.flutterwave.com/v4/reference/refunds_post).

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

Proporciona una clave de idempotencia única y estable para cada escritura, y reutilízala al reintentar. Los métodos de tarjeta
solo aceptan campos de tarjeta cifrados por Flutterwave y un nonce; nunca envíes PAN ni CVV sin procesar a este adaptador
de servidor. El adaptador v4 es un transporte del proveedor para rutas de servidor confiables. No crea registros locales de
facturación de Better Auth ni completa automáticamente un cargo v4; verifica el cargo y compara su referencia, importe,
moneda y cliente con tu propio pedido pendiente antes de conceder valor. Las rutas existentes de checkout y suscripciones de
Better Auth siguen usando Flutterwave Standard Checkout y los planes de pago v3.

Configura el plugin de cliente:

```ts
import { createAuthClient } from "better-auth/client";
import { flutterwaveClient } from "better-auth-flutterwave/client";

export const authClient = createAuthClient({
  plugins: [flutterwaveClient({ subscription: true })],
});
```

A continuación, genera el esquema de Better Auth y aplícalo con el flujo de migración de tu base de datos:

```bash
npx @better-auth/cli generate
```

En las configuraciones compatibles con la migración directa, también puedes ejecutar:

```bash
npx @better-auth/cli migrate
```

## Checkout y verificación

Flutterwave Standard Checkout requiere un importe, una moneda, una URL de redirección y un correo de facturación. El
navegador proporciona directamente el importe y la moneda o selecciona un plan/producto configurado; el servidor
obtiene el correo de facturación del usuario autenticado o del propietario autorizado de la organización. El plugin
genera un `txRef` único.

Para un plan o producto configurado, el precio y la moneda definidos en el servidor siempre prevalecen sobre
los valores enviados por el navegador. El importe base de un plan incluye el primer asiento; cada asiento adicional añade
`seatAmount`. Los precios de los productos se multiplican por `quantity`. Los valores explícitos de importe/moneda del navegador
solo se aplican a pagos sin un plan o producto configurado.

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

Después de la redirección, envía exactamente un identificador de transacción a la acción de verificación:

```ts
await authClient.flutterwave.transaction.verify({
  transactionId: Number(searchParams.get("transaction_id")),
});
```

La entrega del producto o servicio solo ocurre cuando la verificación del servidor confirma el estado de la transacción, `txRef`,
el importe y la moneda. Una redirección o el contenido de un webhook por sí solos nunca prueban el pago.

La API tipada del navegador se limita intencionadamente a:

- `authClient.flutterwave.transaction.initialize`, `verify` y `list`
- `authClient.subscription.create`, `upgrade`, `cancel`, `restore` y `list`
- Configuración del proveedor de solo lectura y acciones del catálogo local en `authClient.flutterwave`

La conciliación, las renovaciones, la sincronización de planes remotos, los reembolsos y la administración de subcuentas son
operaciones de servidor confiables y no están expuestas a los clientes del navegador.

## Modelos de suscripción

### Planes nativos de Flutterwave

Establece un `paymentPlanId` numérico en un plan configurado. La inscripción comienza con un checkout con tarjeta que incluye
ese ID de plan. Tras la verificación, el plugin resuelve la suscripción de Flutterwave mediante la transacción
verificada, el correo de facturación inmutable y el plan de pago.

Flutterwave no tiene un endpoint independiente para «crear una suscripción» en este flujo. Los planes nativos del proveedor no
simulan admitir pruebas gratuitas gestionadas por el proveedor ni cambios prorrateados.

### Planes gestionados localmente

Omite `paymentPlanId` para una suscripción renovada localmente. El plugin almacena localmente la suscripción,
el grupo, el número de asientos y la configuración de derechos de acceso. Las transiciones automáticas de prueba gratuita, los cambios
de plan programados y la gestión del prorrateo no forman parte de la versión inicial.

La renovación desde un servidor confiable prefiere ese token cifrado. Si no hay un token disponible, la renovación crea un
checkout alojado y queda pendiente hasta que se verifique el pago resultante.

## Facturación de organizaciones y marketplace

La facturación de organizaciones controla la propiedad y la autorización locales. La identidad de facturación de Flutterwave es
un correo electrónico; el plugin no crea ni persiste en usuarios u organizaciones un registro ficticio de cliente de Flutterwave.
organizations.

Los pagos divididos de marketplace son un asunto independiente. Configura los ID existentes de subcuentas de Flutterwave,
aprobadas mediante KYC, en `marketplace.allowedSubaccountIds`. Las modificaciones por checkout deben estar autorizadas y
hacer referencia a la lista permitida. El plugin no crea subcuentas ni equipara automáticamente una
organización con una subcuenta de Flutterwave.

## Webhooks

Configura Flutterwave para que envíe eventos al endpoint de webhook de Better Auth Flutterwave. El plugin verifica los valores v4 de
`flutterwave-signature` como resúmenes HMAC-SHA256 en base64 del cuerpo exacto de la solicitud sin procesar, y
acepta el encabezado v3 `verif-hash` para entregas v3 heredadas, según se describe en las guías de webhooks
[v4](https://developer.flutterwave.com/v4.0.0/docs/webhooks) y
[v3](https://developer.flutterwave.com/docs/webhooks). Ambas comparaciones se realizan en tiempo constante y
usan el `secretHash` configurado por separado. Registra el estado de idempotencia y vuelve a verificar las transacciones de pago v3
antes de conceder valor. Los payloads de eventos v4 se entregan a `onEvent` tras verificar la firma y deduplicar; recupera el cargo v4 y
compáralo con un pedido pendiente antes de conceder valor. Mantén breve el trabajo personalizado de `onEvent` para que el endpoint pueda
responder dentro del tiempo límite de Flutterwave.
timeout.

Los fallos de callback y conciliación devuelven HTTP 503, que permite reintentar. El procesamiento de webhooks usa una
reserva en la base de datos para evitar callbacks simultáneos del mismo evento; una reserva abandonada puede
reintentarse tras cinco minutos. Los callbacks de pagos, ciclo de vida de suscripciones y `onEvent` deben ser
idempotentes: si se produce un fallo después del trabajo externo, pero antes de registrar su finalización, un reintento posterior puede
ejecutar el callback de nuevo. Una notificación de cancelación del proveedor conserva el acceso hasta el final futuro del periodo de pago
programado; las cancelaciones inmediatas finalizan el acceso al procesarse.

Los hooks del ciclo de vida de pagos verificados comparten un registro de cumplimiento duradero entre la verificación del navegador,
los webhooks y la conciliación. El registro conserva la intención de suscripción inicial antes de la activación y
guarda un checkpoint de cada hook completado correctamente. Un hook inicial fallido se reintenta aunque la suscripción ya esté
activa; se omiten los hooks anteriores que finalizaron correctamente. Los registros de cumplimiento usan la tabla de eventos existente y
leases de cinco minutos, por lo que las solicitudes concurrentes se reintentan en lugar de despachar los mismos hooks a la vez.
Los handlers deben seguir siendo idempotentes si el trabajo externo termina antes de guardar su checkpoint.

No analices y serialices de nuevo la solicitud antes de verificar la firma. No uses la
`secretKey` de la API como hash secreto del webhook.

Se ofrece sondeo y conciliación para transacciones y reembolsos v3 pendientes. El estado de las
suscripciones nativas v3 se actualiza a partir de eventos de pago verificados y eventos de cancelación del proveedor
con una coincidencia única; actualmente no se ofrece conciliación de suscripciones locales.

## Operaciones de servidor confiables

Las operaciones privilegiadas se exportan desde el punto de entrada del servidor:

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

Requieren un contexto de endpoint de Better Auth confiable y las mismas opciones de Flutterwave usadas por el
plugin. Llámalas solo desde rutas de servidor autorizadas de forma independiente, consumidores de colas o tareas
programadas:

- `syncFlutterwavePlans` importa planes de pago remotos de Flutterwave a registros locales con espacio de nombres.
- `chargeSubscriptionRenewal` usa un token reutilizable cifrado si está disponible; de lo contrario, devuelve una
  URL de checkout alojado y deja la renovación pendiente.
- `refundFlutterwaveTransaction` inicia un reembolso asíncrono total o parcial.
- `reconcileFlutterwaveTransaction` sondea y verifica una transacción pendiente.
- `reconcileFlutterwaveRefunds` actualiza los registros de reembolso pendientes.
- `processScheduledFlutterwaveCancellations` ejecuta las solicitudes de cancelación vencidas, cancelando las suscripciones nativas
  a través de Flutterwave si es necesario y finalizando las suscripciones locales. Las nuevas solicitudes de cancelación nativa
  detienen de inmediato la facturación del proveedor y mantienen el acceso hasta que finalice el periodo de pago; retirar esa solicitud
  reactiva la facturación del proveedor. Ejecuta el procesador desde tu planificador al terminar el periodo, revisa los ID `failed` devueltos y
  reintenta los fallos. Cada ejecución procesa hasta 100 solicitudes por defecto (máximo 1.000); `hasMore` indica que
  puede ser necesario otro lote. La programación requiere un `periodEnd` de pago conocido; primero se deben conciliar los registros
  heredados o cancelarlos de inmediato.

Los trabajos de renovación deben proporcionar un `renewalId` estable y reutilizarlo en cada reintento de la misma intención de facturación.
Sin él, el plugin reserva el final del periodo de pago actual (o el periodo inicial).
Las nuevas intenciones de renovación se rechazan antes de que termine un periodo de pago futuro. Antes de cobrar, se guarda una transacción pendiente y la intención de envío.
Una vez iniciado el envío, los reintentos verifican esa misma referencia y nunca inician otro
cargo, aunque se haya perdido la respuesta del proveedor o la verificación posterior. Un rechazo del proveedor o
una referencia imposible de verificar requiere conciliación o investigación del operador; no autoriza un nuevo
cargo. Los reintentos de checkout alojado devuelven la URL guardada. No se presupone una garantía de idempotencia del proveedor.
Los reintentos de un `renewalId` completado devuelven el pago verificado original.

Para los reembolsos v3, `completed` significa que se inició el proceso y se espera el desembolso. La conciliación también consulta
los estados `processing`, `pending-momo` y `pending`, y solo acepta respuestas de consulta satisfactorias con el
ID de reembolso esperado. Estados terminales específicos del método, como `completed-mpgs` y
`completed-bank-transfer`, indican que el desembolso se realizó correctamente. Consulta el
[ciclo de vida de reembolsos v3 de Flutterwave](https://developer.flutterwave.com/docs/refunds).

La cancelación y la restauración aceptan el `id` de la suscripción local o un `subscriptionId` numérico de Flutterwave.
Una cancelación local programada se puede retirar mientras el periodo de pago siga activo. Una suscripción local que ya haya terminado
requiere un checkout nuevo. La renovación calcula el mismo precio por asiento que el checkout y rechaza suscripciones canceladas o gestionadas por el proveedor.

## Publicación y actualizaciones posteriores

Release Please abre la PR de versión y registro de cambios cuando los cambios revisados llegan a `main`. Al fusionar esa
PR de publicación, se crea la etiqueta de versión y se activa el flujo de publicación npm confiable fijado a esa etiqueta.
El publicador de confianza de npm debe hacer referencia a este repositorio y a `.github/workflows/release-please.yml`.
El flujo requiere Node 22.23.3, la versión bloqueada de pnpm, pruebas de la biblioteca, una compilación del paquete, lint de paquete y tipos,
y comprobaciones posteriores del ejemplo y del esquema. Un push de una rama o una compilación normal de la aplicación no
publica este paquete.

Los consumidores deben usar una versión que incluya la nueva exportación de cancelaciones programadas antes de importarla;
la versión 0.2.1 publicada anteriormente no incluye estos cambios. El ejemplo usa
`workspace:*`, por lo que sigue la versión de la biblioteca en este checkout. Tras la publicación, los consumidores externos deben actualizar
la dependencia y el archivo de bloqueo, revisar las restricciones del esquema de facturación y conectar el
procesador a un planificador autorizado. Consulta [la configuración del ejemplo persistente](examples/tanstack/README.md)
para la migración de D1 y la configuración de Cron Trigger. Este repositorio no actualiza
ni despliega automáticamente aplicaciones externas.

## Skills de agente incluidas en el paquete

El paquete npm incluye skills de programación para agentes, versionadas junto con él en el directorio `skills/`. Ayudan a un
agente a implementar la API de Flutterwave compatible, el modelo de datos, las reglas de seguridad y los ejemplos sin
tener que adivinar el comportamiento del proveedor.

Instala el enlazador de skills en tu aplicación y ejecuta su configuración inicial:

```bash
npm install --save-dev skills-npm
npx skills-npm setup
```

`skills-npm setup` añade un hook `prepare` y enlaza las skills de los paquetes npm instalados en las
ubicaciones detectadas para Codex, Claude Code, Cursor y otros agentes compatibles. Para seleccionar solo este
paquete, crea:

```ts
// skills-npm.config.ts
import { defineConfig } from "skills-npm";

export default defineConfig({
  include: ["better-auth-flutterwave"],
});
```

Actualiza los enlaces con `npx skills-npm --force` o previsualiza los cambios con
`npx skills-npm --dry-run`.

| Skill                               | Para qué sirve                                                        |
| ----------------------------------- | --------------------------------------------------------------------- |
| `$better-auth-flutterwave-setup`    | Configuración inicial de servidor/cliente, credenciales y migraciones |
| `$flutterwave-billing-flows`        | Checkout, verificación y flujos de suscripción                        |
| `$flutterwave-client-api`           | Acciones tipadas del navegador y límites cliente/servidor             |
| `$flutterwave-local-subscriptions`  | Renovación con token cifrado y alternativa de checkout alojado        |
| `$flutterwave-organization-billing` | Propiedad de organizaciones, roles y pagos divididos                  |
| `$flutterwave-catalog-limits`       | Planes, productos locales, inventario, asientos y límites             |
| `$flutterwave-webhooks-events`      | Firmas de webhook, idempotencia y nueva verificación                  |
| `$flutterwave-schema-migrations`    | Generación de esquemas con espacio de nombres y migraciones           |
| `$flutterwave-testing-fixtures`     | Pruebas unitarias, de sandbox, webhooks y conciliación                |
| `$flutterwave-tanstack-start`       | Integración de TanStack Start                                         |

Invoca una skill explícitamente en la solicitud al agente:

```text
Use $better-auth-flutterwave-setup to add Better Auth Flutterwave to this application.
```

```text
Use $flutterwave-webhooks-events to review my webhook route and add signature tests.
```

```text
Use $flutterwave-organization-billing to implement organization checkout with allowlisted splits.
```

Incluir `$skill-name` en la solicitud es la forma explícita más portable de invocarla.

## Modelo de datos

Los registros propiedad del proveedor usan espacios de nombres para que este plugin pueda coexistir con otros proveedores de facturación:

- `flutterwaveTransaction`
- `flutterwaveSubscription`
- `flutterwaveProduct` (solo catálogo local)
- `flutterwavePlan`
- `flutterwaveWebhookEvent`
- `flutterwaveRefund`

El plugin de Paystack se está alineando gradualmente con este enfoque de espacios de nombres por proveedor. Sus registros de
transacciones, catálogo y webhooks ya los usan; su tabla de suscripciones genérica heredada
sigue siendo sensible a la compatibilidad hasta que se publique la migración prevista. Los dos plugins
existentes todavía se pueden instalar juntos, porque las suscripciones de Flutterwave y los demás registros del proveedor
tienen espacios de nombres separados. El comportamiento compartido de la aplicación debe basarse en los campos de ciclo de vida normalizados y en la autorización de referencias de cada proveedor, en lugar de
suponer que uno expone los identificadores de cliente o suscripción del otro.

Los identificadores públicos usan los nombres propios de Flutterwave: `txRef`, `transactionId`, `flwRef`,
`paymentPlanId`, `subscriptionId`, `secretHash` y `subaccountId`.

## Transporte del proveedor

Las solicitudes al proveedor usan la API HTTP v3 de Flutterwave con autenticación bearer y validan los sobres de respuesta
antes de devolver datos al plugin. El adaptador acepta implementaciones inyectadas de `fetch` y
`flutterwaveClient` para pruebas y transportes personalizados.

## Desarrollo

Este repositorio usa [Vite+](https://viteplus.dev). `vp check` usa su comprobador de TypeScript nativo. Las compilaciones de declaraciones aún requieren la API del compilador proporcionada por el paquete de compatibilidad mantenido `@typescript/typescript6`; Vite+ 1.1.0 rechaza explícitamente la API del compilador TypeScript 7 para este modo.

Comandos:

```bash
vp install
vp check
vp test
vp pack
pnpm run lint:types
pnpm run lint:package
```

Las pruebas de integración requieren credenciales de sandbox de Flutterwave y son optativas:

```bash
RUN_INTEGRATION_TESTS=true vp test
```

## Licencia

MIT
