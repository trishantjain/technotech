const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ error: "No token" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // ✅ now available
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = { authMiddleware };