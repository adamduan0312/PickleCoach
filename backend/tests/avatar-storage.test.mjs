import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extensionForAvatarMime,
  isAllowedAvatarMime,
  isManagedAvatarPath,
  publicPathForAvatarFilename,
  resolveManagedAvatarFile,
} from '../utils/avatarStorage.js';

describe('avatarStorage', () => {
  it('accepts jpg/png/webp only', () => {
    assert.equal(isAllowedAvatarMime('image/jpeg'), true);
    assert.equal(isAllowedAvatarMime('image/png'), true);
    assert.equal(isAllowedAvatarMime('image/webp'), true);
    assert.equal(isAllowedAvatarMime('image/gif'), false);
    assert.equal(isAllowedAvatarMime('application/pdf'), false);
  });

  it('maps mime to extension', () => {
    assert.equal(extensionForAvatarMime('image/jpeg'), '.jpg');
    assert.equal(extensionForAvatarMime('image/png'), '.png');
    assert.equal(extensionForAvatarMime('image/webp'), '.webp');
    assert.equal(extensionForAvatarMime('image/gif'), null);
  });

  it('only treats safe /uploads/avatars paths as managed', () => {
    assert.equal(isManagedAvatarPath('/uploads/avatars/1-abc.jpg'), true);
    assert.equal(isManagedAvatarPath('https://cdn.example.com/a.jpg'), false);
    assert.equal(isManagedAvatarPath('/uploads/avatars/../secrets.txt'), false);
    assert.equal(isManagedAvatarPath('/uploads/other/1.jpg'), false);
    assert.equal(publicPathForAvatarFilename('1-abc.jpg'), '/uploads/avatars/1-abc.jpg');
  });

  it('resolves managed files under the avatar directory only', () => {
    const resolved = resolveManagedAvatarFile('/uploads/avatars/user-1.jpg');
    assert.ok(resolved);
    assert.match(resolved, /uploads[/\\]avatars[/\\]user-1\.jpg$/);
    assert.equal(resolveManagedAvatarFile('/uploads/avatars/../x.jpg'), null);
  });
});
