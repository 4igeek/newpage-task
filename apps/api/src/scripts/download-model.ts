/**
 * Downloads the embedding model into MODEL_CACHE_DIR. Run at Docker build
 * time so containers start without network access to Hugging Face.
 */
import { LocalEmbedder } from '../adapters/local-embedder.js';
import { loadConfig } from '../config.js';

const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused', ...process.env });
const embedder = await LocalEmbedder.load({
  modelId: config.EMBEDDING_MODEL,
  cacheDir: config.MODEL_CACHE_DIR,
});
const [vector] = await embedder.embed(['warm-up'], 'document');
console.log(
  `Model ${embedder.modelId} ready (${vector?.length} dims) in ${config.MODEL_CACHE_DIR}`,
);
