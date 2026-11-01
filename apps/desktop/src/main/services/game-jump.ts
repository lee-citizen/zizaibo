import { net } from 'electron'
import { BASE_API } from '../config/api'

/**
 * 调用游戏跳转接口，获取游戏真实地址
 *
 * 后台返回 302 重定向。Electron 的 net.request 默认会自动跟随重定向，
 * 因此需要监听 'redirect' 事件，在重定向发生时直接拿到 Location，
 * 不调用 followRedirect() 即可阻止继续跟随。
 *
 * 兜底：若后台未返回 302 而是 200 + JSON（含 url 字段），也能解析。
 *
 * @param token  授权 Token
 * @param gameKey 游戏标识（游戏列表 items[].id）
 * @returns 游戏真实 URL
 * @throws 401 时抛出 'UNAUTHORIZED'；其他情况抛出对应错误信息
 */
export function gameJump(token: string, gameKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ game_key: gameKey })
    const request = net.request({
      method: 'POST',
      url: `${BASE_API}/api/v1/game/jump`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    let settled = false

    // 监听重定向：直接拿到跳转地址，不跟随
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (settled) return
      if (redirectUrl) {
        settled = true
        resolve(redirectUrl)
      }
    })

    request.on('response', (response) => {
      if (settled) return

      // 尝试从 location 响应头获取（极少数情况 302 未触发 redirect 事件）
      const location = response.headers['location']
      const locationStr = Array.isArray(location) ? location[0] : location
      if (locationStr) {
        settled = true
        resolve(locationStr)
        return
      }

      if (response.statusCode === 401) {
        settled = true
        reject(new Error('UNAUTHORIZED'))
        return
      }
      if (response.statusCode === 404) {
        settled = true
        reject(new Error('游戏不存在或已下架'))
        return
      }

      // 200 但无 location：后台可能返回了 JSON 格式的 url，读取响应体
      let data = ''
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      response.on('end', () => {
        if (settled) return
        try {
          const json = JSON.parse(data)
          const url = json?.data?.url || json?.url
          if (url) {
            settled = true
            resolve(url)
          } else {
            reject(new Error(`跳转失败 (HTTP ${response.statusCode})`))
          }
        } catch {
          reject(new Error(`跳转失败 (HTTP ${response.statusCode})`))
        }
      })
    })

    request.on('error', (err) => {
      if (settled) return
      reject(new Error(`网络请求失败: ${err.message}`))
    })

    request.write(body)
    request.end()
  })
}
