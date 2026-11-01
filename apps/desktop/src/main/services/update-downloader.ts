import { net, shell, app } from 'electron'
import { createWriteStream } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import { pipeline } from 'stream'

const streamPipeline = promisify(pipeline)

/**
 * 下载更新包并校验 SHA-256，校验通过后打开安装包
 * @param downloadUrl 安装包下载地址
 * @param expectedSha256 期望的 SHA-256（空字符串则跳过校验）
 * @param fileName 保存的文件名
 */
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  expectedSha256: string,
  fileName: string,
): Promise<void> {
  const savePath = join(tmpdir(), fileName)

  await new Promise<void>((resolve, reject) => {
    const request = net.request(downloadUrl)
    const writeStream = createWriteStream(savePath)

    request.on('response', (response) => {
      streamPipeline(response, writeStream)
        .then(() => {
          // 校验 SHA-256
          if (expectedSha256) {
            const hash = createHash('sha256')
            const fs = require('fs')
            const fileBuffer = fs.readFileSync(savePath)
            hash.update(fileBuffer)
            const actual = hash.digest('hex')
            if (actual !== expectedSha256) {
              reject(new Error('SHA-256 校验失败，安装包可能被篡改'))
              return
            }
          }
          resolve()
        })
        .catch((err) => reject(err))
    })

    request.on('error', (err) => reject(err))
    request.end()
  })

  // 打开安装包（交给系统处理）
  await shell.openPath(savePath)
  // 退出当前应用，让用户安装
  app.exit(0)
}
