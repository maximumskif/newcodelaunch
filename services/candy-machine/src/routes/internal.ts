import { Router } from "express";

import { candyMachineRouter } from "./candyMachine.js";
import { raydiumRouter } from "./raydium.js";
import { tokenRouter } from "./token.js";

export const internalRouter = Router();

internalRouter.get("/ping", (_req, res) => {
  res.json({ status: "ok", authenticated: true });
});

// Real Metaplex Umi / mpl-candy-machine transaction building — both the
// creator-side "launch a drop" flow and the buyer-side "mint from a live
// drop" flow, see docs/REBUILD_PROGRESS.md.
internalRouter.use("/candy-machine", candyMachineRouter);

// SPL token launch (Token Launchpad's Solana side) — same partially-signed,
// creator-wallet-signs-client-side model as the Candy Machine routes above.
internalRouter.use("/token", tokenRouter);

internalRouter.use("/raydium", raydiumRouter);
