import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import askRouter from './routes/ask.js';
import ingestRouter from './routes/ingest.js';
import documentsRouter from './routes/documents.js';
import modulesRouter from './routes/modules.js';
import { loadKnowledgeBase } from './knowledge/loadKnowledgeBase.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/ask', askRouter);
app.use('/ingest', ingestRouter);
app.use('/documents', documentsRouter);
app.use('/modules', modulesRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RAG Service',
    timestamp: new Date().toISOString(),
    env: {
      embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      chatModel: process.env.CHAT_MODEL || 'gpt-4o-mini',
      hasApiKey: !!process.env.OPENAI_API_KEY,
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada.` });
});

app.use((err, req, res, next) => {
  console.error('[Error global]', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor.' });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 RAG Service corriendo en http://localhost:${PORT}`);
  console.log(`\nEndpoints disponibles:`);
  console.log(`  GET  /health             - Estado del servicio`);
  console.log(`  POST /ask                - Hacer una pregunta al agente`);
  console.log(`  POST /ingest/pdf         - Ingestar un PDF (multipart)`);
  console.log(`  POST /ingest/url         - Ingestar una URL`);
  console.log(`  POST /ingest/base64      - Ingestar un PDF en base64`);
  console.log(`  GET  /documents          - Listar documentos indexados`);
  console.log(`  DELETE /documents/:id    - Eliminar un documento`);
  console.log(`  GET  /modules            - Listar módulos activos`);
  console.log(`  DELETE /modules/:name    - Desactivar un módulo\n`);

  // Cargar base de conocimiento desde PocketBase al iniciar
  try {
    await loadKnowledgeBase();
  } catch (err) {
    console.error('[app] Error al cargar knowledge base:', err.message);
  }
});

export default app;
