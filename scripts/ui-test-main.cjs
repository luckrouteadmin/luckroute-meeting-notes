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
  const window = new BrowserWindow({ width: 820, height: 820, show: true,
    webPreferences: { preload: path.join(__dirname, "ui-test-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  const execute = (source) => window.webContents.executeJavaScript(source, true);
  const painted = () => execute("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
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
    await waitFor("document.querySelector('#versionLabel').textContent.includes('1.3.2')");
    assert.equal(await execute("document.querySelector('#openaiModeButton').disabled"), true);
    assert.notEqual(await execute("getComputedStyle(document.querySelector('#cloudLock')).display"), "none");
    assert.equal(await execute("document.querySelector('#identifySpeakersCheckbox') === null"), true);
    assert.match(await execute("document.querySelector('#identifyNamesDescription').textContent"), /не разделяет голоса/);
    assert.equal(await execute("document.querySelector('#startButton').disabled"), true);
    assert.equal(await execute("document.querySelector('#summaryDetail').value"), "2");
    assert.match(await execute("document.querySelector('#detailHint').textContent"), /10 000–30 000/);
    assert.equal(await execute("document.querySelector('.brand-mark').naturalWidth > 0"), true);
    assert.equal(await execute("document.documentElement.scrollWidth <= innerWidth"), true);
    const screenshots = path.resolve("ui-check");
    await fs.mkdir(screenshots, { recursive: true });
    await painted();
    await fs.writeFile(path.join(screenshots, "local-ru.png"), (await window.webContents.capturePage()).toPNG());
    await click("downloadModelsButton");
    await waitFor("document.querySelector('#modelStatus').textContent.includes('готово')");
    await click("chooseVideoButton"); await click("chooseOutputButton");
    await waitFor("!document.querySelector('#startButton').disabled");
    await click("startButton");
    await waitFor("!document.querySelector('#resultSection').hidden");
    assert.equal(starts[0].mode, "local"); assert.equal(Object.hasOwn(starts[0], "identifySpeakers"), false);
    assert.equal(starts[0].videoPaths.length, 2);
    assert.equal(starts[0].summaryDetail, "detailed");
    await execute("document.querySelector('[data-locale=en]').click()");
    await waitFor("document.documentElement.lang === 'en'");
    await execute("const slider=document.querySelector('#summaryDetail');slider.value='0';slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'))");
    assert.equal(await execute("document.querySelector('#summaryDetail').getAttribute('aria-valuetext')"), "Brief");
    assert.equal(await execute("document.querySelector('#localModeButton').textContent"), "On this computer");
    await click("settingsButton");
    await execute("document.querySelector('#apiKeyInput').value='test-key-never-sent-anywhere';document.querySelector('#settingsForm').requestSubmit()");
    await waitFor("!document.querySelector('#settingsDialog').open");
    assert.equal(await execute("document.querySelector('#openaiModeButton').disabled"), false);
    assert.equal(await execute("getComputedStyle(document.querySelector('#cloudLock')).display"), "none");
    assert.equal(await execute("document.querySelector('#localModeButton').getAttribute('aria-pressed')"), "true");
    await click("openaiModeButton");
    await waitFor("document.querySelector('#openaiModeButton').getAttribute('aria-pressed') === 'true'");
    assert.match(await execute("document.querySelector('#identifyNamesDescription').textContent"), /dialogue/);
    await painted();
    await fs.writeFile(path.join(screenshots, "openai-en.png"), (await window.webContents.capturePage()).toPNG());
    await click("startButton");
    await waitFor("!document.querySelector('#resultSection').hidden");
    assert.equal(starts[1].mode, "openai"); assert.equal(starts[1].locale, "en");
    assert.equal(starts[1].summaryDetail, "brief");
    await click("settingsButton"); await click("deleteKeyButton");
    await waitFor("document.querySelector('#openaiModeButton').disabled");
    assert.notEqual(await execute("getComputedStyle(document.querySelector('#cloudLock')).display"), "none");
    await click("closeSettingsButton");
    assert.equal(await execute("document.querySelector('#localModeButton').getAttribute('aria-pressed')"), "true");
    window.setSize(700, 640);
    assert.equal(await execute("document.documentElement.scrollWidth <= innerWidth"), true);
    console.log("UI checks passed: locked OpenAI, local setup, both modes, RU/EN, key deletion, multi-file input, layout.");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
