import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { cancelBooking, CancelBookingError } from "@/lib/booking";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My bookings | Messline",
};

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

const cancelMessages: Record<string, string> = {
  cancelled: "Cancelled.",
  "not-found": "Booking not found.",
  "not-booked": "Only a booking that is still BOOKED can be cancelled.",
};

async function cancel(formData: FormData) {
  "use server";

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "STUDENT") redirect("/");

  const bookingId = String(formData.get("bookingId") ?? "");

  let message: keyof typeof cancelMessages;
  try {
    await cancelBooking(user.id, bookingId);
    message = "cancelled";
  } catch (err) {
    if (err instanceof CancelBookingError) {
      message = err.code === "NOT_BOOKED" ? "not-booked" : "not-found";
    } else {
      throw err; // real errors (DB down, etc.) are not a failed cancel
    }
  }
  redirect(`/bookings?message=${message}`);
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { message?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "STUDENT") redirect("/");

  const bookings = await prisma.booking.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      count: true,
      status: true,
      offering: {
        select: {
          menuItem: { select: { name: true } },
          service: {
            select: { meal: true, serviceDate: true, cutoffAt: true },
          },
        },
      },
    },
    orderBy: { offering: { service: { serviceDate: "desc" } } },
  });

  // Newest service first: later date, then later meal on the same day.
  const mealOrder: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
  bookings.sort((a, b) => {
    const dateDiff =
      b.offering.service.serviceDate.getTime() -
      a.offering.service.serviceDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return (
      mealOrder[b.offering.service.meal] - mealOrder[a.offering.service.meal]
    );
  });

  const now = new Date();
  const message = searchParams.message
    ? cancelMessages[searchParams.message]
    : undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">My bookings</h1>
      <p className="mt-2 text-sm">
        <Link href="/" className="underline">
          Back to home
        </Link>
      </p>

      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}

      {bookings.length === 0 ? (
        <p className="mt-6 text-sm">No bookings yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="block w-full border-collapse text-left text-sm sm:table">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-neutral-300">
                <th scope="col" className="py-2 pr-3 font-medium">When</th>
                <th scope="col" className="py-2 pr-3 font-medium">Dish</th>
                <th scope="col" className="py-2 pr-3 font-medium">Count</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {bookings.map((booking) => {
                const { service } = booking.offering;
                const booked = booking.status === "BOOKED";
                const beforeCutoff = now < service.cutoffAt;
                return (
                  <tr
                    key={booking.id}
                    className="mb-4 block border-b border-neutral-200 pb-3 sm:mb-0 sm:table-row sm:pb-0"
                  >
                    <td className="block py-0.5 sm:table-cell sm:py-2 sm:pr-3">
                      <span className="mr-2 text-xs text-neutral-500 sm:hidden">
                        When
                      </span>
                      {dayLabel(service.serviceDate)} {mealLabel(service.meal)}
                    </td>
                    <td className="block py-0.5 sm:table-cell sm:py-2 sm:pr-3">
                      <span className="mr-2 text-xs text-neutral-500 sm:hidden">
                        Dish
                      </span>
                      {booking.offering.menuItem.name}
                    </td>
                    <td className="block py-0.5 sm:table-cell sm:py-2 sm:pr-3">
                      <span className="mr-2 text-xs text-neutral-500 sm:hidden">
                        Count
                      </span>
                      {booking.count}
                    </td>
                    <td className="block py-0.5 sm:table-cell sm:py-2 sm:pr-3">
                      <span className="mr-2 text-xs text-neutral-500 sm:hidden">
                        Status
                      </span>
                      {booking.status}
                    </td>
                    <td className="block py-0.5 sm:table-cell sm:py-2">
                      {booked && (
                        <form action={cancel}>
                          <input
                            type="hidden"
                            name="bookingId"
                            value={booking.id}
                          />
                          <button type="submit" className="underline">
                            Cancel
                          </button>
                          <span className="mt-1 block text-xs text-neutral-500 sm:ml-2 sm:mt-0 sm:inline">
                            {beforeCutoff
                              ? "The plates go back."
                              : "Cancelling won't return the plates."}
                          </span>
                        </form>
                      )}
                    </td>
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
