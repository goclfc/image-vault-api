import express from "express";
import cors from "cors";
import { migrate } from "./db";
import { authRouter } from "./auth";
import { uploadsRouter } from "./uploads";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);
app.use("/uploads", uploadsRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT || 3000);

migrate()
  .then(() => {
    app.listen(port, () => console.log(`backend listening on :${port}`));
  })
  .catch((err) => {
    console.error("migration failed", err);
    process.exit(1);
  });
