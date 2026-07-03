import axios from "axios";
import https from "https";
import { v4 as uuidv4 } from "uuid";

/**
 * Provider: Jelou Tools LLM
 *
 * Configura en .env:
 *   JELOU_TOOLS_URL     = https://gateway.jelou.ai/workflows/v2/tools/7834/execute
 *   JELOU_TOOLS_API_KEY = 3881|...
 *   JELOU_TOOLS_VERSION = 1
 *
 * Respuesta real de Jelou Tools:
 * {
 *   "status": "success",
 *   "data": {
 *     "output": {
 *       "value": { use_tool, tool, args }  ← lo que nos importa
 *     }
 *   }
 * }
 */

const JELOU_TOOLS_URL =
  process.env.JELOU_TOOLS_URL ||
  "https://gateway.jelou.ai/workflows/v2/tools/7834/execute";
const JELOU_TOOLS_API_KEY =
  process.env.JELOU_TOOLS_API_KEY ||
  "3881|Ia1EpRK1uhFo3kaQAsCeQm7Ybnv1DJaE48yoXWqI";
const JELOU_TOOLS_VERSION = process.env.JELOU_TOOLS_VERSION || "1";

// Desactiva keep-alive para evitar "Failure when receiving data from peer"
// en la primera conexión al API de Jelou
const httpsAgent = new https.Agent({ keepAlive: false });

// ── Llamada principal ──────────────────────────────────────────────────────

async function callJelouTools(prompt, userId, attempt = 1) {
  const id = userId || uuidv4();
  const MAX_ATTEMPTS = 3;

  const payload = {
    input: { prompt: prompt }, // ← campo correcto según el curl de Jelou
    user: { id, socketId: id, referenceId: id },
  };

  console.log(
    "\n[jelouLLM] Intento " + attempt + "/" + MAX_ATTEMPTS + " → Jelou Tools",
  );
  console.log(
    "[jelouLLM] Prompt (primeros 300 chars):",
    prompt.slice(0, 300) + (prompt.length > 300 ? "..." : ""),
  );

  let response;
  try {
    response = await axios.post(
      JELOU_TOOLS_URL + "?version=" + JELOU_TOOLS_VERSION,
      payload,
      {
        timeout: 60000, // 60 s — workflows pueden tardar en cold start
        httpsAgent, // sin keep-alive
        headers: {
          "Content-Type": "application/json",
          "x-api-key": JELOU_TOOLS_API_KEY,
        },
      },
    );
  } catch (err) {
    const code = err.code || err.response?.status || "UNKNOWN";
    console.error(
      "[jelouLLM] Error en llamada HTTP. Código:",
      code,
      "| Mensaje:",
      err.message,
    );

    // Reintento en errores de red transitorios (no en 4xx/5xx de la API)
    const isNetworkError = !err.response;
    const isServerError = err.response?.status >= 500;
    const retryDelay = attempt === 1 ? 2000 : 4000;

    if (attempt < MAX_ATTEMPTS && (isNetworkError || isServerError)) {
      console.log(
        "[jelouLLM] Reintentando en " +
          retryDelay / 1000 +
          "s (cold start o error transitorio)...",
      );
      await new Promise((r) => setTimeout(r, retryDelay));
      return callJelouTools(prompt, userId, attempt + 1);
    }

    // Re-lanzar con mensaje descriptivo
    throw new Error(
      "[jelouLLM] Fallo al llamar a Jelou Tools (intento " +
        attempt +
        "/" +
        MAX_ATTEMPTS +
        "): " +
        err.message +
        (err.code ? " [" + err.code + "]" : ""),
    );
  }

  console.log("[jelouLLM] HTTP", response.status, "- Respuesta:");
  console.log(JSON.stringify(response.data, null, 2));

  if (response.data?.status !== "success") {
    throw new Error(
      "[jelouLLM] Jelou Tools respondió con status: " +
        (response.data?.status || "desconocido") +
        " | mensaje: " +
        (response.data?.message || "-"),
    );
  }

  const value = response.data?.data?.output?.value;

  if (value === undefined || value === null) {
    // Si el workflow está arrancando puede devolver una estructura vacía.
    // Reintentamos para darle tiempo de calentarse.
    if (attempt < MAX_ATTEMPTS) {
      const retryDelay = attempt === 1 ? 3000 : 5000;
      console.warn(
        "[jelouLLM] data.output.value vacío (posible cold start). Reintentando en " +
          retryDelay / 1000 +
          "s...",
      );
      await new Promise((r) => setTimeout(r, retryDelay));
      return callJelouTools(prompt, userId, attempt + 1);
    }
    throw new Error(
      "[jelouLLM] No se encontró data.output.value tras " +
        attempt +
        " intentos",
    );
  }

  console.log("[jelouLLM] value extraído:", JSON.stringify(value), "\n");
  return value;
}

// ── Función exportada: detecta intención o genera respuesta ───────────────

export async function jelouDetectIntent(prompt, { userId } = {}) {
  const value = await callJelouTools(prompt, userId);

  // Caso A: value tiene use_tool directamente (el tool devuelve el JSON completo)
  if (value && typeof value === "object" && "use_tool" in value) {
    return value;
  }

  // Caso B: value tiene un campo "mensaje" con el JSON
  const raw = value?.mensaje;

  if (raw && typeof raw === "object" && "use_tool" in raw) {
    return raw;
  }

  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        console.warn(
          "[jelouLLM] El campo mensaje contiene JSON inválido:",
          raw,
        );
      }
    }
  }

  // Caso C: no se pudo parsear — asumir que no necesita herramienta
  // y devolver el texto como respuesta directa si lo hay
  const textAnswer = raw || (typeof value === "string" ? value : null);
  if (textAnswer) {
    return { use_tool: false, answer: String(textAnswer) };
  }

  console.warn(
    "[jelouLLM] No se pudo extraer respuesta. value recibido:",
    value,
  );
  return {
    use_tool: false,
    answer: "No se pudo procesar la respuesta del servicio.",
  };
}
