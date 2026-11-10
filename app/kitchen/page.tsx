import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Meal, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  createService,
  parseCreateServiceFormData,
  publishService,
} from "@/lib/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kitchen | Messline",
};

function calendarDate(offsetDays: number) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays)
  );
}

function dayLabel(d: Date) {
  if (d.getTime() === calendarDate(0).getTime()) return "Today";
  if (d.getTime() === calendarDate(1).getTime()) return "Tomorrow";
  if (d.getTime() === calendarDate(-1).getTime()) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function mealLabel(meal: string) {
  return meal.charAt(0).toUpperCase() + meal.slice(1).toLowerCase();
}

function formatCutoff(d: Date) {
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function handleCreateService(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user || user.role !== Role.KITCHEN) {
    redirect("/");
  }

  const activeItems = await prisma.menuItem.findMany({
    where: { active: true },
    select: { id: true },
  });
  const activeIds = activeItems.map((item) => item.id);

  const parsed = parseCreateServiceFormData(formData, activeIds);
  if (!parsed.success) {
    redirect(`/kitchen?error=${encodeURIComponent(parsed.error)}`);
  }

  const result = await createService(parsed.data);
  if (!result.ok) {
    redirect(`/kitchen?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/kitchen");
  revalidatePath("/");
  redirect("/kitchen?created=1");
}

async function handlePublishService(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user || user.role !== Role.KITCHEN) {
    redirect("/");
  }

  const serviceId = formData.get("serviceId");
  if (typeof serviceId !== "string" || !serviceId) {
    redirect(`/kitchen?error=${encodeURIComponent("Invalid service ID")}`);
  }

  const result = await publishService(serviceId);
  if (!result.ok) {
    redirect(`/kitchen?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/kitchen");
  revalidatePath("/");
  redirect("/kitchen?published=1");
}

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: { error?: string; created?: string; published?: string };
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== Role.KITCHEN) {
    redirect("/");
  }

  const activeMenuItems = await prisma.menuItem.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  );

  const upcomingServices = await prisma.service.findMany({
    where: {
      serviceDate: {
        gte: todayUtc,
      },
    },
    include: {
      offerings: {
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          menuItem: { name: "asc" },
        },
      },
    },
    orderBy: [
      { serviceDate: "asc" },
      { meal: "asc" },
    ],
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Kitchen</h1>
        <Link href="/" className="text-sm underline">
          Back to home
        </Link>
      </div>

      <p className="mt-1 text-sm text-neutral-600">
        Signed in as {user.name} ({user.role.toLowerCase()})
      </p>

      {searchParams.error && (
        <div
          role="alert"
          className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {searchParams.error}
        </div>
      )}

      {searchParams.created && (
        <div
          role="status"
          className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700"
        >
          Service created successfully.
        </div>
      )}

      {searchParams.published && (
        <div
          role="status"
          className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700"
        >
          Service published.
        </div>
      )}

      <section className="mt-8 rounded border border-neutral-200 p-6">
        <h2 className="text-lg font-medium">Create a Service</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Set meal, date, cutoff time, and plate counts. Dishes left empty will not
          be offered.
        </p>

        <form action={handleCreateService} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block text-sm">
              Meal
              <select
                name="meal"
                required
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm bg-white"
              >
                <option value={Meal.BREAKFAST}>Breakfast</option>
                <option value={Meal.LUNCH}>Lunch</option>
                <option value={Meal.DINNER}>Dinner</option>
              </select>
            </label>

            <label className="block text-sm">
              Service Date
              <input
                name="date"
                type="date"
                required
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              Cutoff Date & Time
              <input
                name="cutoff"
                type="datetime-local"
                required
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-neutral-900">
              Active Menu Items (Plates)
            </h3>
            <p className="text-xs text-neutral-500">
              Enter plate count for dishes to include. Empty dishes are omitted.
            </p>

            <div className="mt-3 divide-y divide-neutral-100 rounded border border-neutral-200">
              {activeMenuItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3"
                >
                  <div>
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {item.included ? "included" : `₹${item.priceRupees ?? 0}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      name={`count_${item.id}`}
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Plates"
                      className="w-28 rounded border border-neutral-300 px-3 py-1 text-sm text-right"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
          >
            Create service
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Upcoming Services</h2>
        {upcomingServices.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">
            No upcoming services found.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {upcomingServices.map((service) => (
              <div
                key={service.id}
                className="rounded border border-neutral-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3">
                  <div>
                    <span className="text-base font-medium">
                      {dayLabel(service.serviceDate)} {mealLabel(service.meal)}
                    </span>
                    <span className="ml-3 text-xs text-neutral-500">
                      Cutoff: {formatCutoff(service.cutoffAt)}
                    </span>
                  </div>
                  <div>
                    {service.published ? (
                      <span className="rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700 border border-green-200">
                        Published
                      </span>
                    ) : (
                      <form action={handlePublishService} className="inline">
                        <input
                          type="hidden"
                          name="serviceId"
                          value={service.id}
                        />
                        <button
                          type="submit"
                          className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-800"
                        >
                          Publish
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Offerings
                  </div>
                  {service.offerings.length === 0 ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      No offerings added.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-neutral-100 text-sm">
                      {service.offerings.map((offering) => (
                        <li
                          key={offering.id}
                          className="flex items-center justify-between py-1.5"
                        >
                          <span>{offering.menuItem.name}</span>
                          <span className="text-neutral-600">
                            {offering.quantityLeft} / {offering.quantityTotal} plates
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

