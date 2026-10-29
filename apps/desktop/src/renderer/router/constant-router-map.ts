import { RouteRecordRaw } from 'vue-router'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@renderer/views/404.vue'),
  },
  {
    path: '/',
    name: '直播主页',
    component: () => import('@renderer/views/index/index.vue'),
  },
  {
    path: '/games',
    name: '游戏大厅',
    component: () => import('@renderer/views/games/games.vue'),
  },
  {
    path: '/connect',
    name: '连接直播',
    component: () => import('@renderer/views/connect/connect.vue')
  },
  {
    path: '/music',
    name: '背景音乐',
    component: () => import('@renderer/views/music/music.vue'),
  },

  {
    path: '/clock',
    name: '自动报时',
    component: () => import('@renderer/views/clock/clock.vue'),
  },
  {
    path: '/speech',
    name: '智能朗读',
    component: () => import('@renderer/views/speech/speech.vue'),
  },
  {
    path: '/settings',
    name: '系统设置',
    component: () => import('@renderer/views/settings/settings.vue'),
  },
  {
    path: '/key',
    name: '卡密充值',
    component: () => import('@renderer/views/key/key.vue'),
  },
  {
    path: '/Browser',
    name: '浏览器',
    component: () => import('@renderer/views/Browser.vue'),
  },
]

export default routes
