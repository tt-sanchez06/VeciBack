const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/authRequired');
const { haversineDistanceKm } = require('../utils/distance');

const router = express.Router();

router.post('/', authRequired, async (req, res) => {
  if (req.user.rol !== 'adulto_mayor') return res.status(403).json({ error: 'Solo Adulto Mayor' });
  const { descripcion, tipo_ayuda, direccion, latitud, longitud } = req.body;
  if (!descripcion || !tipo_ayuda) return res.status(400).json({ error: 'Campos requeridos faltantes' });
  try {
    const [result] = await db.query(
      'INSERT INTO solicitudes (id_adulto_mayor, descripcion, tipo_ayuda, direccion, latitud, longitud) VALUES (?,?,?,?,?,?)',
      [req.user.id, descripcion, tipo_ayuda, direccion || null, latitud || null, longitud || null]
    );
    const [rows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [result.insertId]);
    return res.json(rows[0] || null);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo crear', detail: error.message });
  }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const { tipo, lat, lng, max_km, mine } = req.query;
    let sql = `SELECT s.*, u.nombre as nombre_adulto,
             (SELECT COUNT(1) FROM calificaciones c WHERE c.id_solicitud = s.id AND c.id_reviewer = ?) as calificado_por_mi
             FROM solicitudes s JOIN usuarios u ON u.id = s.id_adulto_mayor`;
    const params = [req.user.id];

    const wheres = [];
    if (req.user.rol === 'voluntario') {
      wheres.push("s.estado = 'pendiente'");
    }
    if (mine === '1') {
      wheres.push('s.id_adulto_mayor = ?');
      params.push(req.user.id);
    }
    if (tipo) {
      wheres.push('s.tipo_ayuda = ?');
      params.push(tipo);
    }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');

    const [rows] = await db.query(sql, params);
    let data = rows;
    if (lat && lng && max_km) {
      const latN = parseFloat(lat), lngN = parseFloat(lng), maxN = parseFloat(max_km);
      data = rows.filter(r => {
        const d = haversineDistanceKm(latN, lngN, r.latitud, r.longitud);
        return d === null ? true : d <= maxN;
      });
    }
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    return res.json(row);
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

router.put('/:id/estado', authRequired, async (req, res) => {
  const { estado } = req.body;
  if (!['pendiente','en_proceso','finalizada'].includes(estado)) return res.status(400).json({ error: 'Estado invǭlido' });
  try {
    const [rows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    if (row.id_adulto_mayor !== req.user.id) return res.status(403).json({ error: 'Prohibido' });
    await db.query('UPDATE solicitudes SET estado = ? WHERE id = ?', [estado, req.params.id]);
    if (estado === 'finalizada') {
      const [accepted] = await db.query("SELECT id_voluntario FROM ofertas WHERE id_solicitud = ? AND estado = 'aceptada' LIMIT 1", [req.params.id]);
      const r2 = accepted[0];
      if (r2 && r2.id_voluntario) {
        const io = req.app.get('io');
        io.to(`user:${r2.id_voluntario}`).emit('notify', { type: 'solicitud_finalizada', solicitudId: Number(req.params.id) });
      }
    }
    return res.json({ ok: true, estado });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo actualizar', detail: error.message });
  }
});

router.put('/:id/cita', authRequired, async (req, res) => {
  const { cita_fecha, cita_lugar } = req.body;
  const id = parseInt(req.params.id, 10);
  const sql = `SELECT s.*, (SELECT id_voluntario FROM ofertas WHERE id_solicitud = s.id AND estado='aceptada' LIMIT 1) as id_voluntario
               FROM solicitudes s WHERE s.id = ?`;
  try {
    const [rows] = await db.query(sql, [id]);
    const sol = rows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const isOwner = sol.id_adulto_mayor === req.user.id;
    const isVol = sol.id_voluntario === req.user.id;
    if (!isOwner && !isVol) return res.status(403).json({ error: 'Prohibido' });
    await db.query('UPDATE solicitudes SET cita_fecha = ?, cita_lugar = ? WHERE id = ?', [cita_fecha || null, cita_lugar || null, id]);
    const io = req.app.get('io');
    const notifyTo = isOwner ? sol.id_voluntario : sol.id_adulto_mayor;
    if (notifyTo) {
      io.to(`user:${notifyTo}`).emit('notify', { type: 'cita_actualizada', solicitudId: id, cita_fecha, cita_lugar });
    }
    return res.json({ ok: true, cita_fecha, cita_lugar });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo coordinar', detail: error.message });
  }
});

module.exports = router;
