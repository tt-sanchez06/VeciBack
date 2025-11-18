const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('../db');
const { authRequired } = require('../middleware/authRequired');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_');
    cb(null, `pf_${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nombre, apellido, edad, telefono, direccion, documento_identificacion, correo, rol, foto_perfil, reputacion FROM usuarios WHERE id = ?',
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

router.put('/me', authRequired, upload.single('foto_perfil'), async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      edad,
      telefono,
      direccion,
      documento_identificacion,
      contrasena
    } = req.body || {};
    const foto = req.file ? `/uploads/${req.file.filename}` : null;

    const [rows] = await db.query('SELECT * FROM usuarios WHERE id = ?', [req.user.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Usuario no encontrado' });

    const edadValor = typeof edad !== 'undefined' && edad !== null && edad !== '' ? parseInt(edad, 10) : row.edad;
    if (edadValor && (row.rol === 'adulto_mayor' ? edadValor < 60 : edadValor < 18)) {
      return res.status(400).json({ error: row.rol === 'adulto_mayor' ? 'Edad minima 60' : 'Edad minima 18' });
    }
    if (telefono && !/^\d{10}$/.test(String(telefono).trim())) {
      return res.status(400).json({ error: 'Telefono debe tener 10 digitos' });
    }
    let documentoValor = row.documento_identificacion;
    if (typeof documento_identificacion !== 'undefined' && documento_identificacion !== null && documento_identificacion !== '') {
      if (!/^\d+$/.test(String(documento_identificacion).trim())) {
        return res.status(400).json({ error: 'Documento debe ser numerico' });
      }
      documentoValor = parseInt(String(documento_identificacion).trim(), 10);
    }

    const telefonoNormalizado = telefono ? String(telefono).trim() : '';
    const direccionNormalizada = typeof direccion === 'string' ? direccion.trim() : undefined;

    const updates = {
      nombre: nombre || row.nombre,
      apellido: apellido || row.apellido,
      edad: edadValor,
      telefono: telefonoNormalizado || row.telefono,
      direccion: row.rol === 'adulto_mayor' ? (direccionNormalizada || row.direccion) : row.direccion,
      documento_identificacion: documentoValor,
      foto_perfil: foto || row.foto_perfil,
      password_hash: row.password
    };

    const contrasenaNormalizada = typeof contrasena === 'string' ? contrasena.trim() : '';
    if (contrasenaNormalizada) {
      updates.password_hash = await bcrypt.hash(contrasenaNormalizada, 10);
    }

    const sql = `
      UPDATE usuarios
      SET nombre = ?, apellido = ?, edad = ?, telefono = ?, direccion = ?, documento_identificacion = ?, foto_perfil = ?, password = ?
      WHERE id = ?
    `;
    const params = [
      updates.nombre,
      updates.apellido,
      updates.edad,
      updates.telefono,
      updates.direccion,
      updates.documento_identificacion,
      updates.foto_perfil,
      updates.password_hash,
      req.user.id
    ];
    await db.query(sql, params);
    const [dataRows] = await db.query(
      'SELECT id, nombre, apellido, edad, telefono, direccion, documento_identificacion, correo, rol, foto_perfil, reputacion FROM usuarios WHERE id = ?',
      [req.user.id]
    );
    return res.json(dataRows[0] || null);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo actualizar', detail: error.message });
  }
});

module.exports = router;
