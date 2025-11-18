const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function signToken(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const rawHeader = req.headers.authorization || req.headers.Authorization;
  if (!rawHeader) {
    return res.status(401).json({ error: 'No token' });
  }

  let token = rawHeader.trim();
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  } else if (token.includes(' ')) {
    const parts = token.split(' ');
    token = parts[parts.length - 1].trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

module.exports = { signToken, authRequired };
