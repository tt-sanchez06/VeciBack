require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const db = require('./db');

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
const publicDir = path.resolve(__dirname, '../public');
const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

app.use(morgan('dev'));

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/solicitudes', require('./routes/solicitudes'));
app.use('/api/ofertas', require('./routes/ofertas'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/calificaciones', require('./routes/calificaciones'));

// HTTPS support
const PORT = process.env.PORT || 3000;
const SSL_KEY = process.env.SSL_KEY;
const SSL_CERT = process.env.SSL_CERT;

let server;
try {
  if (SSL_KEY && SSL_CERT && fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
    const options = { key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) };
    server = https.createServer(options, app);
    console.log('HTTPS habilitado');
  } else {
    server = http.createServer(app);
    console.log('Usando HTTP');
  }
} catch (e) {
  server = http.createServer(app);
}

// Socket.io
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ----------------------
//  SOCKET.IO - MYSQL
// ----------------------
io.on('connection', (socket) => {
  socket.on('authenticate', (token) => {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      socket.data.user = user;
      socket.join(`user:${user.id}`);
      socket.emit('auth_ok', { id: user.id, rol: user.rol });
    } catch (err) {
      socket.emit('auth_error', 'Token inválido');
    }
  });

  socket.on('join_solicitud', (solicitudId) => {
    if (!socket.data.user) return;
    socket.join(`solicitud:${solicitudId}`);
  });

  // 🔥 Insertar mensaje usando MySQL
  socket.on('send_message', async (payload) => {
    const user = socket.data.user;
    if (!user) return;

    const { solicitudId, toUserId, mensaje } = payload || {};
    if (!solicitudId || !toUserId || !mensaje) return;

    try {
      const sql = "INSERT INTO chats (id_solicitud, id_emisor, id_receptor, mensaje) VALUES (?,?,?,?)";
      const [result] = await db.query(sql, [solicitudId, user.id, toUserId, mensaje]);

      const chatMsg = {
        id: result.insertId,
        id_solicitud: solicitudId,
        id_emisor: user.id,
        id_receptor: toUserId,
        mensaje,
        leido: 0,
        fecha_envio: new Date().toISOString()
      };

      io.to(`solicitud:${solicitudId}`).emit('new_message', chatMsg);
      io.to(`user:${toUserId}`).emit('notify', {
        type: 'message',
        solicitudId,
        fromUserId: user.id,
        mensaje,
      });

      socket.emit('delivered', { id: chatMsg.id, solicitudId });
    } catch (err) {
      console.log("Error enviando mensaje:", err);
    }
  });

  // Marcar como leído
  socket.on('mark_read', async ({ messageId, solicitudId }) => {
    const user = socket.data.user;
    if (!user) return;

    try {
      await db.query(
        "UPDATE chats SET leido = 1 WHERE id = ? AND id_receptor = ?",
        [messageId, user.id]
      );

      io.to(`solicitud:${solicitudId}`).emit('read', {
        id: messageId,
        solicitudId,
        byUserId: user.id
      });
    } catch (err) {}
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

// ----------------------
//  RECORDATORIO DE CITAS
//  VERSIÓN MySQL
// ----------------------
const notified = new Set();

setInterval(async () => {
  const now = Date.now();
  const windows = [24 * 60 * 60 * 1000, 60 * 60 * 1000];

  try {
    const sql = `
      SELECT s.id, s.id_adulto_mayor, s.cita_fecha,
        (SELECT id_voluntario FROM ofertas WHERE id_solicitud = s.id AND estado='aceptada' LIMIT 1) as id_voluntario
      FROM solicitudes s
      WHERE estado='en_proceso' AND cita_fecha IS NOT NULL
    `;

    const [rows] = await db.query(sql);

    rows.forEach(r => {
      const time = new Date(r.cita_fecha).getTime();
      if (!time) return;

      windows.forEach(w => {
        const key = `${r.id}:${w}`;

        if (!notified.has(key) &&
            Math.abs(time - now) < w + 30000 &&
            Math.abs(time - now) > w - 30000) {

          notified.add(key);

          const payload = { type: 'reminder', solicitudId: r.id, inMs: w };
          io.to(`user:${r.id_adulto_mayor}`).emit('notify', payload);

          if (r.id_voluntario) {
            io.to(`user:${r.id_voluntario}`).emit('notify', payload);
          }
        }
      });
    });
  } catch (err) {
    console.log("Error recordatorios:", err);
  }
}, 30000);