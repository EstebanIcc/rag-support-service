import axios from "axios";
import https from "https";

// Sin keep-alive para evitar "Failure when receiving data from peer"
const httpsAgent = new https.Agent({ keepAlive: false });

/**
 * Gestión de contexto de conversación en Jelou Database 9929.
 *
 * Cada sesión se identifica por un referenceId (ej: número de teléfono, ID de usuario).
 * El campo "context" almacena el historial como JSON.stringify de un array de turns:
 *   [{ question, answer, timestamp }, ...]
 *
 * Flujo:
 *   1. getOrCreateContext(referenceId) → carga o crea el registro, siempre devuelve rowId
 *   2. ... el agente responde ...
 *   3. appendAndSave(rowId, referenceId, turns, newTurn) → actualiza con el nuevo turn
 */

const DB_BASE_URL = "https://api.jelou.ai/v2/databases/9929/rows";

function getAuthHeader() {
  const token = process.env.JELOU_DB_TOKEN;
  if (!token) throw new Error("JELOU_DB_TOKEN no está configurado en .env");
  return { Authorization: "Basic " + token };
}

const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Accept-Language": "es",
  authority: "api.jelou.ai",
};

// ── Busca un registro existente por referenceId ────────────────────────────

async function findByReferenceId(referenceId) {
  console.log("[jelouContext] GET buscando referenceId:", referenceId);
  const response = await axios.get(DB_BASE_URL, {
    timeout: 15000,
    httpsAgent,
    params: {
      search: referenceId,
      searchBy: "ReferenceId",
      sortBy: "createdAt",
      sortByOrder: "asc",
    },
    headers: { ...getAuthHeader(), ...BASE_HEADERS },
  });

  console.log(
    "[jelouContext] GET HTTP",
    response.status,
    "- total:",
    response.data?.pagination?.total,
  );
  const results = response.data?.results || [];
  return results.length > 0 ? results[0] : null;
}

// ── GET o CREATE: siempre devuelve { rowId, turns, isNew } ────────────────

export async function getOrCreateContext(referenceId) {
  console.log(
    "\n[jelouContext] Iniciando contexto para referenceId:",
    referenceId,
  );

  // 1. Buscar registro existente
  const existing = await findByReferenceId(referenceId);

  if (existing) {
    const rowId = existing._id;
    let turns = [];

    try {
      if (
        existing.context &&
        existing.context !== "[]" &&
        existing.context !== "datos enviados"
      ) {
        const parsed = JSON.parse(existing.context);
        turns = Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      console.warn(
        '[jelouContext] El campo "context" no es JSON válido. Iniciando historial vacío.',
      );
    }

    console.log(
      "[jelouContext] ✓ Registro encontrado. rowId:",
      rowId,
      "| turns previos:",
      turns.length,
    );
    return { rowId, turns, isNew: false };
  }

  // 2. No existe → crear fila nueva
  console.log("[jelouContext] No existe. Creando registro nuevo...");

  const postBody = { ReferenceId: referenceId, context: "[]" };
  const authHeader = getAuthHeader().Authorization;

  console.log("\n[jelouContext] ══ CURL POST EQUIVALENTE ══");
  console.log(
    "curl --request POST \\\n" +
    "  --url '" + DB_BASE_URL + "' \\\n" +
    "  --header 'Authorization: " + authHeader + "' \\\n" +
    "  --header 'Content-Type: application/json' \\\n" +
    "  --header 'Accept-Language: es' \\\n" +
    "  --data-raw '" + JSON.stringify(postBody).replace(/'/g, "\\'") + "'"
  );
  console.log("[jelouContext] ════════════════════════\n");

  const postResponse = await axios.post(
    DB_BASE_URL,
    postBody,
    {
      timeout: 15000,
      httpsAgent,
      headers: { ...getAuthHeader(), ...BASE_HEADERS },
    },
  );

  console.log("[jelouContext] POST HTTP", postResponse.status);
  console.log("[jelouContext] POST respuesta completa:", JSON.stringify(postResponse.data));

  // 3. Releer para obtener _id de forma confiable.
  //    Jelou DB puede tardar hasta ~1s en indexar el registro recién creado,
  //    por eso reintentamos hasta 3 veces con pausa creciente.
  let created = null;
  const delays = [600, 1200, 2000];

  for (let i = 0; i < delays.length; i++) {
    console.log(
      "[jelouContext] Esperando " +
        delays[i] +
        " ms para releer (intento " +
        (i + 1) +
        ")...",
    );
    await new Promise((r) => setTimeout(r, delays[i]));
    created = await findByReferenceId(referenceId);
    if (created) break;
  }

  if (!created) {
    throw new Error(
      "[jelouContext] Registro creado pero no se pudo releer tras 3 intentos. Verifica permisos en Jelou DB 9929.",
    );
  }

  console.log("[jelouContext] ✓ Registro creado. rowId:", created._id);
  return { rowId: created._id, turns: [], isNew: true };
}

// ── PUT: agrega un turn y guarda ──────────────────────────────────────────

export async function appendAndSave(
  rowId,
  referenceId,
  previousTurns,
  newTurn,
) {
  const updatedTurns = [
    ...previousTurns,
    {
      question: newTurn.question,
      answer: newTurn.answer,
    },
  ];

  const contextString = JSON.stringify(updatedTurns);

  // ── Log detallado de lo que se va a guardar ──
  console.log("\n[jelouContext] ══ appendAndSave ══");
  console.log("[jelouContext] rowId:", rowId);
  console.log("[jelouContext] referenceId:", referenceId);
  console.log("[jelouContext] previousTurns.length:", previousTurns.length);
  console.log("[jelouContext] newTurn.question:", newTurn.question);
  console.log("[jelouContext] newTurn.answer (100 chars):", String(newTurn.answer || "").slice(0, 100));
  console.log("[jelouContext] updatedTurns.length:", updatedTurns.length);
  console.log("[jelouContext] context a guardar:", contextString);

  const putBody = { context: contextString };
  const putUrl  = DB_BASE_URL + "/" + rowId;

  // ── Curl equivalente (para comparar con el curl manual) ──
  const authHeader = getAuthHeader().Authorization;
  console.log("\n[jelouContext] ══ CURL EQUIVALENTE ══");
  console.log(
    "curl --request PUT \\\n" +
    "  --url '" + putUrl + "' \\\n" +
    "  --header 'Authorization: " + authHeader + "' \\\n" +
    "  --header 'Content-Type: application/json' \\\n" +
    "  --header 'Accept-Language: es' \\\n" +
    "  --header 'Origin: https://apps.jelou.ai' \\\n" +
    "  --data-raw '" + JSON.stringify(putBody).replace(/'/g, "\\'") + "'"
  );
  console.log("[jelouContext] ════════════════════════\n");

  let response;
  try {
    response = await axios.put(
      DB_BASE_URL + "/" + rowId,
      putBody,
      {
        timeout: 15000,
        httpsAgent,
        headers: {
          ...getAuthHeader(),
          ...BASE_HEADERS,
          Origin: "https://apps.jelou.ai",
          Referer: "https://apps.jelou.ai/",
        },
      },
    );
  } catch (axiosErr) {
    // Mostrar el body de la respuesta de error para diagnosticar
    const errStatus  = axiosErr.response?.status;
    const errBody    = axiosErr.response?.data;
    const errMessage = axiosErr.message;
    console.error("[jelouContext] ✗ PUT falló. HTTP", errStatus);
    console.error("[jelouContext]   Error message:", errMessage);
    console.error("[jelouContext]   Respuesta Jelou:", JSON.stringify(errBody));
    throw axiosErr;
  }

  console.log("[jelouContext] PUT HTTP", response.status);
  console.log("[jelouContext] PUT respuesta completa:", JSON.stringify(response.data));

  // ── Verificar que Jelou guardó el contexto correctamente ──
  await new Promise((r) => setTimeout(r, 300));
  const saved = await findByReferenceId(referenceId);
  if (saved) {
    const match = saved.context === contextString;
    console.log("[jelouContext] Verificación GET tras PUT:");
    console.log("  context en DB:", String(saved.context).slice(0, 120));
    console.log("  ¿guardado OK?", match ? "✓ SÍ" : "✗ NO — Jelou guardó algo distinto o vacío");
    if (!match) {
      console.warn("[jelouContext]   Esperado:", contextString.slice(0, 120));
      console.warn("[jelouContext]   Recibido:", String(saved.context).slice(0, 120));
    }
  } else {
    console.warn("[jelouContext] Verificación: no se encontró el registro tras el PUT");
  }

  return updatedTurns;
}
