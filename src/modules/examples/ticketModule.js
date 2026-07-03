import axios from 'axios';

/**
 * Módulo: consulta_ticket
 *
 * Ejemplo de integración con un sistema de tickets REST.
 * Configura las variables de entorno en .env:
 *
 *   TICKETS_API_URL=https://tu-sistema.com/api
 *   TICKETS_API_KEY=tu-api-key
 *
 * El módulo se puede adaptar a Zendesk, Jira, Freshdesk, etc.
 * cambiando solo la función execute().
 */
export const ticketModule = {
  name: 'consulta_ticket',

  description:
    'Consulta el estado, detalles o historial de un ticket de soporte. ' +
    'Úsalo cuando el usuario pregunte por el estado de un ticket, ' +
    'un caso de soporte, una solicitud o un issue.',

  parameters: {
    type: 'object',
    properties: {
      ticket_id: {
        type: 'string',
        description: 'El ID o número del ticket a consultar (ej: "TK-1234", "4521")',
      },
    },
    required: ['ticket_id'],
  },

  async execute({ ticket_id }) {
    const baseUrl = process.env.TICKETS_API_URL;
    const apiKey  = process.env.TICKETS_API_KEY;

    if (!baseUrl || !apiKey) {
      // Modo demo: retorna datos ficticios si no hay API configurada
      return demoResponse(ticket_id);
    }

    const response = await axios.get(`${baseUrl}/tickets/${ticket_id}`, {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const t = response.data;

    return {
      data: t,
      summary:
        `Ticket #${t.id} — "${t.subject}" | ` +
        `Estado: ${t.status} | ` +
        `Prioridad: ${t.priority} | ` +
        `Asignado a: ${t.assignee || 'Sin asignar'} | ` +
        `Última actualización: ${t.updated_at}`,
    };
  },
};

function demoResponse(ticketId) {
  return {
    data: {
      id: ticketId,
      subject: 'Error al conectar con Facebook',
      status: 'En progreso',
      priority: 'Alta',
      assignee: 'Soporte Técnico',
      created_at: '2026-06-08T10:00:00Z',
      updated_at: '2026-06-10T09:30:00Z',
      description: 'El cliente reporta que no puede vincular su cuenta de Facebook.',
      comments: [
        { author: 'Agente', text: 'Revisando permisos de la app.', date: '2026-06-09' },
        { author: 'Agente', text: 'Se escala al equipo de integraciones.', date: '2026-06-10' },
      ],
    },
    summary:
      `Ticket #${ticketId} — "Error al conectar con Facebook" | ` +
      `Estado: En progreso | Prioridad: Alta | ` +
      `Asignado a: Soporte Técnico | Última actualización: 2026-06-10`,
  };
}
