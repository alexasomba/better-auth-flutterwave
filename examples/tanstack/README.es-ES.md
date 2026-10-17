# Ejemplo de Better Auth Flutterwave – TanStack Start

[English](README.md) · [Español](README.es-ES.md) · [Français](README.fr-FR.md)

Esta aplicación muestra sesiones de Better Auth, autorización de organizaciones, Flutterwave
Standard Checkout, transacciones verificadas, suscripciones nativas y locales, un catálogo local de productos,
cancelación/restauración de suscripciones, historial de transacciones y operaciones confiables del servidor.

## Entorno

```env
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_SECRET_HASH=your-dashboard-webhook-secret-hash
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
```

Usa Node 22.23.3 (mínimo 22.22.2) y pnpm 12.11.2. Vite+ administra el runtime fijado y el ejecutable nativo de pnpm. El formato y el lint usan `vp fmt` y `vp lint`, incluidas las reglas de TanStack Query y Router.

Instala y ejecuta desde la raíz del repositorio:

```bash
vp install
vp dev
```

## Flujo demostrado

1. Inicia sesión y elige facturación personal o de organización desde el panel.
2. Selecciona un plan configurado o un producto local. El checkout de organización puede incluir una cantidad de asientos.
3. Inicia el checkout con un importe, moneda, correo de facturación y `redirectUrl` absoluta.
4. Flutterwave redirige a `/billing/flutterwave/callback` con `transaction_id`, `tx_ref` y
   `status`.
5. El callback invoca la verificación del servidor. La interfaz solo muestra el éxito cuando coinciden el estado, `txRef`,
   el importe y la moneda.
6. La cancelación/restauración de suscripciones y las listas de transacciones leen los
   registros con espacio de nombres del proveedor. La demo predeterminada los mantiene en memoria y los pierde cuando se reinicia el aislamiento del Worker.

Un plan nativo se configura con un `paymentPlanId` numérico y comienza con un checkout con tarjeta. Un plan local
omite ese ID y demuestra pruebas gratuitas, periodos, asientos, límites y renovaciones gestionados localmente.
renewals.

Los productos y el inventario de este ejemplo son locales. Flutterwave no ofrece el catálogo de productos remoto
que usa la aplicación.

## Facturación persistente y cancelación programada

La configuración opcional `wrangler.billing.jsonc` usa D1 y ejecuta el handler programado del Worker
cada cinco minutos. Usa la misma base de datos y configuración de Flutterwave que las solicitudes HTTP.
El handler finaliza el acceso de pago vencido mediante `processScheduledFlutterwaveCancellations`; procesa como
máximo 1.000 solicitudes por ejecución y rechaza una ejecución con ID fallidos para que aparezca en la
supervisión de eventos programados. Los registros fallidos siguen programados para la siguiente ejecución. Los lotes pendientes más grandes
continúan en la ejecución siguiente.

Para D1 local, usa el ID de base de datos de marcador de posición y credenciales solo de sandbox en tu
archivo `.dev.vars` ignorado:

```bash
vp run db:billing:check
vp run db:billing:migrate:local
vp run dev:billing
```

Puedes activar la tarea programada localmente con:

```bash
curl 'http://localhost:3000/cdn-cgi/handler/scheduled?cron=*/5%20*%20*%20*%20*'
```

Antes de un despliegue persistente, sustituye el ID de D1 de marcador de posición, establece la URL pública real, configura
los secretos del servidor y aplica la migración revisada a esa base de datos. `0001_billing.sql` inicializa una
base de datos nueva, incluido el `eventId` único del webhook; no debe volver a aplicarse sobre un esquema
existente. El handler programado se niega a procesar facturación sin D1 o sin las claves de Flutterwave
configuradas. La configuración predeterminada en memoria no tiene Cron Trigger.

La programación nativa detiene de inmediato la facturación del proveedor, pero conserva el acceso de pago hasta `periodEnd`;
el handler programado termina ese acceso. La facturación local solo modifica registros locales. El handler no
cobra ningún pago.

La migración incluida procede de los esquemas instalados de Better Auth y de la biblioteca, y se generó con
una base de datos SQLite local vacía y claves de marcador de posición. Si cambian esos esquemas, vuelve a generarla
antes del primer despliegue:

```bash
vp run db:billing:generate
vp run db:billing:check
vp run build:billing
vp run wrangler:dry-run
```

Después de desplegar una base de datos, crea una migración incremental revisada para los cambios posteriores del
esquema. La versión 0.2.1 de la biblioteca ya define la unicidad de eventos de webhook; los usuarios actuales deben
verificar esa restricción en su base de datos antes de habilitar entregas de webhook concurrentes.

## Notas de seguridad

- `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY` y `FLUTTERWAVE_SECRET_HASH` permanecen en los bindings del servidor.
  bindings.
- Los webhooks usan HMAC-SHA256 sobre el cuerpo exacto sin procesar y el encabezado `flutterwave-signature`.
- La facturación de organizaciones y los pagos divididos de marketplace tienen autorizaciones independientes.
- La conciliación, las renovaciones, los reembolsos, la sincronización de planes de pago y la administración de subcuentas son
  funciones de servidor, nunca acciones del cliente del navegador.
- Un token de pago reutilizable se cifra en reposo y nunca se muestra ni se registra en logs.

## Validación

```bash
vp check
vp test
vp run build
```

Las pruebas en vivo de sandbox de Flutterwave son optativas y requieren credenciales de sandbox.
