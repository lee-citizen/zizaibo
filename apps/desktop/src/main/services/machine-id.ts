import os from 'os'
import crypto from 'crypto'

/** 机器码缓存，应用生命周期内只生成一次 */
let cachedMachineId: string | null = null

/**
 * 基于硬件信息生成机器码（同机稳定，跨 Windows/macOS/Linux 通用）
 * 收集 hostname + platform + arch + CPU型号 + CPU核数 + 总内存，做 MD5
 */
function generateMachineId(): string {
    const cpu = os.cpus()[0]
    const info = [
        os.hostname(),
        os.platform(),
        os.arch(),
        cpu?.model || '',
        os.cpus().length,
        os.totalmem(),
    ].join('|')
    return crypto.createHash('md5').update(info).digest('hex')
}

/**
 * 获取本机机器码（带缓存，首次调用生成，之后直接返回）
 * 主进程内部和 IPC handler 都通过此函数获取
 */
export function getMachineId(): string {
    if (!cachedMachineId) {
        cachedMachineId = generateMachineId()
    }
    return cachedMachineId
}