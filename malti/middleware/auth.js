import "dotenv/config";
import jwt from "jsonwebtoken";

// No fallback: a guessable default would let anyone mint valid tokens.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("[malti auth] JWT_SECRET is not set — refusing to start");

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, logout: true, error: "Authentication required." });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { sub: String(payload.sub), email: payload.email ?? "", role: payload.role };
    return next();
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    return res.status(401).json({
      success: false,
      logout: true,
      error: isExpired ? "Session expired. Please log in again." : "Invalid token.",
    });
  }
}
