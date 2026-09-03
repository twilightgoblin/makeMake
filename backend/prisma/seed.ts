import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Seed data — global song library
//
// These are popular YouTube videos used for testing.
// ---------------------------------------------------------------------------

const songs = [
  {
    title: "Rick Astley - Never Gonna Give You Up",
    artist: "Rick Astley",
    album: "Whenever You Need Somebody",
    duration: 212,
    coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    provider: "youtube",
    externalId: "dQw4w9WgXcQ",
  },
  {
    title: "lofi hip hop radio - beats to relax/study to",
    artist: "Lofi Girl",
    album: "Lofi hip hop",
    duration: 0,
    coverUrl: "https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg",
    provider: "youtube",
    externalId: "jfKfPfyJRdk",
  },
  {
    title: "Darude - Sandstorm",
    artist: "Darude",
    album: "Before the Storm",
    duration: 232,
    coverUrl: "https://i.ytimg.com/vi/y6120QOlsfU/hqdefault.jpg",
    provider: "youtube",
    externalId: "y6120QOlsfU",
  },
];

async function main() {
  console.log("Seeding song library...");

  let created = 0;
  let skipped = 0;

  for (const song of songs) {
    const existing = await prisma.song.findFirst({
      where: { provider: song.provider, externalId: song.externalId },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.song.create({ data: song });
    created++;
  }

  const total = await prisma.song.count();

  console.log(`Done.`);
  console.log(`  Created : ${created}`);
  console.log(`  Skipped : ${skipped} (already existed)`);
  console.log(`  Total   : ${total} songs in library`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
