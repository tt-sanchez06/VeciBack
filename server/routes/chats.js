const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/authRequired');

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const userId = req.user.id;
  const sql = `
    SELECT
      s.id as solicitud_id,
      s.descripcion,
      s.estado,
      s.cita_fecha,
      s.cita_lugar,
      s.id_adulto_mayor,
      am.nombre as am_nombre,
      am.apellido as am_apellido,
      am.correo as am_correo,
      am.telefono as am_telefono,
      am.direccion as am_direccion,
      am.foto_perfil as am_foto,
      am.rol as am_rol,
      am.reputacion as am_reputacion,
      o.id_voluntario,
      vol.nombre as vol_nombre,
      vol.apellido as vol_apellido,
      vol.correo as vol_correo,
      vol.telefono as vol_telefono,
      vol.direccion as vol_direccion,
      vol.foto_perfil as vol_foto,
      vol.rol as vol_rol,
      vol.reputacion as vol_reputacion,
      (
        SELECT mensaje FROM chats WHERE id_solicitud = s.id ORDER BY fecha_envio DESC, id DESC LIMIT 1
      ) as last_message,
      (
        SELECT fecha_envio FROM chats WHERE id_solicitud = s.id ORDER BY fecha_envio DESC, id DESC LIMIT 1
      ) as last_message_at,
      (
        SELECT id_emisor FROM chats WHERE id_solicitud = s.id ORDER BY fecha_envio DESC, id DESC LIMIT 1
      ) as last_message_from,
      (
        SELECT COUNT(1) FROM chats WHERE id_solicitud = s.id AND id_receptor = ? AND leido = 0
      ) as unread_count
    FROM solicitudes s
    LEFT JOIN ofertas o ON o.id_solicitud = s.id AND o.estado = 'aceptada'
    LEFT JOIN usuarios am ON am.id = s.id_adulto_mayor
    LEFT JOIN usuarios vol ON vol.id = o.id_voluntario
    WHERE o.id_voluntario IS NOT NULL AND (s.id_adulto_mayor = ? OR o.id_voluntario = ?)
    ORDER BY
      CASE WHEN last_message_at IS NULL THEN 1 ELSE 0 END,
      last_message_at DESC,
      s.id DESC`;
  try {
    const [rows] = await db.query(sql, [userId, userId, userId]);
    const conversations = (rows || []).map(row => {
      const isOwner = row.id_adulto_mayor === userId;
      const counterpart = isOwner ? {
        id: row.id_voluntario,
        nombre: row.vol_nombre,
        apellido: row.vol_apellido,
        correo: row.vol_correo,
        telefono: row.vol_telefono,
        direccion: row.vol_direccion,
        foto_perfil: row.vol_foto,
        rol: row.vol_rol,
        reputacion: row.vol_reputacion
      } : {
        id: row.id_adulto_mayor,
        nombre: row.am_nombre,
        apellido: row.am_apellido,
        correo: row.am_correo,
        telefono: row.am_telefono,
        direccion: row.am_direccion,
        foto_perfil: row.am_foto,
        rol: row.am_rol,
        reputacion: row.am_reputacion
      };
      const mine = isOwner ? {
        id: row.id_adulto_mayor,
        nombre: row.am_nombre,
        apellido: row.am_apellido,
        foto_perfil: row.am_foto,
        rol: row.am_rol
      } : {
        id: row.id_voluntario,
        nombre: row.vol_nombre,
        apellido: row.vol_apellido,
        foto_perfil: row.vol_foto,
        rol: row.vol_rol
      };
      return {
        solicitudId: row.solicitud_id,
        descripcion: row.descripcion,
        estado: row.estado,
        cita_fecha: row.cita_fecha,
        cita_lugar: row.cita_lugar,
        counterpart,
        mine,
        lastMessage: row.last_message || '',
        lastMessageAt: row.last_message_at || null,
        lastMessageFrom: row.last_message_from || null,
        unreadCount: row.unread_count || 0
      };
    });
    return res.json(conversations);
  } catch (error) {
    return res.status(500).json({ error: 'Error al cargar chats' });
  }
});

router.get('/:solicitudId', authRequired, async (req, res) => {
  const solicitudId = parseInt(req.params.solicitudId, 10);
  const sql = `
    SELECT s.*, (
      SELECT id_voluntario FROM ofertas WHERE id_solicitud = s.id AND estado = 'aceptada' LIMIT 1
    ) as voluntario_aceptado
    FROM solicitudes s WHERE s.id = ?`;
  try {
    const [rows] = await db.query(sql, [solicitudId]);
    const sol = rows[0];
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const isOwner = sol.id_adulto_mayor === req.user.id;
    const isAcceptedVol = sol.voluntario_aceptado === req.user.id;
    if (!isOwner && !isAcceptedVol) return res.status(403).json({ error: 'Prohibido' });
    const counterpartId = isOwner ? sol.voluntario_aceptado : sol.id_adulto_mayor;
    const [messages] = await db.query('SELECT * FROM chats WHERE id_solicitud = ? ORDER BY fecha_envio ASC, id ASC', [solicitudId]);
    return res.json({ counterpartId, messages });
  } catch (error) {
    return res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
