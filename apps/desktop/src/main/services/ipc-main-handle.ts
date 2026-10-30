import { dialog, BrowserWindow, app, shell } from "electron";
import { winURL, staticPaths } from "../config/static-path";
import DownloadFile from "../services/download-file";
import Update from "../services/check-update";
import config from "@config/index";
import type { IpcImpl, AppContract } from "ipc-contract";
import { webContentSend } from "./web-content-send";
import { IsUseSysTitle } from "@main/config/const";
import { otherWindowConfig } from "@main/config/windows-config";
import { openGameWindow } from "./game-window";
import { getDefaultOutputDeviceName, openSystemMixer, detectVirtualAudioDevice } from "./audio-devices";
import { getMachineId } from "./machine-id";
import {
  addUserMusic,
  deleteUserMusic,
  listUserMusic,
  getMusicMeta,
  setMusicMeta,
} from "./user-music";
import {
  addUserVoice,
  saveUserVoiceRecording,
  deleteUserVoice,
  listUserVoice,
  getVoiceMeta,
  setVoiceMeta,
} from "./user-voice";
import { edgeTtsSynthesize } from "./tts-edge";
import {
  connectOpenRoom,
  connectCloseRoom,
  connectStart,
  connectPull,
  connectStop,
  connectDiagnose,
  connectHideRoom,
  connectShowRoom,
  connectIsRoomHidden,
} from "./connect-danmaku";

import Store from "electron-store";

const store = new Store();
const allUpdater = new Update();

export const appIpcHandlers: IpcImpl<AppContract> = {
  openGameWindow: (_event, args) => {
    openGameWindow(args.url, args.title, {
      mute: args.mute,
      volume: args.volume,
      sinkDeviceId: args.sinkDeviceId,
    });
  },
  getDefaultAudioDevice: () => {
    return getDefaultOutputDeviceName();
  },
  openSystemMixer: () => {
    openSystemMixer();
  },
  detectVirtualAudioDevice: () => {
    return detectVirtualAudioDevice();
  },
  openExternalUrl: (_event, url: string) => {
    shell.openExternal(url);
  },
  getMachineId: () => {
    return getMachineId();
  },

  addUserMusic: async () => {
    return addUserMusic();
  },
  deleteUserMusic: async (_event, args) => {
    await deleteUserMusic(args.fileName);
  },
  listUserMusic: async () => {
    return listUserMusic();
  },
  getMusicMeta: () => {
    return getMusicMeta();
  },
  setMusicMeta: (_event, args) => {
    setMusicMeta(args.meta);
  },

  addUserVoice: async () => {
    return addUserVoice();
  },
  saveUserVoiceRecording: async (_event, args) => {
    return saveUserVoiceRecording(args);
  },
  deleteUserVoice: async (_event, args) => {
    await deleteUserVoice(args.fileName);
  },
  listUserVoice: async () => {
    return listUserVoice();
  },
  getVoiceMeta: () => {
    return getVoiceMeta();
  },
  setVoiceMeta: (_event, args) => {
    setVoiceMeta(args.meta);
  },

  edgeTtsSynthesize: async (_event, args) => {
    return edgeTtsSynthesize(args);
  },

  connectOpenRoom: (_event, args) => {
    return connectOpenRoom(args);
  },
  connectCloseRoom: (_event, args) => {
    connectCloseRoom(args);
  },
  connectStart: (_event, args) => {
    connectStart(args);
  },
  connectStop: (_event, args) => {
    connectStop(args);
  },
  connectPull: async (_event, args) => {
    return connectPull(args);
  },
  connectDiagnose: async (_event, args) => {
    return connectDiagnose(args);
  },
  connectHideRoom: (_event, args) => {
    connectHideRoom(args);
  },
  connectShowRoom: (_event, args) => {
    connectShowRoom(args);
  },
  connectIsRoomHidden: (_event, args) => {
    return connectIsRoomHidden(args);
  },

  startDownload: (event, downloadUrl) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    new DownloadFile(window, downloadUrl).start();
  },
  startServer: async () => {
    dialog.showErrorBox("error", "API is obsolete");
    return "API is obsolete";
  },
  stopServer: async () => {
    dialog.showErrorBox("error", "API is obsolete");
    return "API is obsolete";
  },
  getStaticPath: () => staticPaths,
  openWin: (_event, arg) => {
    const childWin = new BrowserWindow({
      titleBarStyle: IsUseSysTitle ? "default" : "hidden",
      ...Object.assign(otherWindowConfig, {}),
    });
    // 开发模式下自动开启devtools
    if (process.env.NODE_ENV === "development") {
      childWin.webContents.openDevTools({ mode: "undocked", activate: true });
    }
    childWin.loadURL(winURL + `#${arg.url}`);
    childWin.once("ready-to-show", () => {
      // childWin.show()
      if (arg.isPay) {
        // 检查支付时候自动关闭小窗口
        const testUrl = setInterval(() => {
          const Url = childWin.webContents.getURL();
          if (arg.payUrl && Url.includes(arg.payUrl)) {
            childWin.close();
          }
        }, 1200);
        childWin.on("close", () => {
          clearInterval(testUrl);
        });
      }
    });
    // 渲染进程显示时触发
    childWin.once("show", () => {
      webContentSend.window.sendData(childWin.webContents, arg.sendData);
    });
  },
  isUseSysTitle: () => config.IsUseSysTitle,
  winMinimize: (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  },
  winToggleMaximize: (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  },
  winIsMaximized: (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  },
  winClose: (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  },
  quit: () => {
    app.quit();
  },
  checkUpdate: (event) => {
    const windows = BrowserWindow.fromWebContents(event.sender);
    if (!windows) return;
    allUpdater.checkUpdate(windows);
  },
  confirmUpdate: () => {
    allUpdater.quitAndInstall();
  },
  openMessagebox: async (event, arg) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error("No window found for event sender");
    }
    return dialog.showMessageBox(window, {
      type: arg.type || "info",
      title: arg.title || "",
      buttons: arg.buttons || [],
      message: arg.message || "",
      noLink: arg.noLink || true,
    });
  },
  openErrorbox: (_event, arg) => {
    dialog.showErrorBox(arg.title, arg.message);
  },
  winReady: (event) => {
    const windows = BrowserWindow.fromWebContents(event.sender);
    if (!windows) return;
    windows.show();
  },
  // TODO: 实现"我的电脑"显示检查功能
  checkShowOnMyComputer: async () => {
    console.log("checkShowOnMyComputer - Not implemented yet");
    return false;
  },
  // TODO: 实现"我的电脑"显示设置功能
  setShowOnMyComputer: (_event, show) => {
    console.log("setShowOnMyComputer - Not implemented yet", show);
    return show;
  },
  setStoreValue: (_event, args) => {
    store.set(args.key, args.value);
  },
  getStoreValue: (_event, args) => {
    return store.get(args.key);
  },
  deleteStoreValue: (_event, args) => {
    store.delete(args.key);
  },
};
