import { Router } from 'express';
import { askAgent } from '../agent/ragAgent.js';
import { getOrCreateContext, appendAndSave } from '../context/jelouContext.js';

const router = Router();

/**
 * POST /ask
 *
 * Body:
 *   question     (string, requerido)  — pregunta del usuario
 *   referenceId  (string, opcional)   — ID de sesión; activa contexto persistente en Jelou DB
 *   topK         (number, opcional)   — cuántos chunks RAG recuperar (default: 5)
 *   history      (array,  opcional)   — historial manual si no se usa referenceId
 *
 * Si se envía referenceId:
 *   - Se carga el historial previo desde Jelou DB 9929
 *   - Tras responder, se actualiza el registro con el nuevo turn
 *
 * Ejemplo sin contexto persistente:
 *   { "question": "¿Qué es el servicio RAG?" }
 *
 * Ejemplo con contexto persistente:
 *   { "question": "¿Cuál es el estado del ticket TSWA2321?", "referenceId": "593984703346" }
 */
router.post('/', async (req, res) => {
  const { question, topK, history, referenceId } = req.body;

  if (!question || typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: 'El campo "question" es requerido y debe ser un string.' });
  }

  const q = question.trim();

  // ── Ruta con contexto persistente (referenceId) ────────────────────────
  if (referenceId) {
    let rowId     = null;
    let turns     = [];
    let ctxError  = null;
    let saveError = null;

    // 1. Cargar o crear el contexto en Jelou DB
    try {
      const ctx = await getOrCreateContext(String(referenceId));
      rowId = ctx.rowId;
      turns = ctx.turns;
    } catch (err) {
      ctxError = err.message;
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        ctxError = 'JELOU_DB_TOKEN inválido o expirado (HTTP ' + status + '). Renueva el token en .env';
      }
      console.error('[/ask] ⚠ Error cargando contexto Jelou:', ctxError);
      // No bloqueamos el flujo: el agente responde sin historial
    }

    // 2. Llamar al agente con el historial previo como conversationHistory
    let result;
    try {
      result = await askAgent(q, {
        topK: topK || undefined,
        conversationHistory: turns,
      });
    } catch (err) {
      console.error('[/ask]', err.message);
      return res.status(500).json({ error: 'Error procesando la pregunta.', detail: err.message });
    }

    // 3. Guardar el nuevo turn en Jelou DB (esperamos para detectar errores)
    if (rowId) {
      try {
        await appendAndSave(rowId, String(referenceId), turns, {
          question: q,
          answer: result.answer,
        });
      } catch (err) {
        saveError = err.message;
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          saveError = 'JELOU_DB_TOKEN inválido o expirado (HTTP ' + status + '). Contexto no guardado.';
        }
        console.error('[/ask] ⚠ Error guardando contexto Jelou:', saveError);
      }
    }

    return res.json({
      question: q,
      answer: result.answer,
      sources: result.sources,
      modulesUsed: result.modulesUsed,
      usage: result.usage,
      context: {
        referenceId: String(referenceId),
        rowId,
        totalTurns: rowId ? turns.length + 1 : null,
        saved: !saveError && !!rowId,
        ...(ctxError  && { ctxError }),
        ...(saveError && { saveError }),
      },
    });
  }

  // ── Ruta sin contexto persistente (historial manual o sin historial) ────
  try {
    const result = await askAgent(q, {
      topK: topK || undefined,
      conversationHistory: Array.isArray(history) ? history : [],
    });

    return res.json({
      question: q,
      answer: result.answer,
      sources: result.sources,
      modulesUsed: result.modulesUsed,
      usage: result.usage,
    });
  } catch (err) {
    console.error('[/ask]', err.message);
    return res.status(500).json({ error: 'Error procesando la pregunta.', detail: err.message });
  }
});

export default router;
