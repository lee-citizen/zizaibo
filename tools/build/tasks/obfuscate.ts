/**
 * 产物混淆（javascript-obfuscator 后处理）
 * 构建完成后对 dist 下的 JS 产物做混淆，不侵入 rolldown/vite 构建流程。
 * 仅在生产构建时执行（dev 不经过本任务）。
 *
 * 混淆范围：
 *   apps/desktop/dist/electron/main/*.cjs        主进程 + preload
 *   apps/desktop/dist/electron/renderer/ **\*.js  渲染层
 *   apps/desktop/dist/web/**\*.js                 web 版（若存在）
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, extname } from 'path'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { doneLog, errorLog, infoLog, warningLog } from '../shared/log.ts'

const appRoot = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop')

// 混淆配置：强度与性能的平衡，务必保留 console（线上排查日志依赖它）
const obfuscatorOptions: Parameters<typeof JavaScriptObfuscator.obfuscate>[1] = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  // 重命名全局变量会破坏 window/document 挂载，关闭
  renameGlobals: false,
  // 对象键名不能动（electron-store / axios 数据结构 / Vue props）
  transformObjectKeys: false,
  // 字符串入数组 + base64，运行时还原，字符串值不变（IPC 通道名等不受影响）
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: false,
  // 控制流平坦化：强度核心来源，阈值保守些避免性能损耗
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  // 死代码注入体积膨胀明显，不开
  deadCodeInjection: false,
  // 保留 console 输出（hot-updater / game-jump 等日志是线上排查手段）
  disableConsoleOutput: false,
  numbersToExpressions: true,
  simplify: true,
  // 与已 minify 产物叠加可能出问题，不开
  selfDefending: false,
  sourceMap: false,
}

function collectJsFiles(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules') continue
      collectJsFiles(full, exts, out)
    } else if (exts.includes(extname(name))) {
      out.push(full)
    }
  }
  return out
}

function obfuscateFile(file: string): { before: number; after: number } {
  const code = readFileSync(file, 'utf-8')
  const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions)
  writeFileSync(file, result.getObfuscatedCode(), 'utf-8')
  return { before: code.length, after: result.getObfuscatedCode().length }
}

try {
  const targets: { dir: string; exts: string[] }[] = [
    { dir: join(appRoot, 'dist', 'electron', 'main'), exts: ['.cjs'] },
    { dir: join(appRoot, 'dist', 'electron', 'renderer'), exts: ['.js'] },
    { dir: join(appRoot, 'dist', 'web'), exts: ['.js'] },
  ]

  const files = targets.flatMap((t) => collectJsFiles(t.dir, t.exts))
  if (files.length === 0) {
    warningLog('未找到可混淆的产物，请先执行构建')
    process.exit(1)
  }

  infoLog(`共 ${files.length} 个文件待混淆`)
  let totalBefore = 0
  let totalAfter = 0
  for (const file of files) {
    const { before, after } = obfuscateFile(file)
    totalBefore += before
    totalAfter += after
    const rel = file.replace(appRoot, '')
    console.log(`  ${rel}  ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB`)
  }

  doneLog(
    `混淆完成，体积 ${(totalBefore / 1024 / 1024).toFixed(2)}MB -> ${(totalAfter / 1024 / 1024).toFixed(2)}MB`,
  )
} catch (error) {
  errorLog('混淆失败')
  throw error
}
