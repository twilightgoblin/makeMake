"use strict";
// -----------------------------------------------------------------------------
// Makemake — Room code generator
// Produces a 6-character alphanumeric code (uppercase letters + digits).
// Excludes visually ambiguous characters: 0, O, I, 1.
// Example output: "A3KX7Q"
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRoomCode = generateRoomCode;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode(length = 6) {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
}
//# sourceMappingURL=roomCode.js.map