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
// Dev audio: freely licensed tracks from the Internet Archive / ccMixter.
// These are real, publicly accessible URLs that work without a CDN.
//
// Production: swap audioUrl / coverUrl for CDN paths once object storage
// is wired up (later phase). The title/artist/album metadata stays the same.
// ---------------------------------------------------------------------------

const songs = [
  // ── Publicly hosted, freely licensed tracks ────────────────────────────
  {
    title: "Journey (Instrumental)",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 173,
    coverUrl: "https://picsum.photos/seed/journey/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Journey.mp3",
  },
  {
    title: "Cipher",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 139,
    coverUrl: "https://picsum.photos/seed/cipher/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cipher.mp3",
  },
  {
    title: "Wholesome",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 208,
    coverUrl: "https://picsum.photos/seed/wholesome/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wholesome.mp3",
  },
  {
    title: "Sneaky Snitch",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 138,
    coverUrl: "https://picsum.photos/seed/sneaky/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3",
  },
  {
    title: "Pixel Peeker Polka",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 157,
    coverUrl: "https://picsum.photos/seed/pixel/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pixel%20Peeker%20Polka%20-%20faster.mp3",
  },
  {
    title: "Pamgaea",
    artist: "Kevin MacLeod",
    album: "Royalty Free Music",
    duration: 214,
    coverUrl: "https://picsum.photos/seed/pamgaea/300/300",
    audioUrl:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pamgaea.mp3",
  },
  {
    title: "Gymnopedie No. 1",
    artist: "Erik Satie",
    album: "Gymnopédies (Public Domain)",
    duration: 198,
    coverUrl: "https://picsum.photos/seed/satie/300/300",
    audioUrl:
      "https://upload.wikimedia.org/wikipedia/commons/e/e9/Gymnopedie_No._1.ogg",
  },
  {
    title: "Für Elise",
    artist: "Ludwig van Beethoven",
    album: "Piano Works (Public Domain)",
    duration: 175,
    coverUrl: "https://picsum.photos/seed/beethoven/300/300",
    audioUrl:
      "https://upload.wikimedia.org/wikipedia/commons/3/3d/Beethoven_F%C3%BCr_Elise.ogg",
  },
];

async function main() {
  console.log("Seeding song library...");

  // upsert so re-running the seed is safe — won't create duplicates
  let created = 0;
  let skipped = 0;

  for (const song of songs) {
    const existing = await prisma.song.findFirst({
      where: { title: song.title, artist: song.artist },
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
