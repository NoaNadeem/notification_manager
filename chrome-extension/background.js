const MANAGER_URL = chrome.runtime.getURL("window.html");
const WIDTH = 520;
const HEIGHT = 720;
let opening = false;

async function centeredPosition(windows) {
  try {
    const displays = await chrome.system.display.getInfo();
    const normal = windows.find((window) => window.type === "normal" && window.focused)
      || windows.find((window) => window.type === "normal");
    const centerX = normal?.left + normal?.width / 2;
    const centerY = normal?.top + normal?.height / 2;
    const display = displays.find(({ bounds }) =>
      centerX >= bounds.left && centerX < bounds.left + bounds.width &&
      centerY >= bounds.top && centerY < bounds.top + bounds.height
    ) || displays.find(({ isPrimary }) => isPrimary) || displays[0];
    if (!display) return {};
    const area = display.workArea || display.bounds;
    return {
      left: Math.round(area.left + Math.max(0, area.width - WIDTH) / 2),
      top: Math.round(area.top + Math.max(0, area.height - HEIGHT) / 2)
    };
  } catch {
    return {};
  }
}

async function openManager() {
  if (opening) return;
  opening = true;
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const position = await centeredPosition(windows);
    const existing = windows.find((window) => window.tabs?.some((tab) => tab.url === MANAGER_URL));
    if (existing) {
      await chrome.windows.update(existing.id, { ...position, focused: true });
      return;
    }
    await chrome.windows.create({
      url: MANAGER_URL, type: "popup", width: WIDTH, height: HEIGHT,
      ...position
    });
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
