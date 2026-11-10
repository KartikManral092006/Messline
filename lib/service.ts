import { Meal, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";

const serviceDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Service date must be YYYY-MM-DD");

const cutoffSchema = z
  .string()
  .trim()
  .refine(
    (val) => {
      const d = new Date(val);
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
  | { ok: false; error: string };

export type PublishServiceResult =
  | { ok: true }
  | { ok: false; error: string };

export function parseCreateServiceFormData(
  formData: FormData,
  activeMenuItemIds: string[]
): { success: true; data: CreateServiceInput } | { success: false; error: string } {
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
    const message = parsed.error.errors[0]?.message || "Invalid input";
    return { success: false, error: message };
  }

  return { success: true, data: parsed.data };
}

export async function createService(
  input: CreateServiceInput
): Promise<CreateServiceResult> {
  const parsed = createServiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message || "Invalid input",
    };
  }

  const { meal, serviceDate, cutoffAt, offerings } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dateUtc = new Date(`${serviceDate}T00:00:00.000Z`);
      const cutoffDate = new Date(cutoffAt);

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
    return { ok: false, error: "Service ID is required." };
  }

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });

    if (!service) {
      return { ok: false, error: "Service not found." };
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { published: true },
    });

    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to publish service." };
  }
}

