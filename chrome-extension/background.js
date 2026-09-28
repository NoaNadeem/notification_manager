const MANAGER_URL = chrome.runtime.getURL("window.html");
const WIDTH = 520;
const HEIGHT = 720;
let opening = false;

async function openManager() {
  if (opening) return;
  opening = true;
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const existing = windows.find((window) => window.tabs?.some((tab) => tab.url === MANAGER_URL));
    if (existing) {
      await chrome.windows.update(existing.id, { focused: true });
      return;
    }
    await chrome.windows.create({ url: MANAGER_URL, type: "popup", width: WIDTH, height: HEIGHT });
  } finally {
    opening = false;
  }
}

// Chrome fires this once per profile start. Reopening an already running Chrome
// profile is handled by the first normal window after all normal windows close.
chrome.runtime.onStartup.addListener(() => { void openManager(); });
chrome.action.onClicked.addListener(() => { void openManager(); });

chrome.windows.onCreated.addListener((window) => {
  if (window.type !== "normal") return;
  void (async () => {
    const windows = await chrome.windows.getAll();
    if (windows.filter((item) => item.type === "normal").length === 1) {
      await openManager();
    }
  })();
});
