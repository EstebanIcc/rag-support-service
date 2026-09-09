import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: false });

const DB_URL = 'https://api.jelou.ai/v2/databases/6500/rows';
const ASSIGN_URL = 'https://api.jelou.ai/v1/support-tickets/assign';

function getAuthHeader() {
  const token = process.env.JELOU_API_TOKEN;
  if (!token) {
    throw new Error('JELOU_API_TOKEN no está configurado en .env');
  }
  return { Authorization: 'Basic ' + token };
}

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Accept-Language': 'es',
  authority: 'api.jelou.ai',
};

function pickSupportTicketId(row) {
  // DB 6500: supportTicketId es el ID de plataforma (ej: 6a4fb49c...).
  // _id es el UUID del registro en Datum — NO usar para /support-tickets/assign.
  const id = row?.supportTicketId;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    return String(id).trim();
  }
  return null;
}

function buildTransferSummary({ ticketId, supportTicketId, operatorId, assignResponse }) {
  return [
    '=== RESULTADO TRANSFERENCIA A PLATAFORMA ===',
    '',
    '🎫 Ticket: ' + ticketId,
    '🔗 Support Ticket ID: ' + supportTicketId,
    '👤 Operador destino (operatorId): ' + operatorId,
    '✅ Estado: Transferido correctamente',
    '',
    '=== RESPUESTA AL USUARIO ===',
    'Confirma al usuario que el ticket ' + ticketId + ' fue transferido a la plataforma de soporte.',
    'Tono claro y breve. Puedes usar emoticonos (✅ 🎫).',
    '',
    'Ejemplo:',
    '✅ El ticket ' + ticketId + ' fue transferido exitosamente a la plataforma de soporte.',
    '',
    'Detalle técnico (solo si el usuario lo pide): supportTicketId=' + supportTicketId,
    assignResponse ? 'Respuesta API: ' + JSON.stringify(assignResponse) : '',
  ].filter(Boolean).join('\n');
}

/**
 * Módulo: transferir_ticket_plataforma
 *
 * Flujo:
 *   1. Busca el ticket en Jelou DB 6500 por Ticket
 *   2. Obtiene supportTicketId del registro (campo supportTicketId, NO _id)
 *   3. POST /v1/support-tickets/assign con origin=transfer
 */
export const jelouTransferTicketModule = {
  name: 'transferir_ticket_plataforma',

  description:
    'Transfiere un ticket de soporte a la plataforma Jelou. ' +
    'Usalo SOLO cuando el usuario quiera transferir, escalar o enviar un ticket a la plataforma, ' +
    'al operador de soporte o al equipo de plataforma. ' +
    'NO usar para consultar estado del ticket (usa consulta_ticket para eso). ' +
    'Requiere ticket_id (ej: "20077", "TSWA2321").',

  parameters: {
    type: 'object',
    properties: {
      ticket_id: {
        type: 'string',
        description: 'ID o número del ticket a transferir (ej: "20077", "TSWA2321")',
      },
    },
    required: ['ticket_id'],
  },

  async execute({ ticket_id }) {
    const ticketId = String(ticket_id).trim();
    const operatorId = parseInt(process.env.JELOU_TRANSFER_OPERATOR_ID || '10360', 10);

    if (!ticketId) {
      throw new Error('ticket_id es requerido');
    }

    console.log('\n[transferir_ticket_plataforma] Iniciando transferencia');
    console.log('[transferir_ticket_plataforma] Ticket:', ticketId);
    console.log('[transferir_ticket_plataforma] operatorId:', operatorId);

    // 1. Buscar ticket en DB 6500
    const searchResponse = await axios.get(DB_URL, {
      timeout: 15000,
      httpsAgent,
      params: { search: ticketId, searchBy: 'Ticket' },
      headers: { ...getAuthHeader(), ...BASE_HEADERS },
    });

    console.log('[transferir_ticket_plataforma] GET DB 6500 HTTP', searchResponse.status);
    console.log('[transferir_ticket_plataforma] Resultados:', searchResponse.data?.pagination?.total ?? 0);

    const results = searchResponse.data?.results || [];

    if (!results.length) {
      return {
        data: null,
        summary: [
          '=== RESULTADO TRANSFERENCIA A PLATAFORMA ===',
          '',
          '❌ Estado: No se pudo transferir',
          '🎫 Ticket buscado: ' + ticketId,
          '',
          'No se encontró el ticket en la base de datos de plataforma (DB 6500).',
          'Informa al usuario que el ticket no existe o no está disponible para transferencia.',
        ].join('\n'),
      };
    }

    const row = results[0];
    console.log('[transferir_ticket_plataforma] Registro DB 6500 — Ticket:', row.Ticket, '| supportTicketId:', row.supportTicketId, '| _id (datum):', row._id);

    const supportTicketId = pickSupportTicketId(row);

    if (!supportTicketId) {
      throw new Error(
        'El ticket fue encontrado pero no tiene el campo supportTicketId. Registro: ' +
          JSON.stringify(row),
      );
    }

    console.log('[transferir_ticket_plataforma] supportTicketId:', supportTicketId);

    // 2. Asignar / transferir en plataforma
    const assignBody = {
      origin: 'transfer',
      operatorId,
      supportTicketId: String(supportTicketId),
    };

    console.log('[transferir_ticket_plataforma] POST assign body:', assignBody);

    const assignResponse = await axios.post(ASSIGN_URL, assignBody, {
      timeout: 15000,
      httpsAgent,
      headers: {
        ...getAuthHeader(),
        ...BASE_HEADERS,
        Accept: 'application/json',
      },
    });

    console.log('[transferir_ticket_plataforma] POST assign HTTP', assignResponse.status);
    console.log('[transferir_ticket_plataforma] Respuesta:', JSON.stringify(assignResponse.data, null, 2));

    const summary = buildTransferSummary({
      ticketId,
      supportTicketId,
      operatorId,
      assignResponse: assignResponse.data,
    });

    return {
      data: {
        ticketId,
        supportTicketId,
        operatorId,
        assignResult: assignResponse.data,
        ticketRow: row,
      },
      summary,
    };
  },
};
