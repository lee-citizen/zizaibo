"use strict";

import { app, protocol, BrowserWindow, session } from "electron";
import InitWindow from "./services/window-manager";
import { useDisableButton } from "./hooks/disable-button-hook";
import { useProcessException } from "@main/hooks/exception-hook";
import { useMenu } from "@main/hooks/menu-hook";
import { useMainDefaultIpc } from "./services/ipc-main";
import { getMachineId } from "./services/machine-id";
import { USER_MUSIC_DIR } from "./services/user-music";
import { USER_VOICE_DIR } from "./services/user-voice";
import { join, basename } from "path";
import { createReadStream } from "fs";
import { Readable } from "node:stream";
import { stat } from "fs-extra";

// 必须在 app ready 之前注册自定义协议为特权协议，
// 否则 Chromium 不会把 app-user-music:// 当作可加载媒体的合法来源。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app-user-music",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

// 单实例锁：避免多实例并发写音乐元数据/文件
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 已有实例运行时，把主窗口唤起
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// 允许音频无需用户手势即可播放（弹幕自动朗读、时钟播报等场景）
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function onAppReady() {
  // 放行麦克风权限：现场录音功能需要 MediaRecorder + getUserMedia
  // 放行 speaker-selection 权限：AudioContext.setSinkId / HTMLAudioElement.setSinkId 需要
  // （webSecurity: false 下多数情况自动放行，此处显式处理以兼容 macOS 权限弹窗）
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "speaker-selection");
  });
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, _requestingOrigin, _external) =>
      permission === "media" || permission === "speaker-selection",
  );

  // 自定义协议：app-user-music://<host>/<encoded fileName>
  //   host = "music" -> userData/bg-music-user/<fileName>
  //   host = "voice" -> userData/bg-voice-user/<fileName>
  // 用固定 host 占位，文件名始终落在 pathname，避免中文文件名被当作 hostname 做 punycode 编码。
  const MIME_MAP: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
  };
  const HOST_DIR_MAP: Record<string, string> = {
    music: USER_MUSIC_DIR,
    voice: USER_VOICE_DIR,
  };
  protocol.handle("app-user-music", async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const baseDir = HOST_DIR_MAP[host];
    if (!baseDir) {
      return new Response("Not Found", { status: 404 });
    }
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    // 用 basename 兜底，防止路径穿越
    const filePath = join(baseDir, basename(fileName));

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }

    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";

    // 支持 Range 请求，保证音频元素可正常缓冲
    const range = request.headers.get("Range");
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const total = fileStat.size;
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : total - 1;
        const stream = Readable.toWeb(createReadStream(filePath, { start, end }));
        return new Response(stream as unknown as BodyInit, {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
    }

    const stream = Readable.toWeb(createReadStream(filePath));
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(fileStat.size),
        "Accept-Ranges": "bytes",
      },
    });
  });

  const { disableF12 } = useDisableButton();
  const { renderProcessGone } = useProcessException();
  const { defaultIpc } = useMainDefaultIpc();
  const { createMenu } = useMenu();
  disableF12();
  renderProcessGone();
  defaultIpc();
  createMenu();
  getMachineId(); // 预热：应用启动即生成机器码并缓存

  new InitWindow().initWindow();
  if (process.env.NODE_ENV === "development") {
    const { installExtension, VUEJS_DEVTOOLS } = require("electron-devtools-installer");
    installExtension(VUEJS_DEVTOOLS)
      .then((pluginInfo: Electron.Extension) => console.log(`已安装: `, pluginInfo.name))
      .catch((err: Error) => console.log("无法安装vue-devtools: ", err));
    console.log("已安装: vue-devtools");
  }
}

app.whenReady().then(onAppReady);
// 由于9.x版本问题，需要加入该配置关闭跨域问题
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

app.on("window-all-closed", () => {
  // 所有平台均为所有窗口关闭就退出软件
  app.quit();
});
app.on("browser-window-created", () => {
  console.log("window-created");
});

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.removeAsDefaultProtocolClient("electron-vue-template");
    console.log("由于框架特殊性开发环境下无法使用");
  }
} else {
  app.setAsDefaultProtocolClient("electron-vue-template");
}
