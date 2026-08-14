/**
 * Load JWT/secrets for integration tests without switching NODE_ENV away from `test`.
 * Used via: node --import ./tests/helpers/loadIntegrationEnv.mjs ...
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preservedNodeEnv = process.env.NODE_ENV || 'test';

dotenv.config({ path: path.join(root, '.env.development') });

// Keep test DB selection (config.json → picklecoach_test)
process.env.NODE_ENV = preservedNodeEnv === 'development' ? 'test' : preservedNodeEnv;
process.env.SKIP_SERVER_LISTEN = '1';
