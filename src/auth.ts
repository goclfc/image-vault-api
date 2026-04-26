import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "7d";

export interface AuthedRequest extends Request {
  userId?: number;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing token" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as jwt.JwtPayload;
    const sub = Number(payload.sub);
    if (!Number.isFinite(sub)) return res.status(401).json({ error: "invalid token" });
    req.userId = sub;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

function sign(userId: number) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "email and password (min 6 chars) required" });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email.toLowerCase(), hash]
    );
    const user = rows[0];
    res.json({ token: sign(user.id), user });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "email already registered" });
    throw e;
  }
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password required" });
  }
  const { rows } = await pool.query(
    "SELECT id, email, password_hash FROM users WHERE email = $1",
    [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  res.json({ token: sign(user.id), user: { id: user.id, email: user.email } });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await pool.query("SELECT id, email FROM users WHERE id = $1", [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json({ user: rows[0] });
});
