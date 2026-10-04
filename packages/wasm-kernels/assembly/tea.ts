/**
 * TEA decryption kernel for the `.toe` container (research use only — see
 * docs/TOE-FORMAT.md). AssemblyScript → WASM, embedded as base64 in
 * packages/io/src/teaWasm.ts by `npm run build:tea -w packages/wasm-kernels`.
 *
 * Why WASM: the container is TEA-ECB — 32 rounds of uint32 shuffling per
 * 8 bytes over the whole file. A tight integer loop with no allocation is
 * where WASM beats JS (~7×). Inflate is already native (DecompressionStream /
 * zlib), so TEA is the only hot spot.
 *
 * Memory contract: the host writes ciphertext into linear memory at the
 * pointer returned by `ensureCapacity`, calls `teaDecrypt`, and reads the
 * plaintext back from the same place (in place). Only whole 8-byte blocks are
 * processed; a shorter tail is left untouched, matching the format.
 */

const DELTA: u32 = 0x9e3779b9;

/**
 * Decrypt `len` bytes at `ptr` in place with the 128-bit key (k0..k3).
 * Returns the number of bytes actually processed (whole blocks only).
 */
export function teaDecrypt(
  ptr: usize,
  len: i32,
  k0: u32,
  k1: u32,
  k2: u32,
  k3: u32,
): i32 {
  const whole: i32 = len - (len & 7);
  const sum0: u32 = DELTA * 32;
  for (let off: i32 = 0; off < whole; off += 8) {
    const p: usize = ptr + <usize>off;
    let v0: u32 = load<u32>(p);       // little-endian on wasm
    let v1: u32 = load<u32>(p, 4);
    let sum: u32 = sum0;
    for (let r: i32 = 0; r < 32; r++) {
      v1 -= (((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >> 5) + k3));
      v0 -= (((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >> 5) + k1));
      sum -= DELTA;
    }
    store<u32>(p, v0);
    store<u32>(p, v1, 4);
  }
  return whole;
}

/** Grow linear memory to hold at least `bytes`; returns the base pointer. */
export function ensureCapacity(bytes: i32): usize {
  const needed: i32 = <i32>(<u64>bytes / 65536) + 2;
  const have: i32 = <i32>memory.size();
  if (have < needed) memory.grow(needed - have);
  return <usize>65536; // reserve page 0 for AS internals; buffer starts at 64K
}
