import { BookingStatus, ComplaintStatus, Meal, PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

// Today lunch: biryani has 2 plates, cutoff is 2 hours from seed time.
// Today dinner: rajma chawal, 35 plates, included in the mess plan, cutoff is 8 hours from seed time.
// Today breakfast: poha, 30 plates, included in the mess plan; boiled eggs, 10 plates, extra (Rs 20).
// Yesterday lunch: sambar, cutoff already passed, so a complaint has a dish to attach to.
// Complaints: Meera has one open complaint about yesterday's sambar.
// Reviews: veg thali has two, biryani and sambar have one, poha and boiled eggs have none.
// Bookings: Meera has one BOOKED booking, 1 veg thali at today's lunch (veg thali shows 39 / 40).

function calendarDate(offsetDays: number) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

async function main() {
  await prisma.review.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.offering.deleteMany();
  await prisma.service.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.user.deleteMany();

  const studentPass = await hash("student123", 10);
  const kitchenPass = await hash("kitchen123", 10);
  const secretaryPass = await hash("secretary123", 10);

  await prisma.user.createMany({
    data: [
      {
        name: "Meera Iyer",
        email: "meera@messline.dev",
        password: studentPass,
        role: Role.STUDENT,
      },
      {
        name: "Kabir Shah",
        email: "kabir@messline.dev",
        password: studentPass,
        role: Role.STUDENT,
      },
      {
        name: "Kitchen",
        email: "kitchen@messline.dev",
        password: kitchenPass,
        role: Role.KITCHEN,
      },
      {
        name: "Anita Deshmukh",
        email: "secretary@messline.dev",
        password: secretaryPass,
        role: Role.SECRETARY,
      },
    ],
  });

  const [thali, biryani, sambar, poha, boiledEggs, rajmaChawal] = await Promise.all([
    prisma.menuItem.create({
      data: {
        name: "Veg thali",
        description: "Rice, dal, sabzi, roti, curd.",
        ingredients: "rice, toor dal, seasonal vegetable, wheat, curd, salt, oil",
        included: true,
      },
    }),
    prisma.menuItem.create({
      data: {
        name: "Chicken biryani",
        description: "Sunday-style biryani. Limited plates.",
        ingredients: "basmati rice, chicken, onion, yogurt, mint, chili, biryani masala",
        included: false,
        priceRupees: 90,
      },
    }),
    prisma.menuItem.create({
      data: {
        name: "Sambar",
        description: "Yesterday's lunch dal. Use this when filing a complaint in dev.",
        ingredients: "toor dal, drumstick, tomato, tamarind, sambar powder",
        included: true,
      },
    }),
    prisma.menuItem.create({
      data: {
        name: "Poha",
        description: "Flattened rice cooked with onion, peanuts and turmeric.",
        ingredients: "flattened rice, onion, peanuts, mustard seeds, curry leaves, turmeric, lemon, oil",
        included: true,
      },
    }),
    prisma.menuItem.create({
      data: {
        name: "Boiled eggs",
        description: "Two hard-boiled eggs with black pepper and salt.",
        ingredients: "eggs, salt, black pepper",
        included: false,
        priceRupees: 20,
      },
    }),
    prisma.menuItem.create({
      data: {
        name: "Rajma chawal",
        description: "Red kidney beans in spiced gravy served with steamed basmati rice.",
        ingredients: "kidney beans, basmati rice, onion, tomato, ginger, garlic, garam masala, salt, oil",
        included: true,
      },
    }),
  ]);

  const todayBreakfast = await prisma.service.create({
    data: {
      meal: Meal.BREAKFAST,
      serviceDate: calendarDate(0),
      cutoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      published: true,
    },
  });

  const todayLunch = await prisma.service.create({
    data: {
      meal: Meal.LUNCH,
      serviceDate: calendarDate(0),
      cutoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      published: true,
    },
  });

  const todayDinner = await prisma.service.create({
    data: {
      meal: Meal.DINNER,
      serviceDate: calendarDate(0),
      cutoffAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      published: true,
    },
  });

  const yesterdayLunch = await prisma.service.create({
    data: {
      meal: Meal.LUNCH,
      serviceDate: calendarDate(-1),
      cutoffAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
      published: true,
    },
  });

  await prisma.offering.createMany({
    data: [
      {
        serviceId: todayBreakfast.id,
        menuItemId: poha.id,
        quantityTotal: 30,
        quantityLeft: 30,
      },
      {
        serviceId: todayBreakfast.id,
        menuItemId: boiledEggs.id,
        quantityTotal: 10,
        quantityLeft: 10,
      },
      {
        serviceId: todayLunch.id,
        menuItemId: thali.id,
        quantityTotal: 40,
        quantityLeft: 39, // Meera's seeded booking takes 1
      },
      {
        serviceId: todayLunch.id,
        menuItemId: biryani.id,
        quantityTotal: 2,
        quantityLeft: 2,
      },
      {
        serviceId: todayDinner.id,
        menuItemId: rajmaChawal.id,
        quantityTotal: 35,
        quantityLeft: 35,
      },
      {
        serviceId: yesterdayLunch.id,
        menuItemId: sambar.id,
        quantityTotal: 80,
        quantityLeft: 0,
      },
    ],
  });
  // Reviews from the two seeded students, at most one per student per dish.
  // Veg thali has two, biryani and sambar have one, poha and boiled eggs have none.
  const meera = await prisma.user.findUniqueOrThrow({
    where: { email: "meera@messline.dev" },
  });
  const kabir = await prisma.user.findUniqueOrThrow({
    where: { email: "kabir@messline.dev" },
  });

  await prisma.review.createMany({
    data: [
      { userId: meera.id, menuItemId: thali.id, stars: 5 },
      { userId: kabir.id, menuItemId: thali.id, stars: 4 },
      { userId: kabir.id, menuItemId: biryani.id, stars: 5 },
      { userId: meera.id, menuItemId: sambar.id, stars: 2 },
    ],
  });

  await prisma.complaint.create({
    data: {
      userId: meera.id,
      menuItemId: sambar.id,
      serviceId: yesterdayLunch.id,
      body: "Sambar was cold and too watery.",
      status: ComplaintStatus.OPEN,
    },
  });

  // One booking: Meera, 1 veg thali at today's lunch. quantityLeft above is already 39.
  const thaliOffering = await prisma.offering.findUniqueOrThrow({
    where: {
      serviceId_menuItemId: { serviceId: todayLunch.id, menuItemId: thali.id },
    },
  });

  await prisma.booking.create({
    data: {
      userId: meera.id,
      offeringId: thaliOffering.id,
      count: 1,
      status: BookingStatus.BOOKED,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });