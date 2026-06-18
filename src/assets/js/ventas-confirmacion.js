/**
 * ventas-confirmacion.js
 * Lógica del botón "Confirmar ventas" en el módulo de ventas.
 *
 * Incluir en la vista de ventas:
 *   <script src="/assets/js/ventas-confirmacion.js"></script>
 *
 * El HTML debe tener:
 *   <button id="btn-confirmar-ventas" data-mes="6" data-anio="2026">Confirmar ventas</button>
 *   <div id="confirmacion-estado"></div>
 */

(function () {
  'use strict';

  const MESES = [
    '', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
  ];

  function fmtCLP(n) {
    return '$' + Number(n || 0).toLocaleString('es-CL');
  }

  /**
   * Verifica el estado de confirmación para mes/anio y actualiza la UI.
   */
  async function verificarEstado(btn, estadoEl, mes, anio) {
    try {
      const res  = await fetch(`/api/ventas/confirmacion-estado?mes=${mes}&anio=${anio}`);
      const data = await res.json();

      if (data.ok && data.confirmado) {
        bloquearBoton(btn, estadoEl, data.confirmacion);
      } else {
        habilitarBoton(btn);
      }
    } catch (e) {
      console.error('Error verificando estado de confirmación:', e);
    }
  }

  function bloquearBoton(btn, estadoEl, conf) {
    if (!btn) return;
    btn.disabled = true;
    btn.classList.remove('btn-primary', 'btn-warning');
    btn.classList.add('btn-success');
    btn.innerHTML = '<i class="lucide-check-circle" style="margin-right:6px"></i> Ventas confirmadas';

    if (estadoEl && conf) {
      const fecha = new Date(conf.fecha_confirmacion).toLocaleString('es-CL');
      estadoEl.innerHTML = `
        <div class="alert-confirmado" style="
          background:#f4fafa;border:1px solid #cedcd8;border-radius:6px;
          padding:10px 14px;font-size:13px;color:#01696f;margin-top:8px;
        ">
          ✅ Confirmado el <strong>${fecha}</strong>
          · ${conf.total_folios} folio(s)
          <a href="/api/ventas/confirmacion/${conf.id}/pdf" target="_blank"
             style="margin-left:12px;color:#01696f;font-weight:600">
            📄 Ver PDF
          </a>
        </div>`;
    }
  }

  function habilitarBoton(btn) {
    if (!btn) return;
    btn.disabled = false;
  }

  /**
   * Muestra el modal de confirmación y ejecuta la confirmación si el usuario acepta.
   */
  function mostrarModal(mes, anio, onConfirm) {
    // Elimina modal previo si existe
    const prev = document.getElementById('modal-confirmar-ventas');
    if (prev) prev.remove();

    const nombreMes = MESES[mes] || mes;
    const overlay   = document.createElement('div');
    overlay.id      = 'modal-confirmar-ventas';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;
      display:flex;align-items:center;justify-content:center;
    `;

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:10px;padding:32px 36px;
        max-width:480px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,.2);
        font-family:inherit;
      ">
        <h3 style="margin:0 0 8px;color:#222;font-size:17px">
          ⚠️ Confirmar ventas de ${nombreMes} ${anio}
        </h3>
        <p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:20px">
          Al confirmar declaras que <strong>todas tus ventas propias y asignadas
          están al día</strong>, no presentan descuadres ni información faltante.
          <br><br>
          <strong style="color:#c0392b">Esta acción no se puede deshacer.</strong>
          Se generará un PDF con el registro de esta confirmación.
        </p>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button id="modal-cancelar" style="
            padding:8px 20px;border-radius:6px;border:1px solid #ddd;
            background:#f5f5f5;cursor:pointer;font-size:14px;
          ">Cancelar</button>
          <button id="modal-aceptar" style="
            padding:8px 20px;border-radius:6px;border:none;
            background:#01696f;color:#fff;cursor:pointer;font-size:14px;font-weight:600;
          ">Sí, confirmar ventas</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    document.getElementById('modal-cancelar').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.getElementById('modal-aceptar').onclick  = () => {
      overlay.remove();
      onConfirm();
    };
  }

  /**
   * Ejecuta la confirmación vía POST /api/ventas/confirmar.
   */
  async function ejecutarConfirmacion(btn, estadoEl, mes, anio) {
    btn.disabled  = true;
    btn.innerHTML = '<span style="opacity:.7">Generando PDF…</span>';

    try {
      const res  = await fetch('/api/ventas/confirmar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mes, anio }),
      });
      const data = await res.json();

      if (data.ok) {
        bloquearBoton(btn, estadoEl, {
          id:                 data.id,
          fecha_confirmacion: new Date().toISOString(),
          total_folios:       data.totalFolios,
        });
        if (window.mostrarToast) {
          window.mostrarToast('✅ Ventas confirmadas correctamente', 'success');
        }
      } else {
        btn.disabled  = false;
        btn.innerHTML = 'Confirmar ventas';
        alert('Error: ' + (data.error || 'No se pudo confirmar'));
      }
    } catch (e) {
      console.error('Error al confirmar ventas:', e);
      btn.disabled  = false;
      btn.innerHTML = 'Confirmar ventas';
      alert('Error de red al confirmar. Intenta nuevamente.');
    }
  }

  // ── Inicialización ──
  document.addEventListener('DOMContentLoaded', () => {
    const btn      = document.getElementById('btn-confirmar-ventas');
    const estadoEl = document.getElementById('confirmacion-estado');
    if (!btn) return;

    const mes  = Number(btn.dataset.mes  || new Date().getMonth() + 1);
    const anio = Number(btn.dataset.anio || new Date().getFullYear());

    // Verificar estado al cargar
    verificarEstado(btn, estadoEl, mes, anio);

    // Click: mostrar modal y confirmar
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      mostrarModal(mes, anio, () => ejecutarConfirmacion(btn, estadoEl, mes, anio));
    });
  });
})();
