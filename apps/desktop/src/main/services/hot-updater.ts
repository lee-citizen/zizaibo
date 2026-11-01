/**
 * 增量热更新服务
 * 对接后台接口 GET /api/v1/app/hot-update?platform=xxx
 * 返回 { code, data: { version, name, hash, download_url } } 或 data: null
 */

import { emptyDir, createWriteStream, readFile, copy, remove } from 'fs-extra'
import { join, resolve } from 'path'
import { promisify } from 'util'
import { pipeline } from 'stream'
import { app, BrowserWindow } from 'electron'
import { gt } from 'semver'
import { createHash } from 'crypto'
import AdmZip from 'adm-zip'
import { version } from '../../../package.json'
import { BASE_API } from '../config/api'
import axios, { AxiosResponse } from 'axios'
import { webContentSend } from './web-content-send'
import type { IpcImpl, UpdaterContract } from 'ipc-contract'

const streamPipeline = promisify(pipeline)
const appPath = app.getAppPath()
const updatePath = resolve(appPath, '..', '..', 'update')
const request = axios.create()

/**
 * 计算文件内容的 SHA-256（小写十六进制）
 * 注意：后台接口返回的 hash 是普通 SHA-256，不是 HMAC
 */
function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 根据当前操作系统返回平台标识 */
function getPlatform(): string {
  return process.platform === 'darwin' ? 'mac' : 'windows'
}

interface HotUpdateData {
  version: string
  name: string
  hash: string
  download_url: string
}

interface HotUpdateResponse extends AxiosResponse<any> {
  data: {
    code: string
    data: HotUpdateData | null
  }
}

// 状态管理
const updateInfo = {
  status: 'init',
  message: '',
}

export const updaterIpcHandlers: IpcImpl<UpdaterContract> = {
  start: async (event) => {
    const windows = BrowserWindow.fromWebContents(event.sender)
    if (windows) {
      await performUpdate(windows)
    }
  },

  test: async () => {
    console.log('updater:test - Not implemented yet')
  },
}

/**
 * 下载文件
 */
async function download(url: string, filePath: string): Promise<void> {
  const res = await request({ url, responseType: 'stream' })
  await streamPipeline(res.data, createWriteStream(filePath))
}

/**
 * 执行增量热更新流程
 */
async function performUpdate(windows?: BrowserWindow): Promise<void> {
  try {
    const platform = getPlatform()
    const url = `${BASE_API}/api/v1/app/hot-update`
    console.log('[hot-updater] 检查更新:', url, 'platform:', platform, '当前版本:', version)
    const res: HotUpdateResponse = await request({
      url,
      params: { platform },
    })
    console.log('[hot-updater] 接口返回:', JSON.stringify(res.data))

    const data = res.data?.data
    // 没有可用热更新
    if (!data) {
      console.log('[hot-updater] 无可用更新')
      updateInfo.status = 'not-available'
      updateInfo.message = '当前已是最新版本'
      if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)
      return
    }

    // 版本比较
    if (!gt(data.version, version)) {
      console.log('[hot-updater] 当前已是最新版本', data.version, '<=', version)
      updateInfo.status = 'not-available'
      updateInfo.message = '当前已是最新版本'
      if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)
      return
    }

    console.log('[hot-updater] 发现新版本:', data.version, '下载地址:', data.download_url)

    // 有新版本，开始更新
    await emptyDir(updatePath)
    const filePath = join(updatePath, data.name)

    updateInfo.status = 'downloading'
    updateInfo.message = '正在下载更新包...'
    if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)

    await download(data.download_url, filePath)

    // 校验 SHA-256
    const buffer = await readFile(filePath)
    const fileHash = sha256(buffer)
    if (fileHash !== data.hash) {
      throw new Error('文件校验失败，SHA-256 不匹配')
    }

    // 解压
    updateInfo.status = 'moving'
    updateInfo.message = '正在安装更新...'
    if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)

    const appPathTemp = join(updatePath, 'temp')
    const zip = new AdmZip(filePath)
    zip.extractAllTo(appPathTemp, true, true)

    // 替换文件
    await remove(join(`${appPath}`, 'dist'))
    await remove(join(`${appPath}`, 'package.json'))
    await copy(appPathTemp, appPath)

    updateInfo.status = 'finished'
    updateInfo.message = '更新完成'
    if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)
  } catch (error) {
    console.error('[hot-updater] 更新失败:', error)
    updateInfo.status = 'failed'
    updateInfo.message = error instanceof Error ? error.message : String(error)
    if (windows) webContentSend.update.hotStatus(windows.webContents, updateInfo)
  }
}
