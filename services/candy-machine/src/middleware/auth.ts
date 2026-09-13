import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// A plain `===` comparison short-circuits on the first mismatched byte,
// making the comparison time a (minor, but real) side channel on the
// secret's contents. timingSafeEqual takes the same time regardless of
// where two buffers first differ; the length check ahead of it only leaks
// length equality, not any byte of either value.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// This service should never be reachable directly by end users — only by the
// Flask backend, over a private network, with this shared secret attached.
// Admin operations here hold the collection/candy-machine authority keypair.
export function requireSharedSecret(req: Request, res: Response, next: NextFunction) {
  const configuredSecret = process.env.CANDY_MACHINE_SHARED_SECRET;

  if (!configuredSecret) {
    res.status(500).json({ error: "CANDY_MACHINE_SHARED_SECRET is not configured" });
    return;
  }

  const provided = req.header("x-internal-secret");
  if (!provided || !safeEqual(provided, configuredSecret)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
