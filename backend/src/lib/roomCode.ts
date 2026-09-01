// -----------------------------------------------------------------------------
// Makemake — Room code generator
// Produces a 6-character alphanumeric code (uppercase letters + digits).
// Excludes visually ambiguous characters: 0, O, I, 1.
// Example output: "A3KX7Q"
// -----------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
