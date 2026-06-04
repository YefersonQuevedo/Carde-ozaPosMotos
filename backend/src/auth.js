import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-motopos";

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, SECRET, { expiresIn: "12h" });
}

/// Middleware: exige token valido. Si se pasan roles, exige uno de ellos.
export function auth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No autenticado" });
    try {
      const payload = jwt.verify(token, SECRET);
      req.user = payload;
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "No autorizado para esta accion" });
      }
      next();
    } catch {
      return res.status(401).json({ error: "Sesion invalida o expirada" });
    }
  };
}
