-- Generated from the installed Better Auth and Flutterwave plugin schemas.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer, "role" text, "banned" integer, "banReason" text, "banExpires" date);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "activeOrganizationId" text, "impersonatedBy" text);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" date not null, "metadata" text);

create table "member" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "role" text not null, "createdAt" date not null);

create table "invitation" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" date not null, "createdAt" date not null, "inviterId" text not null references "user" ("id") on delete cascade);

create table "flutterwaveTransaction" ("id" text not null primary key, "txRef" text not null unique, "transactionId" integer unique, "flwRef" text, "referenceId" text not null, "userId" text not null, "amount" integer, "chargedAmount" integer, "currency" text not null, "status" text not null, "paymentPlanId" integer, "plan" text, "product" text, "paymentType" text, "subaccountId" text, "metadata" text, "verifiedAt" date, "reconciledAt" date, "createdAt" date not null, "updatedAt" date not null);

create table "flutterwaveSubscription" ("id" text not null primary key, "plan" text not null, "referenceId" text not null, "userId" text not null, "billingEmail" text not null, "subscriptionId" integer unique, "paymentPlanId" integer, "txRef" text, "encryptedPaymentToken" text, "status" text not null, "periodStart" date, "periodEnd" date, "trialStart" date, "trialEnd" date, "cancelAtPeriodEnd" integer, "cancelAt" date, "canceledAt" date, "endedAt" date, "billingInterval" text, "groupId" text, "seats" integer, "pendingPlan" text, "reconciledAt" date, "createdAt" date not null, "updatedAt" date not null);

create table "flutterwaveProduct" ("id" text not null primary key, "name" text not null, "description" text, "price" integer not null, "currency" text not null, "quantity" integer, "unlimited" integer, "slug" text not null unique, "metadata" text, "createdAt" date not null, "updatedAt" date not null);

create table "flutterwavePlan" ("id" text not null primary key, "name" text not null, "description" text, "amount" integer not null, "currency" text not null, "interval" text not null, "group" text, "paymentPlanId" integer unique, "metadata" text, "reconciledAt" date, "createdAt" date not null, "updatedAt" date not null);

create table "flutterwaveWebhookEvent" ("id" text not null primary key, "eventId" text not null unique, "eventType" text not null, "transactionId" integer, "txRef" text, "payload" text not null, "status" text not null, "processedAt" date, "createdAt" date not null, "updatedAt" date not null);

create table "flutterwaveRefund" ("id" text not null primary key, "refundId" integer unique, "transactionId" integer not null, "txRef" text not null, "referenceId" text not null, "amount" integer not null, "currency" text not null, "status" text not null, "reason" text, "metadata" text, "reconciledAt" date, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

create index "member_organizationId_idx" on "member" ("organizationId");

create index "member_userId_idx" on "member" ("userId");

create index "invitation_organizationId_idx" on "invitation" ("organizationId");

create index "invitation_email_idx" on "invitation" ("email");

create index "flutterwaveTransaction_flwRef_idx" on "flutterwaveTransaction" ("flwRef");

create index "flutterwaveTransaction_referenceId_idx" on "flutterwaveTransaction" ("referenceId");

create index "flutterwaveTransaction_userId_idx" on "flutterwaveTransaction" ("userId");

create index "flutterwaveTransaction_status_idx" on "flutterwaveTransaction" ("status");

create index "flutterwaveTransaction_paymentPlanId_idx" on "flutterwaveTransaction" ("paymentPlanId");

create index "flutterwaveTransaction_plan_idx" on "flutterwaveTransaction" ("plan");

create index "flutterwaveTransaction_subaccountId_idx" on "flutterwaveTransaction" ("subaccountId");

create index "flutterwaveSubscription_plan_idx" on "flutterwaveSubscription" ("plan");

create index "flutterwaveSubscription_referenceId_idx" on "flutterwaveSubscription" ("referenceId");

create index "flutterwaveSubscription_userId_idx" on "flutterwaveSubscription" ("userId");

create index "flutterwaveSubscription_billingEmail_idx" on "flutterwaveSubscription" ("billingEmail");

create index "flutterwaveSubscription_paymentPlanId_idx" on "flutterwaveSubscription" ("paymentPlanId");

create index "flutterwaveSubscription_txRef_idx" on "flutterwaveSubscription" ("txRef");

create index "flutterwaveSubscription_status_idx" on "flutterwaveSubscription" ("status");

create index "flutterwaveSubscription_groupId_idx" on "flutterwaveSubscription" ("groupId");

create index "flutterwaveWebhookEvent_eventType_idx" on "flutterwaveWebhookEvent" ("eventType");

create index "flutterwaveWebhookEvent_transactionId_idx" on "flutterwaveWebhookEvent" ("transactionId");

create index "flutterwaveWebhookEvent_txRef_idx" on "flutterwaveWebhookEvent" ("txRef");

create index "flutterwaveWebhookEvent_status_idx" on "flutterwaveWebhookEvent" ("status");

create index "flutterwaveRefund_transactionId_idx" on "flutterwaveRefund" ("transactionId");

create index "flutterwaveRefund_txRef_idx" on "flutterwaveRefund" ("txRef");

create index "flutterwaveRefund_referenceId_idx" on "flutterwaveRefund" ("referenceId");

create index "flutterwaveRefund_status_idx" on "flutterwaveRefund" ("status");
