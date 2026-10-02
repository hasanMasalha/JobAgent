// How many LinkedIn jobs one batch may hand to the extension. The same number
// as the extension's hourly cap (MAX_APPLIES_PER_HOUR, chrome-extension/
// background.js): a bigger batch could never finish in one go. Jobs past it
// are not queued and not charged.
export const MAX_EXTENSION_BATCH = 12;
