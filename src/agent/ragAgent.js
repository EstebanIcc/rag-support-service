import OpenAI from 'openai';
import { vectorStore }    from '../vectorStore/inMemoryStore.js';
import { moduleRegistry } from '../modules/index.js';
import { jelouDetectIntent } from '../llm/jelouLLM.js';

// OpenAI solo se usa para embeddings
let openaiClient;
function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const USE_JELOU_LLM = process.env.LLM_PROVIDER === 'jelou';

/** Regla global: no inventar info fuera de docs.jelou.ai / herramientas / RAG */
const DOCS_GROUNDING_RULES = [
  '=== REGLA DE CONOCIMIENTO (docs.jelou.ai) ===',
  'NO inventes información sobre Jelou, Brain, productos, procesos, configuraciones o procedimientos.',
  'Responde sobre documentación/plataforma SOLO con lo que aparezca en CONTEXTO DOCUMENTAL (docs.jelou.ai indexados) o en DATOS OBTENIDOS EN TIEMPO REAL (herramientas).',
  'Si no hay información suficiente en esas fuentes, dilo claramente. No completes con suposiciones ni conocimiento general.',
].join('\n');

// ── Construcción del prompt completo para Jelou ────────────────────────────

/**
 * Modo ACCIÓN (sin datos aún): decide qué herramienta usar o responde si no hace falta.
 * Modo RESPUESTA (ya hay datos): redacta la respuesta final usando los datos obtenidos.
 *
 * Separar los dos modos elimina la ambigüedad que hacía que Jelou
 * listara los datos en vez de responder la pregunta del usuario.
 */
function buildAgentPrompt({ question, ragContext, toolHistory, modules, conversationHistory }) {
  const hasData = toolHistory.length > 0;

  // ══════════════════════════════════════════════════════
  // MODO RESPUESTA — ya se ejecutaron herramientas
  // ══════════════════════════════════════════════════════
  if (hasData) {
    const parts = [];

    // Contexto previo de conversación
    if (conversationHistory && conversationHistory.length > 0) {
      parts.push('=== CONVERSACIÓN PREVIA ===');
      conversationHistory.forEach((turn) => {
        parts.push('Usuario: ' + turn.question);
        parts.push('Asistente: ' + turn.answer);
      });
      parts.push('');
    }

    // La pregunta que el usuario hizo y que hay que responder
    parts.push('=== PREGUNTA DEL USUARIO ===');
    parts.push(question);
    parts.push('');

    // Datos consultados en tiempo real (resultados de herramientas)
    parts.push('=== DATOS OBTENIDOS EN TIEMPO REAL ===');
    toolHistory.forEach((h) => {
      if (h.success) {
        parts.push(h.tool + ': ' + h.summary);
      } else {
        parts.push(h.tool + ' [error]: ' + h.error);
      }
    });
    parts.push('');

    // Documentos RAG si aplica
    if (ragContext) {
      parts.push('=== CONTEXTO DOCUMENTAL ===');
      parts.push(ragContext);
      parts.push('');
    }

    // Instrucción clara: responde la pregunta con los datos anteriores
    parts.push(DOCS_GROUNDING_RULES);
    parts.push('');
    parts.push('=== TAREA ===');
    parts.push('Usando los DATOS OBTENIDOS EN TIEMPO REAL de arriba, responde la PREGUNTA DEL USUARIO de forma clara y concisa.');
    const usedTicketTool = toolHistory.some((h) => h.success && h.tool === 'consulta_ticket');
    if (usedTicketTool) {
      parts.push('Para consulta_ticket: usa el formato formal por secciones con delimitadores, saltos de línea y emoticonos. Sigue la PLANTILLA DE RESPUESTA.');
    } else {
      parts.push('Si consulta_ticket incluye bloque de escalamiento, respétalo al cerrar tu respuesta.');
    }
    parts.push('No busques más herramientas. Solo redacta la respuesta final al usuario.');
    parts.push('');

    // Formato obligatorio: solo use_tool:false está permitido aquí
    parts.push('=== SALIDA ===');
    parts.push('mensaje = {"use_tool": false, "answer": "respuesta completa y clara al usuario"}');

    return parts.join('\n');
  }

  // ══════════════════════════════════════════════════════
  // MODO ACCIÓN — primera iteración, decidir qué hacer
  // ══════════════════════════════════════════════════════
  const parts = [];

  // Contexto previo de conversación
  if (conversationHistory && conversationHistory.length > 0) {
    parts.push('=== CONVERSACIÓN PREVIA ===');
    conversationHistory.forEach((turn) => {
      parts.push('Usuario: ' + turn.question);
      parts.push('Asistente: ' + turn.answer);
    });
    parts.push('');
  }

  // La pregunta del usuario
  parts.push('=== PREGUNTA DEL USUARIO ===');
  parts.push(question);
  parts.push('');

  // Herramientas disponibles para consultar
  if (modules.length > 0) {
    parts.push('=== HERRAMIENTAS DISPONIBLES ===');
    modules.forEach((m) => {
      const params = Object.entries(m.parameters?.properties || {})
        .map(([k, v]) => k + ' (' + v.type + '): ' + v.description)
        .join(' | ');
      parts.push('- ' + m.name + ': ' + m.description + (params ? ' | Parámetros: ' + params : ''));
    });
    parts.push('');
  }

  // Contexto documental disponible
  if (ragContext) {
    parts.push('=== CONTEXTO DOCUMENTAL ===');
    parts.push(ragContext);
    parts.push('');
  }

  // Instrucción clara: decide si necesitas una herramienta o puedes responder ya
  parts.push(DOCS_GROUNDING_RULES);
  parts.push('');
  parts.push('=== TAREA ===');
  parts.push('Analiza la PREGUNTA DEL USUARIO.');
  parts.push('- Si necesitas consultar una herramienta para responder con datos actualizados, úsala.');
  parts.push('- Si ya puedes responder con el CONTEXTO DOCUMENTAL (docs.jelou.ai), responde directamente.');
  parts.push('- Si no hay contexto documental ni herramienta aplicable, responde que no tienes esa información en docs.jelou.ai.');
  parts.push('');

  // Formato de salida con los dos casos
  parts.push('=== SALIDA ===');
  parts.push('Si necesitas herramienta: mensaje = {"use_tool": true, "tool": "nombre_herramienta", "args": {"parametro": "valor"}}');
  parts.push('Si puedes responder ya:   mensaje = {"use_tool": false, "answer": "respuesta completa al usuario"}');

  return parts.join('\n');
}

// ── Loop agéntico ──────────────────────────────────────────────────────────

/**
 * Ejecuta el loop agéntico con Jelou como "cerebro":
 *
 * 1. Construye prompt completo (rol + tools + RAG + historial + pregunta)
 * 2. Llama a Jelou → devuelve JSON:
 *    - { use_tool: true, tool, args } → ejecuta módulo, agrega al historial, vuelve al paso 1
 *    - { use_tool: false, answer }    → respuesta final
 * 3. Límite de iteraciones para evitar loops infinitos
 */
async function runJelouAgentLoop({ question, ragContext, modules, conversationHistory }) {
  const toolHistory = [];
  const MAX_ITERATIONS = 5;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const mode = toolHistory.length > 0 ? 'RESPUESTA' : 'ACCIÓN';
    console.log('\n[ragAgent] ── Iteración ' + (iteration + 1) + '/' + MAX_ITERATIONS + ' [Modo: ' + mode + '] ──');
    console.log('[ragAgent] Pregunta del usuario: "' + question + '"');
    if (toolHistory.length > 0) {
      console.log('[ragAgent] Datos ya obtenidos:', toolHistory.map((h) => h.tool + (h.success ? ' ✓' : ' ✗')).join(', '));
    }

    const prompt = buildAgentPrompt({ question, ragContext, toolHistory, modules, conversationHistory });

    // Llamada al tool de Jelou — espera JSON con use_tool
    const response = await jelouDetectIntent(prompt);

    console.log('[ragAgent] Respuesta Jelou:', JSON.stringify(response));

    // Jelou dice que ya puede responder
    if (!response?.use_tool) {
      const answer = response?.answer
        || response?.mensaje
        || response?.message
        || 'No se pudo generar una respuesta.';

      return { answer, toolHistory };
    }

    // Jelou solicita ejecutar una herramienta
    const toolName = response.tool;
    const toolArgs = response.args || {};

    if (!toolName) {
      console.warn('[ragAgent] use_tool=true pero sin nombre de herramienta. Deteniendo loop.');
      return { answer: 'El agente no pudo determinar qué herramienta usar.', toolHistory };
    }

    const mod = moduleRegistry.getByName(toolName);
    if (!mod) {
      console.warn('[ragAgent] Herramienta "' + toolName + '" no encontrada en el registro.');
      toolHistory.push({ tool: toolName, success: false, error: 'Herramienta no registrada' });
      continue;
    }

    // Evitar llamar la misma herramienta con los mismos args dos veces
    const alreadyExecuted = toolHistory.some(
      (h) => h.tool === toolName && JSON.stringify(h.args) === JSON.stringify(toolArgs)
    );
    if (alreadyExecuted) {
      console.warn('[ragAgent] Herramienta "' + toolName + '" ya ejecutada con estos args. Deteniendo loop.');
      break;
    }

    try {
      console.log('[ragAgent] Ejecutando herramienta: ' + toolName, toolArgs);
      const result = await moduleRegistry.execute(toolName, toolArgs);
      toolHistory.push({ tool: toolName, args: toolArgs, success: true, summary: result.summary, data: result.data });
    } catch (err) {
      console.error('[ragAgent] Error ejecutando "' + toolName + '":', err.message);
      toolHistory.push({ tool: toolName, args: toolArgs, success: false, error: err.message });
    }
  }

  // Se agotaron las iteraciones sin respuesta final
  console.warn('[ragAgent] Se alcanzó el límite de iteraciones sin respuesta final.');
  return {
    answer: toolHistory.length > 0
      ? 'Se consultaron las herramientas pero el agente no pudo formular una respuesta final.'
      : 'No se pudo procesar la pregunta.',
    toolHistory,
  };
}

// ── Agente principal ───────────────────────────────────────────────────────

export async function askAgent(question, { topK, conversationHistory = [] } = {}) {
  const k = topK || parseInt(process.env.TOP_K) || 5;

  // 1. RAG: recuperar chunks relevantes del vector store
  const ragResults = await vectorStore.search(question, k);
  const ragContext = ragResults.length > 0
    ? ragResults.map((r, i) => '[Doc ' + (i + 1) + '] ' + (r.metadata.title || r.metadata.source) + '\n' + r.text).join('\n\n---\n\n')
    : null;

  const modules = moduleRegistry.getAll();

  // ── Ruta JELOU: loop agéntico completo ────────────────────────────────
  if (USE_JELOU_LLM) {
    const { answer, toolHistory } = await runJelouAgentLoop({ question, ragContext, modules, conversationHistory });

    return buildResult({
      answer,
      ragResults,
      modulesUsed: toolHistory,
      usage: null,
    });
  }

  // ── Ruta OPENAI: function calling nativo ──────────────────────────────
  const openai = getOpenAI();
  const model  = process.env.CHAT_MODEL || 'gpt-4o-mini';
  const tools  = moduleRegistry.toOpenAITools();

  const SYSTEM_PROMPT = `Eres un asistente experto de soporte Jelou que responde preguntas combinando dos fuentes:
1. CONTEXTO DOCUMENTAL: fragmentos de docs.jelou.ai indexados (PDFs, URLs).
2. DATOS EN TIEMPO REAL: resultados de herramientas externas (tickets, transferencias, etc.)

Reglas:
- NO inventes información sobre Jelou, Brain, productos, procesos o procedimientos.
- Responde sobre documentación/plataforma SOLO con lo que esté en el CONTEXTO DOCUMENTAL o en datos de herramientas.
- Usa AMBAS fuentes cuando estén disponibles. Prioriza los datos en tiempo real para información dinámica.
- Si no tienes suficiente información en ninguna fuente, dilo claramente. No completes con suposiciones.
- Sé conciso y preciso.
- Responde en el mismo idioma en que se hace la pregunta.`;

  const userMessage = ragContext
    ? 'Contexto documental:\n' + ragContext + '\n\nPregunta: ' + question
    : 'Pregunta: ' + question;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.slice(-6),
    { role: 'user', content: userMessage },
  ];

  const modulesUsed = [];

  const firstResponse = await openai.chat.completions.create({
    model,
    messages,
    tools:       tools.length > 0 ? tools  : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    temperature: 0.2,
    max_tokens: 1000,
  });

  const firstChoice = firstResponse.choices[0];

  if (firstChoice.finish_reason === 'tool_calls' && firstChoice.message.tool_calls) {
    const toolCallMessages = [firstChoice.message];

    for (const toolCall of firstChoice.message.tool_calls) {
      const moduleName = toolCall.function.name;
      try {
        const args   = JSON.parse(toolCall.function.arguments);
        const result = await moduleRegistry.execute(moduleName, args);
        modulesUsed.push({ module: moduleName, args, success: true, summary: result.summary });
        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ summary: result.summary, data: result.data }),
        });
      } catch (err) {
        modulesUsed.push({ module: moduleName, success: false, error: err.message });
        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        });
      }
    }

    const finalResponse = await openai.chat.completions.create({
      model,
      messages: [...messages, ...toolCallMessages],
      temperature: 0.2,
      max_tokens: 1000,
    });

    return buildResult({
      answer: finalResponse.choices[0].message.content,
      ragResults,
      modulesUsed,
      usage: {
        firstCall:  firstResponse.usage,
        secondCall: finalResponse.usage,
        total: {
          prompt_tokens:     (firstResponse.usage?.prompt_tokens     || 0) + (finalResponse.usage?.prompt_tokens     || 0),
          completion_tokens: (firstResponse.usage?.completion_tokens || 0) + (finalResponse.usage?.completion_tokens || 0),
          total_tokens:      (firstResponse.usage?.total_tokens      || 0) + (finalResponse.usage?.total_tokens      || 0),
        },
      },
    });
  }

  if (!ragContext && modulesUsed.length === 0) {
    return {
      answer: 'No hay documentos en la base de conocimiento ni módulos que apliquen. Por favor, ingesta algún PDF o URL primero.',
      sources: [],
      modulesUsed: [],
      usage: firstResponse.usage,
    };
  }

  return buildResult({
    answer: firstChoice.message.content,
    ragResults,
    modulesUsed: [],
    usage: firstResponse.usage,
  });
}

// ── Helper ─────────────────────────────────────────────────────────────────
function buildResult({ answer, ragResults, modulesUsed, usage }) {
  const sourcesMap = new Map();
  ragResults.forEach((r) => {
    const key = r.metadata.source;
    if (!sourcesMap.has(key)) {
      sourcesMap.set(key, {
        source: r.metadata.source,
        title:  r.metadata.title || null,
        type:   r.metadata.type,
        relevanceScore: r.score,
      });
    }
  });

  return {
    answer,
    sources:     Array.from(sourcesMap.values()),
    modulesUsed,
    usage,
  };
}
