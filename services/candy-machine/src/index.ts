import "dotenv/config";
import cors from "cors";
import express from "express";

import { requireSharedSecret } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { internalRouter } from "./routes/internal.js";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  }),
);

app.use("/health", healthRouter);
app.use("/internal", requireSharedSecret, internalRouter);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`candy-machine service listening on :${port}`);
});
