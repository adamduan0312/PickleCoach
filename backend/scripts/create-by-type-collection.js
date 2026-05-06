#!/usr/bin/env node
/**
 * Builds the "by type" Postman collection from the "by flow" collection.
 * Reads PickleCoach_API_ByFlow.postman_collection.json, extracts all requests,
 * dedupes by method+path, groups by folder (Auth, Coaches, Bookings, etc.),
 * writes PickleCoach_API_ByType.postman_collection.json.
 *
 * Run after changing the flow collection if you want to sync type from flow.
 * Preferred: keep ByType as source, run reorganize-postman-flows.js to regenerate ByFlow.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flowPath = path.join(__dirname, '../../PickleCoach_API_ByFlow.postman_collection.json');
const typePath = path.join(__dirname, '../../PickleCoach_API_ByType.postman_collection.json');

const collection = JSON.parse(fs.readFileSync(flowPath, "utf8"));

function getPathSegments(request) {
  const url = request.url;
  if (!url) return [];
  if (Array.isArray(url.path)) return url.path;
  const raw = typeof url === 'string' ? url : url.raw || '';
  const match = raw.replace(/\{\{[\w]+\}\}/g, '').match(/\/api\/(.+)/) || raw.match(/\/([^?]+)/);
  if (match) return match[1].split('/').filter(Boolean);
  return [];
}

function pathToFolder(pathSegments) {
  const first = pathSegments[0];
  if (!first) return 'Other';
  if (first === 'health') return 'Health Check';
  if (first === 'auth') return 'Authentication';
  if (first === 'coaches') return 'Coaches';
  if (first === 'courts') return 'Courts';
  if (first === 'lessons') return 'Lessons';
  if (first === 'bookings') return 'Bookings';
  if (first === 'payments') return 'Payments';
  if (first === 'reschedules') return 'Reschedules';
  if (first === 'reviews') return 'Reviews';
  if (first === 'messages') return 'Messages';
  if (first === 'disputes') return 'Disputes';
  if (first === 'notifications') return 'Notifications';
  if (first === 'admin' || first === 'users') return 'Admin';
  if (first === 'webhooks') return 'Webhooks';
  return 'Other';
}

const FOLDER_ORDER = [
  'Health Check',
  'Authentication',
  'Coaches',
  'Courts',
  'Lessons',
  'Bookings',
  'Payments',
  'Reschedules',
  'Reviews',
  'Messages',
  'Disputes',
  'Notifications',
  'Admin',
  'Webhooks',
  'Other',
];

const seen = new Map(); // key = method + path -> request item
const byFolder = new Map(); // folderName -> [request items]

for (const folder of collection.item) {
  if (!folder.item || !Array.isArray(folder.item)) continue;
  for (const item of folder.item) {
    if (!item.request) continue;
    const method = item.request.method || 'GET';
    const pathSegments = getPathSegments(item.request);
    const pathKey = pathSegments.join('/');
    const key = `${method}|${pathKey}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    const typeFolder = pathToFolder(pathSegments);
    const name = item.name.replace(/^\d+\.\s+/, ''); // strip "1. ", "2. " prefix
    const clone = JSON.parse(JSON.stringify(item));
    clone.name = name;
    if (!byFolder.has(typeFolder)) byFolder.set(typeFolder, []);
    byFolder.get(typeFolder).push(clone);
  }
}

const typeFolders = [];
for (const folderName of FOLDER_ORDER) {
  const items = byFolder.get(folderName);
  if (!items || items.length === 0) continue;
  typeFolders.push({
    name: folderName,
    description: folderName === 'Authentication' ? 'Auth endpoints. Register/Login = no auth; Profile/Switch Role/Delete = authenticated.' : undefined,
    item: items,
  });
}

const typeCollection = {
  ...collection,
  info: {
    ...collection.info,
    name: 'PickleCoach API (By Type)',
    description: 'Endpoints grouped by resource/type. Use for finding a specific endpoint, debugging, and sharing with frontend. For flow-based testing use PickleCoach API (By Flow).',
  },
  item: typeFolders,
};

fs.writeFileSync(typePath, JSON.stringify(typeCollection, null, '\t'), 'utf8');
console.log('Written:', typePath);
console.log('Folders:', typeFolders.map(f => `${f.name} (${f.item.length})`).join(', '));
