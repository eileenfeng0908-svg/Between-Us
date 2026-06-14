// ==============================================
//  Between Us — db.js
//  Session-only letter store.
//
//  Letters live in memory for the current tab.
//  Nothing is written to this device.
//  Closing the tab clears everything.
// ==============================================

const BetweenUsDB = (() => {

  let _letters = [];

  async function saveLetter(entry) {
    _letters.unshift(entry);
  }

  async function loadLetters() {
    return [..._letters];
  }

  function sessionLetterCount() {
    return _letters.length;
  }

  return { saveLetter, loadLetters, sessionLetterCount };

})();
