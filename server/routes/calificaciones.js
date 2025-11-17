const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/authRequired');

const router = express.Router();

router.post('/:solicitudId', authRequired, async (req, res) => {
  const solicitudId = parseInt(req.params.solicitudId, 10);
  const { puntuacion, comentario } = req.body;
  const punt = parseInt(puntuacion, 10);
  if (isNaN(punt) || punt < 1 || punt > 5) return res.status(400).json({ error: 'Puntuación 1-5' });
  try {
    const sql = `SELECT s.*, 
             (SELECT id_voluntario FROM ofertas WHERE id_solicitud = s.id AND estado='aceptada' LIMIT 1) as id_voluntario,
             (SELECT COUNT(1) FROM ofertas WHERE id_solicitud = s.id AND id_voluntario = ?) as hizo_oferta
          FROM solicitudes s WHERE s.id = ?`;
    const [rows] = await db.query(sql, [req.user.id, solicitudId]);
    const sol = rows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (sol.estado !== 'finalizada') return res.status(400).json({ error: 'Debe estar finalizada' });
    if (!sol.id_voluntario) return res.status(400).json({ error: 'No hay voluntario aceptado' });

    const userId = Number(req.user.id);
    const isAM = req.user.rol === 'adulto_mayor' && Number(sol.id_adulto_mayor) === userId;
    // Relajamos la restricci��n: cualquier usuario con rol 'voluntario' puede calificar una solicitud finalizada
    const isVOL = req.user.rol === 'voluntario';
    if (!isAM && !isVOL) return res.status(403).json({ error: 'Prohibido' });

    const idVol = sol.id_voluntario;
    const idAM = sol.id_adulto_mayor;
    const [existRows] = await db.query('SELECT id FROM calificaciones WHERE id_solicitud = ? AND id_reviewer = ?', [solicitudId, req.user.id]);
    if (existRows.length) return res.json({ ok: true, already: true });
    await db.query('INSERT INTO calificaciones (id_voluntario, id_adulto_mayor, id_solicitud, autor, id_reviewer, puntuacion, comentario) VALUES (?,?,?,?,?,?,?)',
      [idVol, idAM, solicitudId, (isAM?'adulto_mayor':'voluntario'), req.user.id, punt, comentario || null]);
    const targetUserId = isAM ? idVol : idAM;
    const avgSql = 'SELECT AVG(puntuacion) as avg FROM calificaciones WHERE ' + (isAM ? 'id_voluntario' : 'id_adulto_mayor') + ' = ?';
    const [avgRows] = await db.query(avgSql, [targetUserId]);
    const avg = avgRows[0] ? avgRows[0].avg : null;
    if (avg !== null && typeof avg !== 'undefined') {
      await db.query('UPDATE usuarios SET reputacion = ? WHERE id = ?', [avg, targetUserId]);
    }
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo calificar', detail: error.message });
  }
});

module.exports = router;
