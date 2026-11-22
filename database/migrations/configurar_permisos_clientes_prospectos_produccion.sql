-- Política explícita de release C&P. Ejecutar después de la migración base.
-- Sólo perfil_menu: no modifica usuario_menu, solicitudes ni Control de Clientes.
INSERT INTO perfil_menu (perfil_id,menu_id,activo)
SELECT p.id,m.id,CASE WHEN p.codigo IN ('administracion','admin') THEN 1 ELSE 0 END
FROM perfil p CROSS JOIN menu m
WHERE p.codigo IN ('ventas','cobranza','administracion','admin')
 AND m.codigo IN ('ventas_clientes_prospectos','cobranza_clientes_prospectos')
ON DUPLICATE KEY UPDATE activo=VALUES(activo);
