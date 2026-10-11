import { compareVersions, slug } from './versions.js';

export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/+$/, '');
}

/**
 * Computes status for a repository payload according to redesign spec §4:
 *
 * | Slot state | Card | Button |
 * |---|---|---|
 * | no slot (same id may exist from another source) | – (+ "Also installed from X" hint) | Install -> conflict dialog if conflict |
 * | repo newer | Update badge | Update |
 * | equal, checksum differs | Update badge | Update |
 * | equal | Installed | Reinstall |
 * | repo older | Installed | (none) |
 *
 * Local slots never show up on repo cards.
 */
export function getPayloadStatus({ payload, srcUrl, items = [], multiSources = false }) {
  void multiSources;
  if (!payload) {
    return {
      status: 'not_installed',
      isInstalled: false,
      isUpdate: false,
      installedSlot: null,
      otherSlots: [],
      hasConflict: false,
      conflictSlot: null,
      alsoInstalledFrom: null,
      badge: null,
      buttonAction: null,
    };
  }

  const targetId = payload.id || slug(payload.name || payload.filename);
  const normSrcUrl = normalizeUrl(srcUrl);

  const repoItems = Array.isArray(items)
    ? items.filter((item) => item && item.kind === 'repo')
    : [];

  const installedSlot =
    repoItems.find(
      (item) =>
        normalizeUrl(item.source_url) === normSrcUrl && item.id === targetId
    ) || null;

  const otherSlots = repoItems.filter(
    (item) =>
      item.id === targetId && normalizeUrl(item.source_url) !== normSrcUrl
  );

  if (!installedSlot) {
    const conflictSlot = otherSlots.length > 0 ? otherSlots[0] : null;
    const alsoInstalledFrom = conflictSlot
      ? conflictSlot.source_name || conflictSlot.source_url || 'another repository'
      : null;

    return {
      status: 'not_installed',
      isInstalled: false,
      isUpdate: false,
      installedSlot: null,
      otherSlots,
      hasConflict: otherSlots.length > 0,
      conflictSlot,
      alsoInstalledFrom,
      badge: null,
      buttonAction: 'install',
    };
  }

  // Matching slot exists for this (source_url, id)
  const cmp = compareVersions(
    payload.version,
    installedSlot.version,
    payload.last_update,
    installedSlot.last_update
  );

  if (cmp > 0) {
    // Repo is newer
    return {
      status: 'update',
      isInstalled: false,
      isUpdate: true,
      installedSlot,
      otherSlots,
      hasConflict: false,
      conflictSlot: null,
      alsoInstalledFrom: null,
      badge: 'update',
      buttonAction: 'update',
    };
  }

  if (cmp === 0) {
    // Check if checksum differs
    const checksumDiffers = Boolean(
      payload.checksum &&
        installedSlot.checksum &&
        payload.checksum.trim().toLowerCase() !==
          installedSlot.checksum.trim().toLowerCase()
    );

    if (checksumDiffers) {
      return {
        status: 'update',
        isInstalled: false,
        isUpdate: true,
        installedSlot,
        otherSlots,
        hasConflict: false,
        conflictSlot: null,
        alsoInstalledFrom: null,
        badge: 'update',
        buttonAction: 'update',
      };
    }

    return {
      status: 'installed',
      isInstalled: true,
      isUpdate: false,
      installedSlot,
      otherSlots,
      hasConflict: false,
      conflictSlot: null,
      alsoInstalledFrom: null,
      badge: 'installed',
      buttonAction: 'reinstall',
    };
  }

  // cmp < 0: Repo is older than installed slot
  return {
    status: 'older',
    isInstalled: true,
    isUpdate: false,
    installedSlot,
    otherSlots,
    hasConflict: false,
    conflictSlot: null,
    alsoInstalledFrom: null,
    badge: 'installed',
    buttonAction: null,
  };
}
