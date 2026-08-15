import { Router } from "express";

import { candyMachineRouter } from "./candyMachine.js";

export const internalRouter = Router();

internalRouter.get("/ping", (_req, res) => {
  res.json({ status: "ok", authenticated: true });
});

// Real Metaplex Umi / mpl-candy-machine transaction building. Mint-time
// routes (build a buyer's mint transaction) aren't built yet — this is the
// creator-side "launch a drop" flow only, see docs/REBUILD_PROGRESS.md.
internalRouter.use("/candy-machine", candyMachineRouter);
