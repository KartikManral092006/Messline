import { Meal, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";

export type ServiceErrorCode =
  | "duplicate"
  | "cutoff_past"
  | "no_dishes"
  | "invalid_count"
  | "invalid_date"
  | "invalid_cutoff"
  | "invalid_meal"
  | "invalid_id"
  | "not_found"
  | "failed";

/**
 * Validates that a string is a real calendar date in YYYY-MM-DD format.
 * Rejects out-of-range months (e.g. 2026-13-45) and invalid day numbers
 * (e.g. 2026-02-30 or 2026-04-31).
 */
export function isValidCalendarDate(val: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Parse cutoff input string into a Date object treating local datetime strings as IST (+05:30).
 *
 * If the input already contains timezone info (e.g. trailing 'Z' or offset '+05:30'),
 * it is parsed directly. If it is a datetime-local format 'YYYY-MM-DDTHH:mm' or
 * 'YYYY-MM-DDTHH:mm:ss', it is interpreted in Indian Standard Time (IST, UTC+05:30).
 */
export function parseCutoffAsIST(cutoffStr: string): Date {
  const trimmed = cutoffStr.trim();
  if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed)) {
    return new Date(trimmed);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}:00+05:30`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}+05:30`);
  }
  return new Date(trimmed);
}

const serviceDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Service date must be YYYY-MM-DD")
  .refine(isValidCalendarDate, { message: "Invalid calendar date" });

const cutoffSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      const d = parseCutoffAsIST(val);
      return !isNaN(d.getTime());
    },
    { message: "Invalid cutoff date and time" }
  )
  .refine(
    (val) => {
      const d = parseCutoffAsIST(val);
      return !isNaN(d.getTime()) && d.getTime() > Date.now();
    },
    { message: "Cutoff must be in the future" }
  );

const offeringItemSchema = z.object({
  menuItemId: z.string().min(1, "Menu item ID is required"),
  count: z
    .number({ invalid_type_error: "Counts must be positive integers" })
    .int("Counts must be positive integers")
    .positive("Counts must be positive integers"),
});

export const createServiceSchema = z.object({
  meal: z.nativeEnum(Meal, { errorMap: () => ({ message: "Invalid meal" }) }),
  serviceDate: serviceDateSchema,
  cutoffAt: cutoffSchema,
  offerings: z
    .array(offeringItemSchema)
    .min(1, "At least one dish must have a count"),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export type CreateServiceResult =
  | { ok: true; serviceId: string }
  | { ok: false; errorCode: ServiceErrorCode; error: string };

export type PublishServiceResult =
  | { ok: true }
  | { ok: false; errorCode: ServiceErrorCode; error: string };

function mapZodIssueToErrorCode(issue: z.ZodIssue | undefined): ServiceErrorCode {
  if (!issue) return "failed";
  const pathStr = issue.path[0] ? String(issue.path[0]) : "";

  if (pathStr === "meal") return "invalid_meal";
  if (pathStr === "serviceDate") return "invalid_date";
  if (pathStr === "cutoffAt") {
    return issue.message === "Cutoff must be in the future"
      ? "cutoff_past"
      : "invalid_cutoff";
  }
  if (pathStr === "offerings") {
    return issue.message === "At least one dish must have a count"
      ? "no_dishes"
      : "invalid_count";
  }
  return "failed";
}

export function parseCreateServiceFormData(
  formData: FormData,
  activeMenuItemIds: string[]
):
  | { success: true; data: CreateServiceInput }
  | { success: false; errorCode: ServiceErrorCode; error: string } {
  const meal = formData.get("meal");
  const serviceDate = formData.get("date") ?? formData.get("serviceDate");
  const cutoffAt = formData.get("cutoff") ?? formData.get("cutoffAt");

  const offerings: { menuItemId: string; count: number }[] = [];

  for (const itemId of activeMenuItemIds) {
    const rawVal =
      formData.get(`count_${itemId}`) ??
      formData.get(itemId);
    if (rawVal === null || rawVal === undefined) continue;
    const trimmed = String(rawVal).trim();
    if (trimmed === "") continue; // A dish left empty is not offered

    const num = Number(trimmed);
    offerings.push({
      menuItemId: itemId,
      count: num,
    });
  }

  const parsed = createServiceSchema.safeParse({
    meal,
    serviceDate,
    cutoffAt,
    offerings,
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const errorCode = mapZodIssueToErrorCode(firstIssue);
    const message = firstIssue?.message || "Invalid input";
    return { success: false, errorCode, error: message };
  }

  return { success: true, data: parsed.data };
}

export async function createService(
  input: CreateServiceInput
): Promise<CreateServiceResult> {
  const parsed = createServiceSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const errorCode = mapZodIssueToErrorCode(firstIssue);
    return {
      ok: false,
      errorCode,
      error: firstIssue?.message || "Invalid input",
    };
  }

  const { meal, serviceDate, cutoffAt, offerings } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dateUtc = new Date(`${serviceDate}T00:00:00.000Z`);
      const cutoffDate = parseCutoffAsIST(cutoffAt);

      const service = await tx.service.create({
        data: {
          meal,
          serviceDate: dateUtc,
          cutoffAt: cutoffDate,
          published: false,
          offerings: {
            create: offerings.map((o) => ({
              menuItemId: o.menuItemId,
              quantityTotal: o.count,
              quantityLeft: o.count,
            })),
          },
        },
        select: { id: true },
      });

      return service;
    });

    return { ok: true, serviceId: result.id };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        ok: false,
        errorCode: "duplicate",
        error: "A service for this meal and date already exists.",
      };
    }
    throw err;
  }
}

export async function publishService(
  serviceId: string
): Promise<PublishServiceResult> {
  if (!serviceId) {
    return { ok: false, errorCode: "invalid_id", error: "Service ID is required." };
  }

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });

    if (!service) {
      return { ok: false, errorCode: "not_found", error: "Service not found." };
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { published: true },
    });

    return { ok: true };
  } catch {
    return { ok: false, errorCode: "failed", error: "Failed to publish service." };
  }
}