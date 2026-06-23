'use strict';

/**
 * routes/dashboard.panel.js
 *
 * Rutas específicas del panel coordinador de Ventas Asignadas.
 *
 * Mantiene visible la tabla "Folios Asignados" con todas las asignaciones
 * administrables por el coordinador, independiente del filtro mes/año usado
 * por la tabla "Ventas del Mes".
 */

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { requireAuth } = require('../middlewares/requireAuth');

router.use(requireAuth);

function getCodigosCoordinador(usuario) {
  return (usuario?.vendedores || [])
    .filter(v => v.tipo === 'C')
    .map(v => v.cod_vendedor)
    .filter(Boolean);
}

// GET /api/dashboard/asignados
// El panel coordinador debe mostrar todas las asignaciones creadas por sus
// códigos coordinadores. No se filtra por mes/anio aunque el frontend envíe
// esos parámetros, porque ese filtro ocultaba asignaciones históricas vigentes.
router.get('/asignados', async (req, res) => {
  const codigosCoord = getCodigosCoordinador(req.usuario);
  if (!codigosCoord.length) return res.json({ ok: true, asignados: [] });

  try {
    const placeholders = codigosCoord.map(() => '?').join(',');
    const [rows] = await db.pool.query(`
      SELECT
        fc.id,
        fc.folio,
        fc.fecha,
        fc.cliente,
        fc.monto_neto,
        fc.monto_asignado,
        fc.porcentaje,
        fc.cod_vendedor_principal,
        fc.cod_vendedor_compartido,
        fc.nombre_vendedor_compartido,
        fc.mes,
        fc.anio
      FROM factura_compartida fc
      WHERE fc.cod_vendedor_principal IN (${placeholders})
        AND fc.rol = 'compartido'
      ORDER BY fc.fecha DESC, fc.folio DESC
    `, codigosCoord);

    res.json({ ok: true, asignados: rows });
  } catch (err) {
    console.error('[GET /api/dashboard/asignados panel]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener folios asignados' });
  }
});

module.exports = router;
