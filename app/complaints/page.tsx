import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Complaints | Messline",
};

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

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export default async function ComplaintsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "STUDENT") redirect("/");

  const complaints = await prisma.complaint.findMany({
    where: { userId: user.id },
    include: {
      menuItem: { select: { name: true } },
      service: { select: { meal: true, serviceDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My complaints</h1>
        <Link
          href="/complaints/new"
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          File a complaint
        </Link>
      </div>

      <p className="mt-2 text-sm text-neutral-700">
        Your submitted complaints. The mess secretary reviews and acknowledges them.
      </p>

      {complaints.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          You haven&apos;t filed any complaints yet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-300">
                <th className="py-2 pr-3 font-medium">Service</th>
                <th className="py-2 pr-3 font-medium">Dish</th>
                <th className="py-2 pr-3 font-medium">Complaint</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((complaint) => (
                <tr key={complaint.id} className="border-b border-neutral-200">
                  <td className="py-2 pr-3 align-top whitespace-nowrap">
                    {`${dayLabel(complaint.service.serviceDate)} ${mealLabel(complaint.service.meal)}`}
                  </td>
                  <td className="py-2 pr-3 align-top font-medium">
                    {complaint.menuItem.name}
                  </td>
                  <td className="py-2 pr-3 align-top text-neutral-700 whitespace-pre-wrap">
                    {complaint.body}
                  </td>
                  <td className="py-2 align-top whitespace-nowrap">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        complaint.status === "OPEN"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {statusLabel(complaint.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-sm">
        <Link href="/" className="underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}

