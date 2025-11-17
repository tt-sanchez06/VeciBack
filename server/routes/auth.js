const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { signToken, authRequired } = require('../middleware/authRequired');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(__dirname, '../../public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_');
    cb(null, `pf_${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

router.post('/register', upload.single('foto_perfil'), async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      edad,
      telefono,
      direccion,
      documento_identificacion,
      correo,
      rol,
      contrasena
    } = req.body || {};

    if (!nombre || !apellido || !edad || !telefono || !documento_identificacion || !correo || !contrasena || !rol) {
      return res.status(400).json({ error: 'Campos requeridos faltantes' });
    }
    if (!['adulto_mayor', 'voluntario'].includes(rol)) {
      return res.status(400).json({ error: 'Rol invalido' });
    }
    if (rol === 'adulto_mayor' && !direccion) {
      return res.status(400).json({ error: 'Direccion requerida para Adulto Mayor' });
    }

    const edadNum = parseInt(edad, 10);
    if (!edadNum || (rol === 'adulto_mayor' ? edadNum < 60 : edadNum < 18)) {
      return res.status(400).json({ error: rol === 'adulto_mayor' ? 'Edad minima 60' : 'Edad minima 18' });
    }
    const telefonoNormalizado = String(telefono || '').trim();
    if (!/^\d{10}$/.test(telefonoNormalizado)) {
      return res.status(400).json({ error: 'Telefono debe tener 10 digitos' });
    }
    if (!/^\d+$/.test(String(documento_identificacion || '').trim())) {
      return res.status(400).json({ error: 'Documento debe ser numerico' });
    }

    const documentoValor = parseInt(String(documento_identificacion).trim(), 10);
    const foto = req.file ? `/uploads/${req.file.filename}` : null;
    const hash = await bcrypt.hash(contrasena, 10);
    const sql = `
      INSERT INTO usuarios (nombre, apellido, edad, telefono, direccion, documento_identificacion, correo, password, rol, foto_perfil)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `;
    const params = [
      nombre,
      apellido,
      edadNum,
      telefonoNormalizado,
      rol === 'adulto_mayor' ? direccion : null,
      documentoValor,
      correo,
      hash,
      rol,
      foto
    ];
    const [result] = await db.query(sql, params);
    const user = { id: result.insertId, nombre, apellido, correo, rol, foto_perfil: foto, reputacion: 0 };
    const token = signToken({ id: user.id, rol: user.rol, correo: user.correo });
    return res.json({ token, user });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Correo ya registrado' });
    }
    return res.status(500).json({ error: 'Error al registrar', detail: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const correo = (req.body && req.body.correo) || '';
    const rawPass = (req.body && (req.body.contrasena ?? req.body.password ?? req.body.pass ?? req.body.contrasenia)) || '';
    if (!correo || !rawPass) {
      return res.status(400).json({ error: 'Correo y contrasena requeridos' });
    }

    const [rows] = await db.query('SELECT * FROM usuarios WHERE correo = ? LIMIT 1', [correo]);
    const user = rows[0];
    const storedHash = user ? (user.password || user.contrasena || user['contraseña']) : null;
    if (!user || !storedHash) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const ok = await bcrypt.compare(rawPass, storedHash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const token = signToken({ id: user.id, rol: user.rol, correo: user.correo });
    delete user.password;
    delete user.contrasena;
    delete user['contraseña'];
    return res.json({ token, user });
  } catch (error) {
    return res.status(500).json({ error: 'Error en autenticacion', detail: error.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, apellido, edad, telefono, direccion, documento_identificacion, correo, rol, foto_perfil, reputacion FROM usuarios WHERE id = ?',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
