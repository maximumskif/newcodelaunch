import { Router } from "express";

// Real Metaplex Umi / mpl-candy-machine routes (create collection, create candy
// machine, config lines, guards, build mint transactions) land here in Phase 6.
// For now this just proves the backend <-> service shared-secret contract works.
export const internalRouter = Router();

internalRouter.get("/ping", (_req, res) => {
  res.json({ status: "ok", authenticated: true });
});
