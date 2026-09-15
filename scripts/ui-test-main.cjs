"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
app.disableHardwareAcceleration();
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");
const starts = [];
ipcMain.handle("qa:record-start", (_event, options) => { starts.push(options); return true; });
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 920, height: 1080, show: false,
    webPreferences: { preload: path.join(__dirname, "ui-test-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const execute = (source) => window.webContents.executeJavaScript(source, true);
  async function waitFor(source) {
    for (let i = 0; i < 100; i++) {
      if (await execute(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`UI condition did not become true: ${source}`);
  }
  const click = async (id) => { await execute(`document.getElementById(${JSON.stringify(id)}).click()`); };
  try {
    await window.loadFile(path.join(__dirname, "../src/ui/index.html"));
    await waitFor("document.querySelector('#versionLabel').textContent.includes('1.3.0')");
    assert.equal(await execute("document.querySelector('#openaiModeButton').disabled"), true);
    assert.equal(await execute("document.querySelector('#cloudLock').hidden"), false);
    assert.equal(await execute("document.querySelector('#identifySpeakersCheckbox').disabled"), true);
    assert.equal(await execute("document.querySelector('#startButton').disabled"), true);
    assert.equal(await execute("document.querySelector('.brand-mark').naturalWidth > 0"), true);
    assert.equal(await execute("document.documentElement.scrollWidth <= innerWidth"), true);
    const screenshots = path.resolve("ui-check");
    await fs.mkdir(screenshots, { recursive: true });
    await fs.writeFile(path.join(screenshots, "local-ru.png"), (await window.webContents.capturePage()).toPNG());
    await click("downloadModelsButton");
    await waitFor("document.querySelector('#modelStatus').textContent.includes('готово')");
    await click("chooseVideoButton"); await click("chooseOutputButton");
    await waitFor("!document.querySelector('#startButton').disabled");
    await click("startButton");
    await waitFor("!document.querySelector('#resultSection').hidden");
    assert.equal(starts[0].mode, "local"); assert.equal(starts[0].identifySpeakers, false);
    assert.equal(starts[0].videoPaths.length, 2);
    await execute("document.querySelector('[data-locale=en]').click()");
    await waitFor("document.documentElement.lang === 'en'");
    assert.equal(await execute("document.querySelector('#localModeButton').textContent"), "On this computer");
    await click("settingsButton");
    await execute("document.querySelector('#apiKeyInput').value='test-key-never-sent-anywhere';document.querySelector('#settingsForm').requestSubmit()");
    await waitFor("!document.querySelector('#settingsDialog').open");
    assert.equal(await execute("document.querySelector('#openaiModeButton').disabled"), false);
    assert.equal(await execute("document.querySelector('#localModeButton').getAttribute('aria-pressed')"), "true");
    await click("openaiModeButton");
    await waitFor("document.querySelector('#openaiModeButton').getAttribute('aria-pressed') === 'true'");
    assert.equal(await execute("document.querySelector('#identifySpeakersCheckbox').disabled"), false);
    await fs.writeFile(path.join(screenshots, "openai-en.png"), (await window.webContents.capturePage()).toPNG());
    await click("startButton");
    await waitFor("!document.querySelector('#resultSection').hidden");
    assert.equal(starts[1].mode, "openai"); assert.equal(starts[1].locale, "en");
    await click("settingsButton"); await click("deleteKeyButton");
    await waitFor("document.querySelector('#openaiModeButton').disabled");
    await click("closeSettingsButton");
    assert.equal(await execute("document.querySelector('#localModeButton').getAttribute('aria-pressed')"), "true");
    window.setSize(760, 760);
    assert.equal(await execute("document.documentElement.scrollWidth <= innerWidth"), true);
    console.log("UI checks passed: locked OpenAI, local setup, both modes, RU/EN, key deletion, multi-file input, layout.");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
