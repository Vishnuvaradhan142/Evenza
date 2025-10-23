import jwt from "jsonwebtoken";

// Middleware to verify JWT token
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");

    if (!decoded.user_id) {
      return res.status(400).json({ message: "Invalid token payload: user_id missing" });
    }

    req.user = {
      user_id: decoded.user_id,
      username: decoded.username,
      role: decoded.role,
    };
    next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};
