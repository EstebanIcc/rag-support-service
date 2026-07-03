import OpenAI from 'openai';

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Genera embeddings para un array de textos usando OpenAI
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array de vectores
 */
export async function generateEmbeddings(texts) {
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const openai = getClient();

  // OpenAI acepta hasta 2048 textos por request
  const batchSize = 100;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({ model, input: batch });
    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * Genera embedding para un único texto
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}
