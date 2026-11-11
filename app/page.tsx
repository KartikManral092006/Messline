import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { bookPlatesAction } from "./actions";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";
  clearSession();
  redirect("/");
}
// serviceDate is stored as midnight UTC of the local day (same as calendarDate in prisma/seed.ts)
function calendarDate(offsetDays: number) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays),
  );
}

function dayLabel(d: Date) {
  if (d.getTime() === calendarDate(0).getTime()) return "Today";
  if (d.getTime() === calendarDate(-1).getTime()) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function mealLabel(meal: string) {
  return meal.charAt(0).toUpperCase() + meal.slice(1).toLowerCase();
}

function priceLabel(included: boolean, priceRupees: number | null) {
  if (included) return "included";
  if (priceRupees == null) return "no price set";
  return `₹${priceRupees}`;
}

type Rating = { average: number; count: number };

function ratingLabel(rating: Rating | undefined) {
  if (!rating || rating.count === 0) return "no reviews";
  return `${rating.average.toFixed(1)} (${rating.count})`;
}

const bookingMessages: Record<string, string> = {
  booked: "Booked.",
  SOLD_OUT: "Sold out.",
  CUTOFF_PASSED: "Booking closed.",
  ALREADY_BOOKED: "Already booked.",
  INVALID_COUNT: "Invalid count.",
  NOT_FOUND: "Offering not found.",
  NOT_PUBLISHED: "Booking closed.",
  NOT_STUDENT: "Only students can book.",
};

export default async function Home({
  searchParams,
}: {
  searchParams?: { booked?: string; error?: string; message?: string };
}) {
  const message =
    searchParams?.booked === "1"
      ? bookingMessages.booked
      : searchParams?.error && bookingMessages[searchParams.error]
        ? bookingMessages[searchParams.error]
        : searchParams?.message && bookingMessages[searchParams.message]
          ? bookingMessages[searchParams.message]
          : undefined;

  let rows: {
    id: string;
    menuItemId: string;
    quantityLeft: number;
    quantityTotal: number;
    menuItem: {
      name: string;
      description: string;
      included: boolean;
      priceRupees: number | null;
    };
    service: { meal: string; serviceDate: Date; cutoffAt: Date };
  }[] = [];
  const ratings = new Map<string, Rating>();
  let dbDown = false;
  const user = await getCurrentUser();

  try {
    rows = await prisma.offering.findMany({
      where: {
        service: { published: true },
        menuItem: { active: true },
      },
      include: {
        menuItem: {
          select: {
            name: true,
            description: true,
            included: true,
            priceRupees: true,
          },
        },
        service: { select: { meal: true, serviceDate: true, cutoffAt: true } },
      },
      orderBy: [
        { service: { serviceDate: "desc" } },
        { service: { meal: "asc" } },
        { menuItem: { name: "asc" } },
      ],
    });

    // The database does the averaging, so no review rows are loaded.
    const grouped = await prisma.review.groupBy({
      by: ["menuItemId"],
      where: { menuItemId: { in: rows.map((row) => row.menuItemId) } },
      _avg: { stars: true },
      _count: { stars: true },
    });
    for (const group of grouped) {
      if (group._avg.stars != null) {
        ratings.set(group.menuItemId, {
          average: group._avg.stars,
          count: group._count.stars,
        });
      }
    }
  } catch {
    dbDown = true;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Messline</h1>
      <div className="mt-2 text-sm">
        {user ? (
          <form action={signOut} className="flex items-center gap-3">
            <span>Signed in as {user.name} ({user.role.toLowerCase()})</span>
            {user.role === "STUDENT" && (
              <Link href="/bookings" className="underline">
                My bookings
              </Link>
            )}
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/login" className="underline">
            Sign in
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-700">
        Sign-in and ratings work. Creating bookings and complaints don&apos;t have a
        page yet. Take a task from an issue.
      </p>

      {message && (
        <p role="status" className="mt-4 text-sm font-medium">
          {message}
        </p>
      )}

      {dbDown ? (
        <p className="mt-6 text-sm">
          Could not read Postgres. Check README for the docker and seed commands.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm">No published offerings found.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Menu</caption>
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" className="py-2 pr-3 font-medium">When</th>
              <th scope="col" className="py-2 pr-3 font-medium">Item</th>
              <th scope="col" className="py-2 pr-3 font-medium">Price</th>
              <th scope="col" className="py-2 pr-3 font-medium">Rating</th>
              <th scope="col" className="py-2 font-medium">Left</th>
              {user?.role === "STUDENT" && (
                <th scope="col" className="py-2 pl-3 font-medium">
                  <span className="sr-only">Book</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isPastCutoff = new Date() >= row.service.cutoffAt;
              const isOpen = row.quantityLeft > 0 && !isPastCutoff;

              return (
                <tr key={row.id} className="border-b border-neutral-200">
                  <td className="py-2 pr-3">
                    {dayLabel(row.service.serviceDate)} {mealLabel(row.service.meal)}
                  </td>
                  <td className="py-2 pr-3">
                    <div>
                      <Link
                        href={`/dishes/${row.menuItemId}`}
                        className="hover:underline"
                      >
                        {row.menuItem.name}
                      </Link>
                    </div>
                    {row.menuItem.description && (
                      <div className="text-xs text-neutral-500">
                        {row.menuItem.description}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {priceLabel(row.menuItem.included, row.menuItem.priceRupees)}
                  </td>
                  <td className="py-2 pr-3">
                    {ratingLabel(ratings.get(row.menuItemId))}
                  </td>
                  <td className="py-2">
                    {row.quantityLeft} / {row.quantityTotal}
                    {row.quantityLeft === 0 && (
                      <span className="ml-2 text-neutral-500">sold out</span>
                    )}
                    {row.quantityLeft > 0 && row.quantityLeft <= 5 && (
                      <span className="ml-2 text-neutral-500">few left</span>
                    )}
                  </td>
                  {user?.role === "STUDENT" && (
                    <td className="py-2 pl-3">
                      {isOpen && (
                        <form
                          action={bookPlatesAction}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="hidden"
                            name="offeringId"
                            value={row.id}
                          />
                          <input
                            type="number"
                            name="count"
                            defaultValue={1}
                            min={1}
                            className="w-16 rounded border border-neutral-300 px-2 py-1 text-sm"
                            aria-label={`Plates for ${row.menuItem.name}`}
                          />
                          <button
                            type="submit"
                            className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-800"
                          >
                            Book
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
