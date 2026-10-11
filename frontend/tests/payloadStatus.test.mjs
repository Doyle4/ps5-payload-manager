import test from 'node:test';
import assert from 'node:assert/strict';
import { getPayloadStatus } from '../src/utils/payloadStatus.js';

const OFFICIAL_URL = 'https://official.repo/payloads.json';
const OTHER_URL = 'https://other.repo/payloads.json';

test('getPayloadStatus: no slot, no conflict -> not_installed with Install button', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.11',
    checksum: 'abc111',
  };
  const items = [];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'not_installed');
  assert.equal(status.isInstalled, false);
  assert.equal(status.isUpdate, false);
  assert.equal(status.hasConflict, false);
  assert.equal(status.alsoInstalledFrom, null);
  assert.equal(status.badge, null);
  assert.equal(status.buttonAction, 'install');
});

test('getPayloadStatus: no slot, same id in another repo -> not_installed with conflict & alsoInstalledFrom', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.11',
    checksum: 'abc111',
  };
  const items = [
    {
      kind: 'repo',
      slot: 'repo/kstuff-lite@99999999',
      id: 'kstuff-lite',
      source_url: OTHER_URL,
      source_name: 'Other Repository',
      version: '1.10',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'not_installed');
  assert.equal(status.isInstalled, false);
  assert.equal(status.isUpdate, false);
  assert.equal(status.hasConflict, true);
  assert.equal(status.alsoInstalledFrom, 'Other Repository');
  assert.equal(status.badge, null);
  assert.equal(status.buttonAction, 'install');
});

test('getPayloadStatus: local slots are completely ignored and do not match repo cards', () => {
  const payload = {
    id: 'ftpsrv',
    name: 'ftpsrv',
    version: '1.0',
  };
  const items = [
    {
      kind: 'local',
      slot: 'local/ftpsrv',
      filename: 'ftpsrv.elf',
      origin: 'web_upload',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'not_installed');
  assert.equal(status.isInstalled, false);
  assert.equal(status.hasConflict, false);
  assert.equal(status.buttonAction, 'install');
});

test('getPayloadStatus: repo newer -> update badge and Update button', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.12',
    checksum: 'abc112',
  };
  const items = [
    {
      kind: 'repo',
      slot: 'repo/kstuff-lite@3fa91c0e',
      id: 'kstuff-lite',
      source_url: OFFICIAL_URL,
      source_name: 'Official Repository',
      version: '1.11',
      checksum: 'abc111',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'update');
  assert.equal(status.isInstalled, false);
  assert.equal(status.isUpdate, true);
  assert.equal(status.badge, 'update');
  assert.equal(status.buttonAction, 'update');
});

test('getPayloadStatus: equal version with differing checksum -> update badge and Update button', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.11',
    checksum: 'newhash',
  };
  const items = [
    {
      kind: 'repo',
      slot: 'repo/kstuff-lite@3fa91c0e',
      id: 'kstuff-lite',
      source_url: OFFICIAL_URL,
      source_name: 'Official Repository',
      version: '1.11',
      checksum: 'oldhash',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'update');
  assert.equal(status.isUpdate, true);
  assert.equal(status.badge, 'update');
  assert.equal(status.buttonAction, 'update');
});

test('getPayloadStatus: equal version and checksum -> installed badge and Reinstall button', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.11',
    checksum: 'samehash',
  };
  const items = [
    {
      kind: 'repo',
      slot: 'repo/kstuff-lite@3fa91c0e',
      id: 'kstuff-lite',
      source_url: OFFICIAL_URL,
      source_name: 'Official Repository',
      version: '1.11',
      checksum: 'samehash',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'installed');
  assert.equal(status.isInstalled, true);
  assert.equal(status.isUpdate, false);
  assert.equal(status.badge, 'installed');
  assert.equal(status.buttonAction, 'reinstall');
});

test('getPayloadStatus: repo older -> installed badge and no button', () => {
  const payload = {
    id: 'kstuff-lite',
    name: 'kstuff-lite',
    version: '1.10',
    checksum: 'oldhash',
  };
  const items = [
    {
      kind: 'repo',
      slot: 'repo/kstuff-lite@3fa91c0e',
      id: 'kstuff-lite',
      source_url: OFFICIAL_URL,
      source_name: 'Official Repository',
      version: '1.11',
      checksum: 'current',
    },
  ];
  const status = getPayloadStatus({ payload, srcUrl: OFFICIAL_URL, items });

  assert.equal(status.status, 'older');
  assert.equal(status.isInstalled, true);
  assert.equal(status.isUpdate, false);
  assert.equal(status.badge, 'installed');
  assert.equal(status.buttonAction, null);
});
