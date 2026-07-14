import '@testing-library/jest-dom/vitest';

process.env.LICENSE_SECRET = 'test-secret-for-unit-tests';

const mockElectron = {
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {},
    getAppPath: () => '/tmp',
  },
  BrowserWindow: class MockBrowserWindow {
    constructor() {}
    loadURL() {}
    loadFile() {}
    once() {}
    on() {}
    webContents = {
      openDevTools() {},
      on() {},
    };
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived() {},
      },
    },
  },
  ipcMain: {
    handle() {},
    on() {},
  },
  shell: {
    openPath() { return Promise.resolve(''); },
  },
  Notification: class MockNotification {
    constructor() {}
    show() {}
  },
  dialog: {
    showErrorBox() {},
  },
};

vi.mock('electron', () => mockElectron);
