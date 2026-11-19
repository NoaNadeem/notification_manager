import { openInBrowser } from "./open.js";

document.querySelector("#version").textContent = chrome.runtime.getManifest().version;
document.querySelector("#open-extensions").addEventListener("click", async () => {
  const error = document.querySelector("#error");
  error.textContent = "";
  try { await openInBrowser(chrome, "chrome://extensions"); }
  catch { error.textContent = "Could not open Chrome extensions. Type chrome://extensions in Chrome’s address bar."; }
});
