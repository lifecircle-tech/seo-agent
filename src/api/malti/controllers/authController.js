import { legacyPool } from "../models/db.js";
import jwt from "jsonwebtoken";

const JWT_SECRET  = process.env.JWT_SECRET  ?? "malti_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN ?? "7d";

// Replication of malti.php encrypt() — XOR table cipher + double base64
function encrypt(data) {
  let c = 48;
  const table = new Array(256);
  for (let i = 0, key = 27; i <= 255; i++, key = (key + 1) & 0xff) {
    c = ((key ^ (c << 1)) & 0xff);
    table[key] = c;
  }
  const buf = Buffer.from(data, "binary");
  for (let i = 0; i < buf.length; i++) {
    buf[i] = table[buf[i]];
  }
  return Buffer.from(Buffer.from(buf).toString("base64")).toString("base64");
}

function issueToken(employee) {
  return jwt.sign(
    { sub: String(employee.det_id), email: employee.det_email ?? "", role: employee.det_role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

export async function login(req, res) {
  const { mobile, password } = req.body;
  if (!mobile || !password) {
    return res.status(400).json({ success: false, error: "mobile and password required" });
  }
  try {
    const encrypted = encrypt(password);
    const [rows] = await legacyPool.query(
      "SELECT det_id, emp_name, det_email, det_mobile, det_role, det_branch FROM life_emp_details WHERE det_mobile = ? AND det_password = ? LIMIT 1",
      [mobile, encrypted]
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, error: "Invalid mobile or password" });
    }
    const emp = rows[0];
    if (emp.det_role !== 9) {
      return res.status(403).json({ success: false, error: "Access restricted to Super Admin only" });
    }
    const token = issueToken(emp);
    return res.json({
      success: true,
      token,
      user: { id: emp.det_id, name: emp.emp_name, email: emp.det_email, role: emp.det_role }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export async function googleLogin(req, res) {
  const { id_token } = req.body;
  if (!id_token) return res.status(400).json({ success: false, error: "id_token required" });
  try {
    const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
    if (!gRes.ok) return res.status(401).json({ success: false, error: "Invalid Google token" });
    const gData = await gRes.json();
    const email = gData.email;
    if (!email) return res.status(401).json({ success: false, error: "Email not found in Google token" });

    const [rows] = await legacyPool.query(
      "SELECT det_id, emp_name, det_email, det_mobile, det_role, det_branch FROM life_emp_details WHERE det_email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) return res.status(401).json({ success: false, error: "Email not registered" });
    const emp = rows[0];
    if (emp.det_role !== 9) return res.status(403).json({ success: false, error: "Access restricted to Super Admin only" });

    const token = issueToken(emp);
    return res.json({
      success: true,
      token,
      user: { id: emp.det_id, name: emp.emp_name, email: emp.det_email, role: emp.det_role }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err.message ?? err) });
  }
}

export function me(req, res) {
  return res.json({ success: true, user: req.user });
}
