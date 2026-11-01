

## 基本约定

客户端将服务根地址配置为 `BASE_URL`，例如：

```text
http://59.110.51.224
```

接口路径均以 `/api/v1` 开头，例如 `{BASE_URL}/api/v1/games`。正式发布必须使用 HTTPS；卡密和授权 Token 不应通过明文 HTTP 传输。

除文件下载外，建议请求头携带：

```http
Accept: application/json
Content-Type: application/json
```

所有时间戳均为 Unix 秒级时间戳。`expires_at: null` 表示永久授权。业务成功时通常返回 HTTP `200`，并包含 `code: "OK"`。未授权返回 HTTP `401`，包含 `code: "UNAUTHORIZED"`。

## 客户端调用流程

1. EXE 启动后检查更新；若为强制更新，更新完成后才能继续。
2. 从安全存储读取 `token` 和稳定的 `device_id`，调用启动鉴权。
3. 仅当 `data.authorized === true` 时，允许进入游戏大厅并启用“开始游戏”。
4. 未授权、Token 过期、机器码变化或授权到期时，展示卡密激活页。
5. 激活成功后保存新 Token，并再次调用启动鉴权。
6. 仅授权成功后才加载游戏列表；未授权时不能进入游戏大厅，也不能启动游戏。

`device_id` 必须是同一台机器稳定不变的唯一标识，长度 16–512 个字符；不得每次启动随机生成。

## 1. 游戏列表

```http
GET /api/v1/games
Authorization: Bearer {token}
```

必须携带激活接口取得的有效 Token。仅返回后台状态为“上架”的游戏，按排序值、ID 升序排列。未授权时不会返回任何游戏数据。

```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "id": "game_001",
        "name": "示例游戏",
        "script": "[]",
        "vbs": "",
        "toolkit": null,
        "orientation": "",
        "tips": "进入游戏后按提示操作",
        "cover": "/uploads/2026-11-01/game/covers/example.png",
        "tips_images": "[]",
        "tips_edited": 0
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 游戏唯一标识，对应后台游戏标识 |
| `name` | string | 游戏名称 |
| `cover` | string | 封面完整 URL |
| `tips` | string | 使用提示 |
| `script` | string | JSON 字符串；目前通常为 `[]` |
| `vbs` | string | 预留脚本字段 |
| `toolkit` | string/null | JSON 字符串或 `null` |
| `orientation` | string | 预留方向字段 |
| `tips_images` | array | 提示图片完整 URL 数组 |
| `tips_edited` | integer | `0` 未编辑，`1` 已编辑 |

> 此接口不会返回 `url`。客户端不得从列表缓存或猜测游戏地址，而应在用户点击游戏后调用“游戏跳转”接口获取地址。

## 2. 游戏跳转（授权后服务端重定向）

```http
POST /api/v1/game/jump
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "game_key": "game_001"
}
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `token` | 是 | 通过 `Authorization: Bearer {token}` 请求头传递；为兼容旧客户端，暂时也支持请求体传递 |
| `game_key` | 是 | 游戏列表的 `items[].id`，即后台游戏标识 |

授权有效且游戏处于上架状态时：

```http
HTTP/1.1 302 Found
Location: https://game.example.com/start
```

该接口不再返回游戏 URL JSON；EXE 应允许 HTTP 重定向，或使用其内置浏览器直接打开此接口请求。

Token 无效、Token 已过期、账号被禁用或会员到期时：

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "code": "UNAUTHORIZED",
  "message": "未授权或授权已过期"
}
```

游戏不存在或已下架时返回 HTTP `404`，业务码为 `GAME_NOT_FOUND`。客户端收到非 `OK` 结果时不得启动游戏。

## 3. 卡密激活

```http
POST /api/v1/activation
Content-Type: application/json
```

```json
{
  "card_key": "AAAA1111-BBBB2222-CCCC3333-DDDD4444",
  "device_id": "stable-device-fingerprint-at-least-16-chars"
}
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `card_key` | 是 | 用户输入的卡密，最长 512 字符 |
| `device_id` | 是 | 本机唯一机器码，16–512 字符 |

成功响应：

```json
{
  "code": "OK",
  "data": {
    "token": "64 位随机 Token",
    "authorized": true,
    "license_type": "permanent",
    "expires_at": null
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `token` | 后续鉴权使用的 Bearer Token；加密保存，不要写入日志 |
| `authorized` | 激活成功时为 `true` |
| `license_type` | `permanent`（永久）或 `duration`（时效） |
| `expires_at` | 到期时间戳；永久卡为 `null` |

失败响应：

| HTTP 状态 | `code` | 说明 |
| --- | --- | --- |
| 422 | `INVALID_CARD` | 卡密无效、已禁用或过兑换截止时间 |
| 409 | `CARD_USED` | 卡密已绑定另一设备 |
| 422 | 验证错误 | 参数缺失或格式不合法 |

卡密无效示例：

```json
{
  "code": "INVALID_CARD",
  "message": "卡密不可用"
}
```

## 5. 更新检查

```http
GET /api/v1/app/update?platform=windows
```

| 参数 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `platform` | 否 | `windows` | 客户端平台标识 |

存在已发布版本时：

```json
{
  "code": "OK",
  "data": {
    "id": 1,
    "version": "1.2.0",
    "platform": "windows",
    "download_url": "https://download.example.com/client-1.2.0.exe",
    "sha256": "64 位 SHA-256 十六进制字符串",
    "release_notes": "修复若干问题",
    "force_update": 1,
    "status": 1,
    "released_at": 1798761600,
    "creator_id": 1,
    "created_at": 1798761600,
    "updated_at": 1798761600,
    "deleted_at": 0
  }
}
```

没有匹配平台的已发布版本时：

```json
{ "code": "OK", "data": null }
```

客户端自行将当前版本与 `data.version` 比较，接口始终返回该平台最新发布记录。`force_update` 为 `1` 或 `true` 时，必须阻止进入授权与游戏大厅；下载后应校验 SHA-256。

## 安全要求
- 每次启动都必须调用启动鉴权；本地缓存不能作为授权依据。
- 未授权时不得调用或展示游戏列表；列表和跳转接口均会返回 `UNAUTHORIZED`。
- 点击游戏时必须调用跳转接口，并允许服务端的 HTTP `302` 重定向；客户端不得自行保存、拼接或暴露游戏地址。

## 接口速查

| 功能 | 方法 | 路径 | 是否需要 Token |
| --- | --- | --- | --- |
| 游戏列表 | GET | `/api/v1/games` | 是，`Authorization: Bearer {token}` |
| 游戏跳转 | POST | `/api/v1/game/jump` | 是，`Authorization: Bearer {token}` |
| 卡密激活 | POST | `/api/v1/activation` | 否 |
| 更新检查 | GET | `/api/v1/app/update?platform=windows` | 否 |
