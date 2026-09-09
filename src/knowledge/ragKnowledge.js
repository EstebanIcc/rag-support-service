import axios from 'axios';
import https from 'https';

/**
 * Cliente para la base de datos PocketBase de conocimiento RAG.
 *
 * Colección: pbc_906848905
 * Campos: moduleName | content | fileName | totalPages
 *
 * Variables de entorno requeridas:
 *   RAG_DB_URL     = https://base-rag-sgtsaq.jelou.cloud
 *   RAG_DB_API_KEY = tu-api-key
 */

const httpsAgent = new https.Agent({ keepAlive: false });

const BASE_URL      = process.env.RAG_DB_URL || 'https://base-rag-sgtsaq.jelou.cloud';
const COLLECTION    = 'pbc_906848905';
const RECORDS_URL   = BASE_URL + '/api/collections/' + COLLECTION + '/records';

function getHeaders() {
  const apiKey = process.env.RAG_DB_API_KEY;
  if (!apiKey) throw new Error('RAG_DB_API_KEY no está configurado en .env');
  return {
    'X-Api-Key':    apiKey,
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
}

// ── Listar todos los módulos ───────────────────────────────────────────────

export async function listModules({ page = 1, perPage = 50 } = {}) {
  console.log('[ragKnowledge] Listando módulos...');

  const response = await axios.get(RECORDS_URL, {
    timeout: 15000,
    httpsAgent,
    headers: getHeaders(),
    params: { page, perPage, sort: '-created' },
  });

  const items = response.data?.items || [];
  console.log('[ragKnowledge] Módulos encontrados:', items.length);
  return items;
}

// ── Buscar por moduleName exacto ───────────────────────────────────────────

export async function findByModuleName(moduleName) {
  console.log('[ragKnowledge] Buscando módulo:', moduleName);

  const response = await axios.get(RECORDS_URL, {
    timeout: 15000,
    httpsAgent,
    headers: getHeaders(),
    params: {
      page:    1,
      perPage: 1,
      filter:  'moduleName="' + moduleName + '"',
    },
  });

  const items = response.data?.items || [];
  const found = items.length > 0 ? items[0] : null;
  console.log('[ragKnowledge] Módulo "' + moduleName + '":', found ? 'encontrado (id: ' + found.id + ')' : 'no existe');
  return found;
}

// ── Crear módulo nuevo ─────────────────────────────────────────────────────

export async function createModule({ moduleName, content, fileName, totalPages }) {
  console.log('[ragKnowledge] Creando módulo:', moduleName);

  const body = { moduleName, content, fileName, totalPages: String(totalPages) };
  console.log('[ragKnowledge] POST body (content truncado):', {
    ...body,
    content: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
  });

  const response = await axios.post(RECORDS_URL, body, {
    timeout: 30000,
    httpsAgent,
    headers: getHeaders(),
  });

  console.log('[ragKnowledge] POST HTTP', response.status, '- id:', response.data?.id);
  return response.data;
}

// ── Actualizar módulo existente ────────────────────────────────────────────

export async function updateModule(id, { moduleName, content, fileName, totalPages }) {
  console.log('[ragKnowledge] Actualizando módulo id:', id);

  const body = { moduleName, content, fileName, totalPages: String(totalPages) };

  const response = await axios.patch(RECORDS_URL + '/' + id, body, {
    timeout: 30000,
    httpsAgent,
    headers: getHeaders(),
  });

  console.log('[ragKnowledge] PATCH HTTP', response.status, '- id:', response.data?.id);
  return response.data;
}

// ── Crear o actualizar según si ya existe el moduleName ───────────────────

export async function upsertModule({ moduleName, content, fileName, totalPages }) {
  const existing = await findByModuleName(moduleName);

  if (existing) {
    console.log('[ragKnowledge] Módulo ya existe → actualizando...');
    return { record: await updateModule(existing.id, { moduleName, content, fileName, totalPages }), isNew: false };
  }

  console.log('[ragKnowledge] Módulo nuevo → creando...');
  return { record: await createModule({ moduleName, content, fileName, totalPages }), isNew: true };
}
