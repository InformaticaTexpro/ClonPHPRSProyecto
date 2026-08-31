-- =============================================================================
-- Ajuste de iconos del grupo Soporte TI
-- Ejecutar en la BD local existente cuando los menús ya fueron creados.
-- No modifica nombre, URL, grupo, orden ni permisos.
-- =============================================================================

UPDATE `menu`
SET `icono` = 'dashboard'
WHERE `codigo` = 'soporte_ti_dashboard';

UPDATE `menu`
SET `icono` = 'monitor'
WHERE `codigo` = 'soporte_ti_equipos';

UPDATE `menu`
SET `icono` = 'clipboard'
WHERE `codigo` = 'soporte_ti_actividades';

UPDATE `menu`
SET `icono` = 'tools'
WHERE `codigo` = 'soporte_ti_mantenciones';

UPDATE `menu`
SET `icono` = 'boxes'
WHERE `codigo` = 'soporte_ti_bodega';
