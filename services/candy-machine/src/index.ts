import "dotenv/config";
import cors from "cors";
import express from "express";

import { requireSharedSecret } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { internalRouter } from "./routes/internal.js";

const app = express();
app.use(express.json());
// express.json() calls next(err) on a malformed body — with no error
// handler registered, that reaches Express's own default error handler,
// which (outside NODE_ENV=production, never set anywhere for this service)
// includes the full stack trace — internal file paths — in the response.
// This runs before requireSharedSecret below, so it's reachable by anyone,
// no shared secret needed. A generic 400 here, on any body-parser error,
// closes that regardless of NODE_ENV.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  next();
});
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  }),
);

app.use("/health", healthRouter);
app.use("/internal", requireSharedSecret, internalRouter);

// Final catch-all — anything that reaches here is an unexpected server
// error a route didn't handle itself. Same reasoning as above: never let
// Express's default handler put a stack trace in the response.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`candy-machine service listening on :${port}`);
});
