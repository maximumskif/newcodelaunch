import type { NextFunction, Request, Response } from "express";

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
  if (provided !== configuredSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
