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
// audioUrl / coverUrl point to the CDN path pattern we'll use in production:
//   https://cdn.makemake.app/audio/<filename>
//   https://cdn.makemake.app/covers/<filename>
//
// For local development, swap the base URL in .env (STORAGE_BASE_URL) once
// we wire up object storage in a later phase. The filenames stay the same.
// ---------------------------------------------------------------------------

const songs = [
  {
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    duration: 200,
    coverUrl: "https://cdn.makemake.app/covers/blinding-lights.jpg",
    audioUrl: "https://cdn.makemake.app/audio/blinding-lights.mp3",
  },
  {
    title: "Levitating",
    artist: "Dua Lipa",
    album: "Future Nostalgia",
    duration: 203,
    coverUrl: "https://cdn.makemake.app/covers/levitating.jpg",
    audioUrl: "https://cdn.makemake.app/audio/levitating.mp3",
  },
  {
    title: "Stay",
    artist: "The Kid LAROI & Justin Bieber",
    album: "F*CK LOVE 3: OVER YOU",
    duration: 141,
    coverUrl: "https://cdn.makemake.app/covers/stay.jpg",
    audioUrl: "https://cdn.makemake.app/audio/stay.mp3",
  },
  {
    title: "Heat Waves",
    artist: "Glass Animals",
    album: "Dreamland",
    duration: 238,
    coverUrl: "https://cdn.makemake.app/covers/heat-waves.jpg",
    audioUrl: "https://cdn.makemake.app/audio/heat-waves.mp3",
  },
  {
    title: "As It Was",
    artist: "Harry Styles",
    album: "Harry's House",
    duration: 167,
    coverUrl: "https://cdn.makemake.app/covers/as-it-was.jpg",
    audioUrl: "https://cdn.makemake.app/audio/as-it-was.mp3",
  },
  {
    title: "Anti-Hero",
    artist: "Taylor Swift",
    album: "Midnights",
    duration: 200,
    coverUrl: "https://cdn.makemake.app/covers/anti-hero.jpg",
    audioUrl: "https://cdn.makemake.app/audio/anti-hero.mp3",
  },
  {
    title: "Unholy",
    artist: "Sam Smith ft. Kim Petras",
    album: "Gloria",
    duration: 156,
    coverUrl: "https://cdn.makemake.app/covers/unholy.jpg",
    audioUrl: "https://cdn.makemake.app/audio/unholy.mp3",
  },
  {
    title: "Flowers",
    artist: "Miley Cyrus",
    album: "Endless Summer Vacation",
    duration: 200,
    coverUrl: "https://cdn.makemake.app/covers/flowers.jpg",
    audioUrl: "https://cdn.makemake.app/audio/flowers.mp3",
  },
  {
    title: "Cruel Summer",
    artist: "Taylor Swift",
    album: "Lover",
    duration: 178,
    coverUrl: "https://cdn.makemake.app/covers/cruel-summer.jpg",
    audioUrl: "https://cdn.makemake.app/audio/cruel-summer.mp3",
  },
  {
    title: "Peaches",
    artist: "Justin Bieber ft. Daniel Caesar & Giveon",
    album: "Justice",
    duration: 198,
    coverUrl: "https://cdn.makemake.app/covers/peaches.jpg",
    audioUrl: "https://cdn.makemake.app/audio/peaches.mp3",
  },
  {
    title: "Bad Guy",
    artist: "Billie Eilish",
    album: "When We All Fall Asleep, Where Do We Go?",
    duration: 194,
    coverUrl: "https://cdn.makemake.app/covers/bad-guy.jpg",
    audioUrl: "https://cdn.makemake.app/audio/bad-guy.mp3",
  },
  {
    title: "Montero (Call Me By Your Name)",
    artist: "Lil Nas X",
    album: "Montero",
    duration: 137,
    coverUrl: "https://cdn.makemake.app/covers/montero.jpg",
    audioUrl: "https://cdn.makemake.app/audio/montero.mp3",
  },
  {
    title: "Industry Baby",
    artist: "Lil Nas X ft. Jack Harlow",
    album: "Montero",
    duration: 212,
    coverUrl: "https://cdn.makemake.app/covers/industry-baby.jpg",
    audioUrl: "https://cdn.makemake.app/audio/industry-baby.mp3",
  },
  {
    title: "good 4 u",
    artist: "Olivia Rodrigo",
    album: "SOUR",
    duration: 178,
    coverUrl: "https://cdn.makemake.app/covers/good-4-u.jpg",
    audioUrl: "https://cdn.makemake.app/audio/good-4-u.mp3",
  },
  {
    title: "drivers license",
    artist: "Olivia Rodrigo",
    album: "SOUR",
    duration: 242,
    coverUrl: "https://cdn.makemake.app/covers/drivers-license.jpg",
    audioUrl: "https://cdn.makemake.app/audio/drivers-license.mp3",
  },
  {
    title: "Watermelon Sugar",
    artist: "Harry Styles",
    album: "Fine Line",
    duration: 174,
    coverUrl: "https://cdn.makemake.app/covers/watermelon-sugar.jpg",
    audioUrl: "https://cdn.makemake.app/audio/watermelon-sugar.mp3",
  },
  {
    title: "Save Your Tears",
    artist: "The Weeknd",
    album: "After Hours",
    duration: 215,
    coverUrl: "https://cdn.makemake.app/covers/save-your-tears.jpg",
    audioUrl: "https://cdn.makemake.app/audio/save-your-tears.mp3",
  },
  {
    title: "Dynamite",
    artist: "BTS",
    album: "Dynamite",
    duration: 199,
    coverUrl: "https://cdn.makemake.app/covers/dynamite.jpg",
    audioUrl: "https://cdn.makemake.app/audio/dynamite.mp3",
  },
  {
    title: "Shivers",
    artist: "Ed Sheeran",
    album: "=",
    duration: 207,
    coverUrl: "https://cdn.makemake.app/covers/shivers.jpg",
    audioUrl: "https://cdn.makemake.app/audio/shivers.mp3",
  },
  {
    title: "Easy On Me",
    artist: "Adele",
    album: "30",
    duration: 224,
    coverUrl: "https://cdn.makemake.app/covers/easy-on-me.jpg",
    audioUrl: "https://cdn.makemake.app/audio/easy-on-me.mp3",
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
