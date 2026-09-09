import { listModules } from './ragKnowledge.js';
import { vectorStore } from '../vectorStore/inMemoryStore.js';

const CHUNK_SIZE    = parseInt(process.env.CHUNK_SIZE)    || 500;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 50;

/**
 * Divide texto en chunks con superposición.
 */
function splitIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Carga todos los módulos almacenados en PocketBase al vector store.
 *
 * Se llama al iniciar el servidor para que el RAG tenga el conocimiento
 * disponible de inmediato sin necesidad de re-ingestar.
 *
 * Estrategia de paginación: recupera de a 100 registros hasta agotar.
 */
export async function loadKnowledgeBase() {
  console.log('\n[loadKnowledgeBase] Cargando módulos desde PocketBase...');

  if (!process.env.RAG_DB_API_KEY) {
    console.warn('[loadKnowledgeBase] RAG_DB_API_KEY no configurado — se omite carga de conocimiento.');
    return { loaded: 0, skipped: 0 };
  }

  let page       = 1;
  const perPage  = 100;
  let allModules = [];

  // Paginar hasta obtener todos
  while (true) {
    try {
      const batch = await listModules({ page, perPage });
      if (batch.length === 0) break;
      allModules = allModules.concat(batch);
      if (batch.length < perPage) break;
      page++;
    } catch (err) {
      console.error('[loadKnowledgeBase] Error al listar módulos:', err.message);
      break;
    }
  }

  console.log('[loadKnowledgeBase] Total módulos en PocketBase:', allModules.length);

  let loaded  = 0;
  let skipped = 0;

  for (const mod of allModules) {
    const { id, moduleName, content, fileName, totalPages } = mod;

    if (!content || content.trim().length === 0) {
      console.warn('[loadKnowledgeBase] Módulo "' + moduleName + '" sin contenido — omitido.');
      skipped++;
      continue;
    }

    const rawChunks = splitIntoChunks(content.trim());

    const chunks = rawChunks.map((chunk, index) => ({
      text:     chunk,
      metadata: {
        source:      moduleName,
        title:       moduleName,
        fileName:    fileName || 'desconocido',
        type:        'pdf-base64',
        pages:       parseInt(totalPages) || 0,
        chunkIndex:  index,
        totalChunks: rawChunks.length,
      },
    }));

    vectorStore.registerDocument({ id, source: moduleName, type: 'pdf-base64' });
    const count = await vectorStore.addChunks(chunks, id);

    console.log('[loadKnowledgeBase]  ✓ "' + moduleName + '" — ' + count + ' chunks');
    loaded++;
  }

  const stats = vectorStore.getStats();
  console.log(
    '[loadKnowledgeBase] Carga completa —',
    loaded, 'módulos cargados |',
    skipped, 'omitidos |',
    stats.totalChunks, 'chunks en memoria\n',
  );

  return { loaded, skipped };
}
