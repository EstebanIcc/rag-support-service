import { v4 as uuidv4 } from 'uuid';
import { generateEmbeddings, generateEmbedding } from '../embeddings/openaiEmbeddings.js';

/**
 * Vector store en memoria con búsqueda por similitud coseno
 */
class InMemoryVectorStore {
  constructor() {
    // { id, text, embedding, metadata, documentId }
    this.chunks = [];
    // { id, source, type, addedAt, chunkCount }
    this.documents = [];
  }

  /**
   * Agrega chunks al store generando embeddings
   * @param {Array<{text: string, metadata: object}>} chunks
   * @param {string} documentId - ID del documento padre
   */
  async addChunks(chunks, documentId) {
    const texts = chunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    const newChunks = chunks.map((chunk, i) => ({
      id: uuidv4(),
      text: chunk.text,
      embedding: embeddings[i],
      metadata: chunk.metadata,
      documentId,
    }));

    this.chunks.push(...newChunks);
    return newChunks.length;
  }

  /**
   * Busca los K chunks más similares a una query
   * @param {string} query
   * @param {number} topK
   * @returns {Promise<Array<{text, metadata, score}>>}
   */
  async search(query, topK = 5) {
    if (this.chunks.length === 0) return [];

    const queryEmbedding = await generateEmbedding(query);

    const scored = this.chunks.map((chunk) => ({
      text: chunk.text,
      metadata: chunk.metadata,
      documentId: chunk.documentId,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Elimina todos los chunks de un documento
   * @param {string} documentId
   */
  removeDocument(documentId) {
    const before = this.chunks.length;
    this.chunks = this.chunks.filter((c) => c.documentId !== documentId);
    this.documents = this.documents.filter((d) => d.id !== documentId);
    return before - this.chunks.length;
  }

  /**
   * Registra un documento en el índice
   */
  registerDocument({ id, source, type }) {
    this.documents.push({
      id,
      source,
      type,
      addedAt: new Date().toISOString(),
    });
  }

  getDocuments() {
    return this.documents.map((doc) => ({
      ...doc,
      chunkCount: this.chunks.filter((c) => c.documentId === doc.id).length,
    }));
  }

  getStats() {
    return {
      totalChunks: this.chunks.length,
      totalDocuments: this.documents.length,
    };
  }
}

/**
 * Calcula similitud coseno entre dos vectores
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Singleton exportado
export const vectorStore = new InMemoryVectorStore();
