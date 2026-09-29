import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMediaUrl } from '../src/utils/mediaUrl.js';

describe('resolveMediaUrl', () => {
  it('passes through absolute and data URLs', () => {
    assert.equal(resolveMediaUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(resolveMediaUrl('data:image/png;base64,aaa'), 'data:image/png;base64,aaa');
  });

  it('prefixes app-relative upload paths with the API origin', () => {
    assert.equal(
      resolveMediaUrl('/uploads/avatars/1-x.jpg', 'http://localhost:4000/api'),
      'http://localhost:4000/uploads/avatars/1-x.jpg',
    );
  });

  it('returns null for empty values', () => {
    assert.equal(resolveMediaUrl(null), null);
    assert.equal(resolveMediaUrl(''), null);
  });
});
