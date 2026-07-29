export type FlutterwaveMetadata = Record<string, unknown>;

export interface CheckoutMetadataInput {
  referenceId: string;
  userId: string;
  plan?: string;
  groupId?: string | null;
  product?: string;
  extra?: FlutterwaveMetadata;
  trial: {
    isTrial: boolean;
    requested: boolean;
    granted: boolean;
    deniedReason?: "already_used";
    endsAt?: Date;
  };
}

export interface ProrationMetadataInput {
  subscriptionId: string;
  referenceId: string;
  newPlan: string;
  oldPlan: string;
  newSeatCount: number;
  remainingDays: number;
}

export interface RenewalMetadataInput {
  subscriptionId: string;
  referenceId: string;
}

function isMetadataRecord(value: unknown): value is FlutterwaveMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseFlutterwaveMetadata(value: unknown): FlutterwaveMetadata {
  if (value === undefined || value === null || value === "") return {};

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isMetadataRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isMetadataRecord(value) ? value : {};
}

export function stringifyFlutterwaveMetadata(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return JSON.stringify(parseFlutterwaveMetadata(value));
}

export function hasFlutterwaveMetadata(value: unknown): boolean {
  return Object.keys(parseFlutterwaveMetadata(value)).length > 0;
}

export function getMetadataString(metadata: FlutterwaveMetadata, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function getMetadataNumber(metadata: FlutterwaveMetadata, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getMetadataBoolean(metadata: FlutterwaveMetadata, key: string): boolean {
  const value = metadata[key];
  return value === true || value === "true";
}

export function createCheckoutMetadata(input: CheckoutMetadataInput): FlutterwaveMetadata {
  return {
    referenceId: input.referenceId,
    userId: input.userId,
    plan: input.plan,
    groupId: input.groupId,
    product: input.product,
    ...input.extra,
    isTrial: input.trial.isTrial,
    trialRequested: input.trial.requested,
    trialGranted: input.trial.granted,
    trialDeniedReason: input.trial.deniedReason,
    trialEnd: input.trial.endsAt?.toISOString(),
  };
}

export function createProrationMetadata(input: ProrationMetadataInput): FlutterwaveMetadata {
  return {
    type: "proration",
    subscriptionId: input.subscriptionId,
    referenceId: input.referenceId,
    newPlan: input.newPlan,
    oldPlan: input.oldPlan,
    newSeatCount: input.newSeatCount,
    remainingDays: input.remainingDays,
  };
}

export function createRenewalMetadata(input: RenewalMetadataInput): FlutterwaveMetadata {
  return {
    type: "renewal",
    subscriptionId: input.subscriptionId,
    referenceId: input.referenceId,
  };
}
