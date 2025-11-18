const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/authRequired');

const router = express.Router();

// GET /api/ofertas → listado general de ofertas del voluntario
router.get('/', authRequired, async (req, res) => {
  try {
    if (req.user.rol !== 'voluntario')
      return res.status(403).json({ error: 'Solo Voluntario' });

    const sql = `
      SELECT o.*, s.descripcion, s.estado AS estado_solicitud
      FROM ofertas o
      JOIN solicitudes s ON s.id = o.id_solicitud
      WHERE o.id_voluntario = ?
      ORDER BY o.id DESC
    `;
    const [rows] = await db.query(sql, [req.user.id]);
    res.json(rows);
  } catch (error) {
    console.log("Error GET /api/ofertas:", error);
    return res.status(500).json({ error: 'Error obteniendo ofertas' });
  }
});

router.post('/:solicitudId', authRequired, async (req, res) => {
  if (req.user.rol !== 'voluntario') return res.status(403).json({ error: 'Solo Voluntario' });
  const { mensaje } = req.body;
  const solicitudId = parseInt(req.params.solicitudId, 10);
  try {
    const [solRows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [solicitudId]);
    const sol = solRows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (sol.estado !== 'pendiente') return res.status(400).json({ error: 'Solicitud no disponible' });
    const [result] = await db.query('INSERT INTO ofertas (id_voluntario, id_solicitud, mensaje) VALUES (?,?,?)', [req.user.id, solicitudId, mensaje || null]);
    const io = req.app.get('io');
    io.to(`user:${sol.id_adulto_mayor}`).emit('notify', { type: 'nueva_oferta', solicitudId, fromUserId: req.user.id });
    const [rows] = await db.query('SELECT * FROM ofertas WHERE id = ?', [result.insertId]);
    return res.json(rows[0] || null);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo crear', detail: error.message });
  }
});

router.get('/solicitud/:solicitudId', authRequired, async (req, res) => {
  const solicitudId = parseInt(req.params.solicitudId, 10);
  try {
    const [solRows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [solicitudId]);
    const sol = solRows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (sol.id_adulto_mayor !== req.user.id) return res.status(403).json({ error: 'Prohibido' });
    const [rows] = await db.query('SELECT o.*, u.nombre as nombre_voluntario, u.reputacion FROM ofertas o JOIN usuarios u ON u.id = o.id_voluntario WHERE o.id_solicitud = ?', [solicitudId]);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

router.get('/mias', authRequired, async (req, res) => {
  if (req.user.rol !== 'voluntario') return res.status(403).json({ error: 'Solo Voluntario' });
  const sql = `SELECT o.*, s.descripcion, s.estado as estado_solicitud,
                 (SELECT COUNT(1) FROM calificaciones c WHERE c.id_solicitud = s.id AND c.id_reviewer = ?) as calificado_por_mi
          FROM ofertas o JOIN solicitudes s ON s.id = o.id_solicitud WHERE o.id_voluntario = ?`;
  try {
    const [rows] = await db.query(sql, [req.user.id, req.user.id]);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { estado } = req.body;
  if (!['aceptada','rechazada'].includes(estado)) return res.status(400).json({ error: 'Estado invǭlido' });
  try {
    const sql = 'SELECT o.*, s.id_adulto_mayor, s.estado as estado_sol FROM ofertas o JOIN solicitudes s ON s.id = o.id_solicitud WHERE o.id = ?';
    const [rows] = await db.query(sql, [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Oferta no encontrada' });
    if (row.id_adulto_mayor !== req.user.id) return res.status(403).json({ error: 'Prohibido' });
    if (estado === 'aceptada' && row.estado_sol !== 'pendiente') return res.status(400).json({ error: 'La solicitud no estǭ disponible' });

    await db.query('UPDATE ofertas SET estado = ? WHERE id = ?', [estado, req.params.id]);

    const io = req.app.get('io');
    io.to(`user:${row.id_voluntario}`).emit('notify', { type: 'oferta_' + estado, solicitudId: row.id_solicitud });

    if (estado === 'aceptada') {
      await db.query("UPDATE solicitudes SET estado = 'en_proceso' WHERE id = ?", [row.id_solicitud]);
      await db.query("UPDATE ofertas SET estado = 'rechazada' WHERE id_solicitud = ? AND id != ? AND estado = 'pendiente'", [row.id_solicitud, row.id]);
    }
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo actualizar', detail: error.message });
  }
});

module.exports = router;
