import { hashPassword } from './auth';
import type { Db } from './db/prisma';
import type { Prisma } from './generated/prisma/client';
import { addDays, dayDate, localDay } from './services/clock';
import { geocode, haversineKm, POSTCODES } from './services/geo';

export const DEMO_PASSWORD = 'Tourwerk2026!';

const STREETS = [
  'Mönckebergstraße', 'Osterstraße', 'Eppendorfer Weg', 'Lange Reihe', 'Mühlenkamp', 'Fuhlsbüttler Straße', 'Wandsbeker Chaussee',
  'Bahrenfelder Straße', 'Grindelallee', 'Hoheluftchaussee', 'Hamburger Straße', 'Schulterblatt', 'Ottenser Hauptstraße', 'Bramfelder Straße',
  'Sievekingdamm', 'Billstedter Hauptstraße', 'Veringstraße', 'Kieler Straße', 'Alsterdorfer Straße', 'Steilshooper Straße', 'Max-Brauer-Allee',
  'Holstenstraße', 'Barmbeker Straße', 'Am Sandtorkai', 'Rothenbaumchaussee', 'Wexstraße', 'Dorotheenstraße', 'Hammer Landstraße',
];
const COMPANIES = [
  'Elbblick Apotheke', 'Kaffeerösterei Speicherstadt', 'Buchhandlung Seitenweise', 'Fahrradladen Kettenblatt', 'Atelier Nordlicht', 'Praxis Dr. Krüger',
  'Feinkost Albers', 'Blumen Hansen', 'Weinkontor Jessen', 'Optik Brandt', 'Bäckerei Körnerglück', 'Studio Hafenkante', 'Tischlerei Petersen',
  'Kanzlei Möller & Partner', 'Teehaus Lüdemann', 'Elektro Schröder', 'Hutmacherei Fink', 'Zweirad Ohlsen', 'Café Deichgraf', 'Reformhaus Thiel',
];
const PEOPLE = [
  'Anna Schulz', 'Mehmet Yılmaz', 'Sophie Becker', 'Lukas Wagner', 'Marie Neumann', 'Paul Richter', 'Fatima Haddad', 'Jan Petersen', 'Laura Koch',
  'Tobias Klein', 'Emilia Wolf', 'David Schäfer', 'Hannah Braun', 'Felix Zimmermann', 'Leonie Hartmann', 'Noah Krause', 'Mia Lange', 'Ben Schmitt',
];
const WINDOWS: [number, number][] = [
  [480, 1080], [480, 1080], [480, 1080], [480, 720], [540, 660], [600, 840], [720, 960], [840, 1080], [480, 600], [960, 1080],
];

/** Deterministic PRNG so every fresh database gets the same demo data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeds an empty database. Returns false if data already exists. */
export async function seed(db: Db, log: (m: string) => void = () => {}, today = localDay()) {
  if (await db.user.count()) return false;
  const rand = rng(20261116);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const hash = hashPassword(DEMO_PASSWORD);

  await db.user.createMany({
    data: [
      { email: 'admin@tourwerk.de', name: 'Lena Hoffmann', role: 'ADMIN', passwordHash: hash },
      { email: 'dispo@tourwerk.de', name: 'Jonas Weber', role: 'DISPATCHER', passwordHash: hash },
    ],
  });
  const driverNames = ['Kemal Arslan', 'Svenja Thomsen', 'Piotr Nowak', 'Greta Lindqvist', 'Malik Osei', 'Ole Jensen'];
  const drivers = [];
  for (const [i, name] of driverNames.entries()) {
    drivers.push(await db.user.create({ data: { email: `fahrer${i + 1}@tourwerk.de`, name, role: 'DRIVER', passwordHash: hash } }));
  }
  const depot = await db.depot.create({ data: { name: 'Depot Hamburg-Billbrook', address: 'Billbrookdeich 210, 22113 Hamburg', lat: 53.5378, lng: 10.0868 } });
  const fleet: [string, string, number, boolean][] = [
    ['HH-TW 101', 'Sprinter 1', 1100, false],
    ['HH-TW 102', 'Sprinter 2', 1100, false],
    ['HH-TW 103', 'Crafter', 950, false],
    ['HH-TW 201E', 'eSprinter', 800, true],
    ['HH-TW 202E', 'eVito', 650, true],
    ['HH-TW 301', 'Transit Custom', 700, false],
  ];
  const vehicles = [];
  for (const [i, [plate, label, capacityKg, electric]] of fleet.entries()) {
    vehicles.push(await db.vehicle.create({ data: { plate, label, capacityKg, electric, depotId: depot.id, driverId: drivers[i].id } }));
  }

  const postcodes = Object.keys(POSTCODES);
  let seq = 0;
  const makeOrder = (day: string, i: number): Prisma.OrderCreateManyInput => {
    const postcode = pick(postcodes);
    const street = `${pick(STREETS)} ${1 + Math.floor(rand() * 180)}`;
    const point = geocode(street, postcode)!;
    const [windowStart, windowEnd] = pick(WINDOWS);
    const parcels = 1 + Math.floor(rand() * rand() * 6);
    const business = rand() < 0.55;
    seq += 1;
    return {
      number: `TW-${day.slice(0, 4)}-${String(seq).padStart(5, '0')}`,
      externalRef: rand() < 0.6 ? `SHOP-${day.replaceAll('-', '')}-${String(i + 1).padStart(3, '0')}` : null,
      source: rand() < 0.6 ? 'WEBSHOP' : rand() < 0.5 ? 'ERP' : 'MANUAL',
      customer: business ? pick(COMPANIES) : pick(PEOPLE),
      phone: `040 ${Math.floor(1000000 + rand() * 8999999)}`,
      street,
      postcode,
      ...point,
      weightKg: +(parcels * (2 + rand() * 14)).toFixed(1),
      parcels,
      serviceMin: Math.min(15, 3 + parcels),
      windowStart,
      windowEnd,
      deliveryDay: dayDate(day),
      depotId: depot.id,
    };
  };

  // History: 14 completed days, planned with a simple sweep (by angle around the depot).
  const reasons = ['recipient_absent', 'recipient_absent', 'address_not_found', 'refused'];
  for (let back = 14; back >= 1; back -= 1) {
    const day = addDays(today, -back);
    const weekday = dayDate(day).getUTCDay();
    if (weekday === 0) continue; // no deliveries on Sundays
    const count = weekday === 6 ? 30 : 48 + Math.floor(rand() * 18);
    const orders = Array.from({ length: count }, (_, i) => makeOrder(day, i));
    orders.sort((a, b) => Math.atan2(a.lat - depot.lat, a.lng - depot.lng) - Math.atan2(b.lat - depot.lat, b.lng - depot.lng));
    const perVehicle = Math.ceil(orders.length / vehicles.length);
    for (const [vi, v] of vehicles.entries()) {
      const chunk = orders.slice(vi * perVehicle, (vi + 1) * perVehicle).filter((_, k, arr) => arr.slice(0, k + 1).reduce((s, o) => s + o.weightKg, 0) <= v.capacityKg);
      if (!chunk.length) continue;
      chunk.sort((a, b) => a.windowEnd - b.windowEnd || a.windowStart - b.windowStart); // respect windows roughly, like a real plan
      let t = depot.shiftStart;
      let pos = { lat: depot.lat, lng: depot.lng };
      let km = 0;
      const started = new Date(`${day}T06:00:00.000Z`);
      const plan: { eta: number; done: number; failed: boolean; at: Date }[] = [];
      let jam = 0; // traffic delay that builds up over the tour
      for (const o of chunk) {
        const d = haversineKm(pos, o) * 1.3;
        km += d;
        t = Math.max(t + Math.ceil((d / 26) * 60), o.windowStart);
        if (rand() < 0.1) jam += 10 + rand() * 30;
        const drift = Math.round((rand() - 0.5) * 12 + jam + (vi === 5 ? 15 : 0)); // the Transit tends to run late
        // Some stops run over the window regardless (parking, long handover, wrong entrance).
        const overrun = rand() < 0.07 ? Math.max(0, o.windowEnd - t) + 5 + Math.round(rand() * 35) : 0;
        const done = Math.max(t - 5, t + drift + overrun);
        const failed = rand() < (o.postcode === '21107' ? 0.12 : 0.035);
        plan.push({ eta: t, done, failed, at: new Date(started.getTime() + (done - depot.shiftStart) * 60_000) });
        t += o.serviceMin ?? 4;
        pos = o;
      }
      await db.order.createMany({
        data: chunk.map((o, k) =>
          plan[k].failed ? { ...o, status: 'FAILED' as const, failReason: pick(reasons) } : { ...o, status: 'DELIVERED' as const, deliveredAt: plan[k].at },
        ),
      });
      const ids = new Map((await db.order.findMany({ where: { number: { in: chunk.map((o) => o.number) } }, select: { id: true, number: true } })).map((o) => [o.number, o.id]));
      const stops: Prisma.StopCreateManyTourInput[] = chunk.map((o, k) => ({
        seq: k + 1,
        etaMin: plan[k].eta,
        status: plan[k].failed ? 'FAILED' : 'DELIVERED',
        arrivedAt: plan[k].at,
        completedAt: plan[k].at,
        completedMin: plan[k].done,
        orderId: ids.get(o.number)!,
      }));
      const back = haversineKm(pos, depot) * 1.3;
      km += back;
      await db.tour.create({
        data: {
          day: dayDate(day),
          status: 'COMPLETED',
          plannedKm: +km.toFixed(2),
          drivenKm: +(km * (1.02 + rand() * 0.08)).toFixed(2),
          plannedReturn: t + Math.ceil((back / 26) * 60),
          loadKg: chunk.reduce((s, o) => s + o.weightKg, 0),
          optimizerEngine: 'native',
          startedAt: started,
          completedAt: new Date(started.getTime() + (t - depot.shiftStart) * 60_000),
          depotId: depot.id,
          vehicleId: v.id,
          stops: { createMany: { data: stops } },
        },
      });
    }
    // Leftover orders that did not fit were delivered the next day in reality; keep the history simple.
  }
  await db.order.updateMany({ where: { status: { in: ['DELIVERED', 'FAILED'] } }, data: { exportedAt: new Date() } });

  // Today and tomorrow: unplanned orders waiting for the dispatcher.
  await db.order.createMany({ data: Array.from({ length: 64 }, (_, i) => makeOrder(today, i)) });
  await db.order.createMany({ data: Array.from({ length: 22 }, (_, i) => makeOrder(addDays(today, 1), i)) });
  await db.$executeRawUnsafe(`SELECT setval('order_number_seq', ${seq + 1000})`);
  log(`seed: ${await db.order.count()} orders, ${await db.tour.count()} historic tours, ${vehicles.length} vehicles`);
  return true;
}
