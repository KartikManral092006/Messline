"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { bookPlates } from "@/lib/booking";

export async function bookPlatesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.STUDENT) {
    redirect("/?error=NOT_STUDENT");
  }

  const offeringId = String(formData.get("offeringId") ?? "");
  const count = Number(formData.get("count"));

  const result = await bookPlates(user.id, offeringId, count);

  revalidatePath("/");

  if (!result.ok) {
    redirect(`/?error=${result.reason}`);
  }

  redirect("/?booked=1");
}
