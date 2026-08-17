import { Router } from "express";

import { candyMachineRouter } from "./candyMachine.js";

export const internalRouter = Router();

internalRouter.get("/ping", (_req, res) => {
  res.json({ status: "ok", authenticated: true });
});

// Real Metaplex Umi / mpl-candy-machine transaction building — both the
// creator-side "launch a drop" flow and the buyer-side "mint from a live
// drop" flow, see docs/REBUILD_PROGRESS.md.
internalRouter.use("/candy-machine", candyMachineRouter);
