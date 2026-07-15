import axios from "axios";
import https from "https";

const httpsAgent = new https.Agent({ keepAlive: false });

/**
 * Guía de campos para que el agente sepa qué dato usar según la intención del usuario.
 * Se incluye en cada respuesta de consulta_ticket.
 */
const TICKET_FIELD_GUIDE = [
  'Tech_Support → Técnico asignado que revisa/maneja el ticket. Responde preguntas como: "¿quién lo revisa?", "¿quién lo maneja?", "¿a quién está asignado?", "¿quién lo tiene?"',
  "Revisado_por → Persona que revisó el ticket (distinto del técnico asignado si el campo está vacío)",
  "Resuelto_por → Quién cerró o resolvió el ticket",
  "Estado → Estado actual del ticket (abierto, cerrado, en progreso, etc.)",
  "Resumen_de_Caso → Descripción del problema reportado por el usuario",
  "Resolucion → Explicación de cómo se resolvió el caso",
  "Usuario → Usuario/cliente que reportó el ticket",
  "Compañia → Empresa del cliente",
  "Criticidad → Nivel de prioridad (Alta, Media, Baja)",
  "Tipo_de_gestion → Tipo de ticket (Incidente, Requerimiento, etc.)",
  "Fecha_creacion / Fecha_cerrado → Fechas de apertura y cierre",
  "Escalado/Task → Enlace al hilo de Slack o tarea relacionada. SIEMPRE incluir al final de la respuesta; si está vacío, indicar que no hay escalamiento registrado",
].join("\n");

/**
 * Plantilla formal con secciones delimitadas y saltos de línea.
 */
const TICKET_RESPONSE_STRUCTURE = [
  "=== ESTRUCTURA OBLIGATORIA DE LA RESPUESTA ===",
  "Redacta la respuesta en bloques separados (NO en un solo párrafo continuo).",
  "Usa delimitadores, títulos de sección y una línea en blanco entre cada bloque.",
  "",
  "FORMATO DE CADA SECCIÓN:",
  "▸ 🎯 TÍTULO DE SECCIÓN",
  "──────────────────────",
  "Contenido de la sección",
  "",
  "EMOTICONOS (usar cuando aplique, sin exagerar):",
  "🎫 encabezado del ticket | 📋 información general | 📝 resumen | ✅ resolución | 🔗 escalamiento",
  "👤 reportado por | 🏢 empresa | 🛠️ técnico asignado | 📊 estado | 🏷️ tipo | ⚠️ criticidad | 📅 fechas",
  "",
  "SECCIONES EN ESTE ORDEN:",
  "",
  "1) Encabezado",
  "   ══════════════════════",
  "   🎫 TICKET #{Ticket}",
  "   ══════════════════════",
  "",
  "2) 📋 INFORMACIÓN GENERAL",
  "   Campos en líneas separadas con emoticono al inicio (👤 🏢 🛠️ 📊 etc.)",
  "",
  "3) 📝 RESUMEN DEL CASO",
  "   Campo: Resumen_de_Caso (puedes condensar si es muy largo)",
  "",
  "4) ✅ RESOLUCIÓN",
  "   Campo: Resolucion (puedes condensar si es muy largo)",
  "",
  "5) 🔗 ESCALAMIENTO (obligatorio, siempre al final)",
  "   Con enlace: \"📤 Comparto el escalamiento del caso:\" + URL en la siguiente línea",
  "   Sin enlace: \"ℹ️ No hay escalamiento registrado para este caso.\"",
  "",
  "REGLAS:",
  "- Mantén SIEMPRE los delimitadores y saltos de línea entre secciones.",
  '- Pregunta puntual (ej. "¿quién lo maneja?"): responde solo INFORMACIÓN GENERAL + ESCALAMIENTO.',
  '- Pregunta general: incluye todas las secciones.',
  "- Tono formal y claro. Incluye emoticonos en títulos y etiquetas cuando sea posible.",
  "- No inventes datos que no estén en el ticket.",
  "",
  "Usa la PLANTILLA DE RESPUESTA de abajo como base: conserva el formato, emoticonos y delimitadores.",
].join("\n");

function criticidadEmoji(criticidad) {
  if (!criticidad) return "⚠️";
  const c = criticidad.toLowerCase();
  if (c.includes("alta")) return "🔴";
  if (c.includes("media")) return "🟡";
  if (c.includes("baja")) return "🟢";
  return "⚠️";
}

function buildStructuredResponseExample(ticket, ticketId) {
  const ticketNum = pickField(ticket, "Ticket", "ticket_id") || ticketId;
  const escaladoTask = pickField(ticket, "Escalado/Task", "Escalado_Task");
  const criticidad = pickField(ticket, "Criticidad");

  const lines = [
    "══════════════════════",
    "🎫 TICKET #" + ticketNum,
    "══════════════════════",
    "",
    "▸ 📋 INFORMACIÓN GENERAL",
    "──────────────────────",
    "👤 Reportado por: " + (pickField(ticket, "Usuario") || "No registrado"),
    "🏢 Empresa: " +
      (pickField(ticket, "Compañia", "Compania") || "No registrada"),
    "🛠️ Técnico asignado: " + (pickField(ticket, "Tech_Support") || "No asignado"),
    "📊 Estado: " + (pickField(ticket, "Estado") || "Sin estado registrado"),
  ];

  const infoExtras = [
    ["🏷️ Tipo de gestión", pickField(ticket, "Tipo_de_gestion")],
    [criticidadEmoji(criticidad) + " Criticidad", criticidad],
    ["✅ Resuelto por", pickField(ticket, "Resuelto_por")],
    [
      "📅 Fecha de cierre",
      formatDate(pickField(ticket, "Fecha_cerrado")),
    ],
  ];
  infoExtras.forEach(([label, value]) => {
    if (value) lines.push(label + ": " + value);
  });

  lines.push(
    "",
    "▸ 📝 RESUMEN DEL CASO",
    "──────────────────────",
    pickField(ticket, "Resumen_de_Caso") || "No disponible",
    "",
    "▸ ✅ RESOLUCIÓN",
    "──────────────────────",
    pickField(ticket, "Resolucion") || "No disponible",
    "",
    "▸ 🔗 ESCALAMIENTO",
    "──────────────────────",
  );

  if (escaladoTask) {
    lines.push("📤 Comparto el escalamiento del caso:");
    lines.push(escaladoTask);
  } else {
    lines.push("ℹ️ No hay escalamiento registrado para este caso.");
  }

  return lines.join("\n");
}

function pickField(ticket, ...keys) {
  for (const key of keys) {
    const value = ticket[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("es-EC", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * Formatea el ticket para el agente: guía semántica + datos estructurados.
 * El LLM solo recibe `summary` en el prompt, por eso va todo aquí.
 */
function formatTicketForAgent(ticket, ticketId) {
  const lines = [
    "=== GUÍA: QUÉ CAMPO USAR SEGÚN LA PREGUNTA ===",
    TICKET_FIELD_GUIDE,
    "",
    "=== DATOS DEL TICKET ===",
    "Ticket: " + (pickField(ticket, "Ticket", "ticket_id") || ticketId),
    "Tech_Support (técnico asignado / quien maneja o revisa): " +
      (pickField(ticket, "Tech_Support") || "No asignado"),
    "Estado: " + (pickField(ticket, "Estado") || "Sin estado registrado"),
    "Revisado_por: " + (pickField(ticket, "Revisado_por") || "No registrado"),
    "Resuelto_por: " + (pickField(ticket, "Resuelto_por") || "No registrado"),
  ];

  const optionalFields = [
    ["Usuario (quien reportó)", pickField(ticket, "Usuario")],
    ["Compañía", pickField(ticket, "Compañia", "Compania")],
    ["Correo", pickField(ticket, "Correo")],
    ["Cliente", pickField(ticket, "Cliente")],
    ["Tipo de gestión", pickField(ticket, "Tipo_de_gestion")],
    ["Criticidad", pickField(ticket, "Criticidad")],
    ["Dificultad", pickField(ticket, "Dificultad")],
    ["Proveedor", pickField(ticket, "Proveedor")],
    ["Producto", pickField(ticket, "Producto")],
    ["Ecosistema", pickField(ticket, "Ecosistema")],
    ["Canal", pickField(ticket, "Canal")],
    ["SGSI", pickField(ticket, "SGSI")],
    ["Reporte", pickField(ticket, "Reporte_1")],
    [
      "Fecha creación",
      formatDate(pickField(ticket, "Fecha_creacion", "createdAt")),
    ],
    ["Fecha cierre", formatDate(pickField(ticket, "Fecha_cerrado"))],
    ["Resumen del caso", pickField(ticket, "Resumen_de_Caso")],
    ["Resolución", pickField(ticket, "Resolucion")],
  ];

  optionalFields.forEach(([label, value]) => {
    if (value) lines.push(label + ": " + value);
  });

  lines.push("");
  lines.push(TICKET_RESPONSE_STRUCTURE);
  lines.push("");
  lines.push("=== PLANTILLA DE RESPUESTA (conservar formato y delimitadores) ===");
  lines.push(buildStructuredResponseExample(ticket, ticketId));

  return lines.join("\n");
}

/**
 * Módulo: jelou_ticket
 * Consulta el estado y asignación de un ticket en la base de datos Jelou.
 */
export const jelouTicketModule = {
  name: "consulta_ticket",

  description:
    "Consulta información de un ticket de soporte en Jelou (estado, asignación, resolución, etc.). " +
    "Usalo cuando pregunten por un ticket concreto. " +
    'IMPORTANTE: para "¿quién lo revisa/maneja/asignado?" usa el campo Tech_Support. ' +
    "Al responder, usa formato formal por secciones con delimitadores, saltos de línea y emoticonos (ver PLANTILLA DE RESPUESTA). " +
    'Requiere ticket_id (ej: "TSWA2321", "20077").',

  parameters: {
    type: "object",
    properties: {
      ticket_id: {
        type: "string",
        description:
          'ID o número del ticket a consultar (ej: "TSWA2321", "19652")',
      },
    },
    required: ["ticket_id"],
  },

  async execute({ ticket_id }) {
    const token =
      process.env.JELOU_API_TOKEN ||
      "cFM1T2lrUUt2SFUzM1YyaUN2STdVc0NnTGtaTzZFOUY6VHl4ZXhsUl9EUk53MEV4LWd2ZmZZcldaUmhZc3U0amM1LU9MbU5PS2pkQXVRMlY2YW95WFEyVXAybVA3aUFhbg==";

    // Numérico → DB 5372 | Alfanumérico → DB 5352
    const isNumeric = /^\d+$/.test(ticket_id.trim());
    const dbId = isNumeric ? "5372" : "5352";
    const dbUrl = "https://api.jelou.ai/v2/databases/" + dbId + "/rows";

    console.log("\n[consulta_ticket] Consultando ticket: " + ticket_id);
    console.log(
      "[consulta_ticket] Tipo: " +
        (isNumeric ? "numérico → DB 5372" : "alfanumérico → DB 5352"),
    );
    console.log(
      "[consulta_ticket] URL: " +
        dbUrl +
        "?search=" +
        ticket_id +
        "&searchBy=Ticket",
    );

    const response = await axios.get(dbUrl, {
      timeout: 15000,
      httpsAgent,
      params: { page: 1, search: ticket_id, searchBy: "Ticket" },
      headers: {
        Authorization: "Basic " + token,
        "Content-Type": "application/json",
      },
    });

    console.log(
      "[consulta_ticket] HTTP " + response.status + " - Respuesta completa:",
    );
    console.log(JSON.stringify(response.data, null, 2));

    const results = response.data?.results || [];

    if (!results.length) {
      console.log(
        '[consulta_ticket] Sin resultados para ticket "' + ticket_id + '"',
      );
      return {
        data: null,
        summary:
          'No se encontró ningún ticket con el ID "' +
          ticket_id +
          '" en el sistema Jelou.',
      };
    }

    const t = results[0];
    console.log("[consulta_ticket] Resultado encontrado:");
    console.log(JSON.stringify(t, null, 2));

    const summary = formatTicketForAgent(t, ticket_id);

    console.log(
      "[consulta_ticket] Estado: " +
        (t.Estado || "(vacío)") +
        " | Tech_Support: " +
        (t.Tech_Support || "No asignado") +
        "\n",
    );

    return {
      data: t,
      summary,
    };
  },
};
