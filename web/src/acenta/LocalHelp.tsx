import "./local-help.css";

export function LocalHelp({accessOnly = false}: {accessOnly?: boolean}) {
  return <div className="local-help">
    <p><strong>Ayuda dentro de Acenta</strong></p>
    <p>Esta ayuda es local: no envía tu conversación, documentos ni datos de acceso.</p>
    <p>No hay atención humana ni un plazo de respuesta comprometido.</p>
    <details>
      <summary>Acceso a tu cuenta</summary>
      <p>Usa el mismo método con el que entraste antes. Google y correo pueden crear cuentas separadas; no se vinculan automáticamente.</p>
      <p>Si un método figura como no disponible, esta ayuda no puede activarlo. Si aparece «Reintentar sesión» o «Reintentar acceso», usa ese control para comprobar el estado.</p>
      <p>Cuando esté habilitado el correo, el código es de 8 dígitos y caduca en 10 minutos. Revisa el código o solicita otro desde el formulario si ha caducado.</p>
      <p>Tras volver a iniciar sesión puedes recuperar lo confirmado en Mis recursos. El texto sin guardar puede perderse al cerrar sesión o caducar el acceso.</p>
    </details>
    {!accessOnly && <>
      <details>
        <summary>Chat y contexto</summary>
        <p>Siempre vuelves al mismo chat. «Revisar contexto» permite consultar y actualizar lo que se usa en los siguientes mensajes.</p>
        <p>Al enviar, el contexto se resume automáticamente cuando hace falta. El resumen puede perder detalles: revísalo y corrige las notas cuando sea necesario. El historial y los recursos se conservan.</p>
        <p>Resumen y respuesta usan el mismo presupuesto. Si no alcanza el saldo para ambos, el mensaje no se envía y tu texto permanece en el compositor.</p>
        <p>Reiniciar contexto conserva el historial, pero deja de usarlo en los siguientes envíos. Abrir un recurso no lo adjunta al chat.</p>
      </details>
      <details>
        <summary>Recursos y planeaciones</summary>
        <p>«Mis recursos» reúne originales, planeaciones, revisiones y borradores confirmados. Abre el recurso para consultar o retomar una edición.</p>
        <p>«Herramientas» → «Planeación de clase» abre el formulario. La disponibilidad de generación se indica allí; las demás herramientas marcadas como pendientes todavía no se pueden usar.</p>
        <p>Guarda las correcciones antes de imprimir. La impresión usa la revisión confirmada elegida; revisa siempre el contenido generado.</p>
      </details>
      <details>
        <summary>Cuando una operación no termina</summary>
        <p>Si el envío está pendiente o su resultado es incierto, usa «Consultar estado» en el chat o la consulta de generación en Planeación. Consultar no vuelve a generar.</p>
        <p>Una operación incierta puede bloquear nuevos envíos. Conserva el texto y consulta el mismo intento; no lo repitas como uno nuevo. Abrir o cerrar esta ayuda no cancela la operación ni libera su reserva.</p>
        <p>Ante un conflicto de contexto o guardado, revisa la versión confirmada y el aviso del formulario antes de continuar.</p>
      </details>
    </>}
  </div>;
}
