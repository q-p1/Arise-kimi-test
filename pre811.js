'use strict';

// AP-811 compatibility shim. Older builds always requested DB version 1,
// which makes IndexedDB throw VersionError if the same database has ever
// been upgraded. Preserve the existing schema/version by omitting that
// hard-coded version only for Arise Player's database.
(() => {
  if (typeof IDBFactory === 'undefined') return;
  const originalOpen = IDBFactory.prototype.open;
  if (originalOpen.__arise811) return;
  function ariseOpen(name, version) {
    if (name === 'arise-player-v3' && version === 1) {
      return originalOpen.call(this, name);
    }
    return arguments.length > 1
      ? originalOpen.call(this, name, version)
      : originalOpen.call(this, name);
  }
  ariseOpen.__arise811 = true;
  IDBFactory.prototype.open = ariseOpen;
})();
