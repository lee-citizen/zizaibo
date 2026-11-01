export default {
  build: {
    // 热更新资源托管地址（服务器接口/OSS/CDN 均可），留空表示不启用热更新
    // 填好后应用会请求 `${hotPublishUrl}/${hotPublishConfigName}.json` 获取版本信息
    hotPublishUrl: '',
    hotPublishConfigName: 'update-config',
  },
  dev: {
    removeElectronJunk: true,
    chineseLog: false,
    port: 9080,
  },
  DllFolder: '',
  HotUpdateFolder: 'update',
  UseStartupChart: true,
  IsUseSysTitle: false,
}
