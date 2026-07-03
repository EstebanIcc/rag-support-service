import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: false });

/**
 * Módulo: jelou_ticket
 * Consulta el estado y asignación de un ticket en la base de datos Jelou.
 *
 * Estructura de respuesta esperada:
 * {
 *   pagination: { ... },
 *   results: [ { Ticket, Estado, Tech_Support, Usuario, Compania, ... } ]
 * }
 */
export const jelouTicketModule = {
  name: 'consulta_ticket',

  description:
    'Consulta el estado de un ticket de soporte en el sistema Jelou. ' +
    'Usalo cuando el usuario pregunte por el estado de un ticket, quien tiene asignado un ticket, ' +
    'a que tecnico esta asignado, o cualquier informacion sobre un ticket de soporte tecnico. ' +
    'Requiere el ID o número del ticket (ej: "TSWA2321", "19652").',

  parameters: {
    type: 'object',
    properties: {
      ticket_id: {
        type: 'string',
        description: 'ID o número del ticket a consultar (ej: "TSWA2321", "19652")',
      },
    },
    required: ['ticket_id'],
  },

  async execute({ ticket_id }) {
    const token = process.env.JELOU_API_TOKEN ||
      'cFM1T2lrUUt2SFUzM1YyaUN2STdVc0NnTGtaTzZFOUY6VHl4ZXhsUl9EUk53MEV4LWd2ZmZZcldaUmhZc3U0amM1LU9MbU5PS2pkQXVRMlY2YW95WFEyVXAybVA3aUFhbg==';

    // Numérico → DB 5372 | Alfanumérico → DB 5352
    const isNumeric = /^\d+$/.test(ticket_id.trim());
    const dbId      = isNumeric ? '5372' : '5352';
    const dbUrl     = 'https://api.jelou.ai/v2/databases/' + dbId + '/rows';

    console.log('\n[consulta_ticket] Consultando ticket: ' + ticket_id);
    console.log('[consulta_ticket] Tipo: ' + (isNumeric ? 'numérico → DB 5372' : 'alfanumérico → DB 5352'));
    console.log('[consulta_ticket] URL: ' + dbUrl + '?search=' + ticket_id + '&searchBy=Ticket');

    const response = await axios.get(dbUrl, {
      timeout: 15000,
      httpsAgent,
      params: { page: 1, search: ticket_id, searchBy: 'Ticket' },
      headers: {
        Authorization: 'Basic ' + token,
        'Content-Type': 'application/json',
      },
    });

    console.log('[consulta_ticket] HTTP ' + response.status + ' - Respuesta completa:');
    console.log(JSON.stringify(response.data, null, 2));

    const results = response.data?.results || [];

    if (!results.length) {
      console.log('[consulta_ticket] Sin resultados para ticket "' + ticket_id + '"');
      return {
        data: null,
        summary: 'No se encontró ningún ticket con el ID "' + ticket_id + '" en el sistema Jelou.',
      };
    }

    const t = results[0];
    console.log('[consulta_ticket] Resultado encontrado:');
    console.log(JSON.stringify(t, null, 2));

    const parts = [
      'Ticket: ' + (t.Ticket || t.ticket_id || ticket_id),
      'Estado: ' + (t.Estado || 'No disponible'),
      'Tech Support: ' + (t.Tech_Support || 'No asignado'),
    ];

    if (t.Usuario)           parts.push('Usuario: ' + t.Usuario);
    if (t.Compania)          parts.push('Compania: ' + t.Compania);
    if (t.Tipo_de_gestion)   parts.push('Tipo: ' + t.Tipo_de_gestion);
    if (t.Criticidad)        parts.push('Criticidad: ' + t.Criticidad);
    if (t.Canal)             parts.push('Canal: ' + t.Canal);
    if (t.Resuelto_por)      parts.push('Resuelto por: ' + t.Resuelto_por);
    if (t.Resumen_de_Caso)   parts.push('Resumen: ' + t.Resumen_de_Caso);
    if (t.Resolucion)        parts.push('Resolución: ' + t.Resolucion);
    if (t.Fecha_creacion)    parts.push('Creado: ' + t.Fecha_creacion);
    if (t.Fecha_actualizacion) parts.push('Actualizado: ' + t.Fecha_actualizacion);

    console.log('[consulta_ticket] Estado: ' + t.Estado + ' | Tech_Support: ' + t.Tech_Support + '\n');

    return {
      data: t,
      summary: parts.join(' | '),
    };
  },
};
